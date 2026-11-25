import {createHash, randomBytes} from 'node:crypto';
import {Prisma, type Flight} from '@prisma/client';
import type {z} from 'zod';
import {potentialMatch, remainingWeight} from '@/domain/baggage';
import {flightKey} from '@/domain/flights';
import {baggageDto, baggageRoomRecipients, cancelPendingBaggageForUser, prunePendingBaggage, retireBaggageForMembership} from './baggage';
import {prisma} from './db';
import {getFlyers} from './flyer';
import {HttpError} from './errors';
import {audit, logger} from './log';
import {flightProvider, type Verification} from './providers/flight';
import {airlinePolicyProvider} from './providers/policy';
import {redis} from './redis';
import {retireCabsForMembership} from './rides';
import {conversationCounterparts, socialWrite} from './social/access';
import {publishUser} from './social/events';
import type {baggageSchema, directorySchema, editProfileSchema, joinFlightSchema, verifyFlightSchema} from './validation';

const PAGE_SIZE = 24;
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const verifyKey = (userId: string, token: string) => `fs:verify:${userId}:${createHash('sha256').update(token).digest('hex')}`;
const blocked = (userId: string) => ({OR: [{blockerId: userId}, {blockedId: userId}]});

export function flightDto(flight: Flight, memberCount?: number) {
  const {id, airline, flightNumber, departureAirport, arrivalAirport, departureDate, departureTime, status} = flight;
  return {id, airline, flightNumber, departureAirport, arrivalAirport, departureDate: departureDate.toISOString().slice(0, 10), departureTime, status, memberCount};
}

export async function verifyFlight(userId: string, input: z.output<typeof verifyFlightSchema>) {
  let verification: Verification;
  if (input.method === 'manual') {
    const {method, ...flight} = input;
    verification = {flight, verificationStatus: 'SELF_REPORTED', method: method.toUpperCase()};
  } else {
    // Send booking credentials directly to the authorized provider, if configured. Never persist them.
    verification = await flightProvider().verifyBooking(input);
  }
  const token = randomBytes(32).toString('base64url');
  await redis.set(verifyKey(userId, token), JSON.stringify(verification), 'EX', 600);
  audit('flight_verification_started', userId);
  const {airline, flightNumber, departureAirport, arrivalAirport, departureDate, departureTime} = verification.flight;
  return {token, flight: {airline, flightNumber, departureAirport, arrivalAirport, departureDate, departureTime: departureTime ?? null}, verificationStatus: verification.verificationStatus, suggestedDisplayName: verification.suggestedDisplayName};
}

const publicProfile = {displayName: true, isAnonymous: true, showBaggage: true, showTravelPreferences: true, transportation: true, companionship: true, showFlyer: true} as const;
export async function getProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({where: {id: userId}, select: {
    profile: {select: publicProfile}, memberships: {where: {isActive: true}, orderBy: {joinedAt: 'desc'}, select: {flight: {include: {_count: {select: {memberships: {where: {isActive: true}}}}}}}},
  }});
  return {profile: user.profile, flights: user.memberships.map(({flight}) => flightDto(flight, flight._count.memberships)), flyer: (await getFlyers([userId])).get(userId)};
}

export async function updateProfile(userId: string, profile: z.output<typeof editProfileSchema>) {
  const updated = await socialWrite(async (db) => {
    const current = await db.passengerProfile.findUnique({where: {userId}, select: {id: true}});
    if (!current) throw new HttpError(409, 'PROFILE_NOT_CREATED', 'Join your first flight before editing your profile.');
    const result = await db.passengerProfile.update({where: {userId}, data: profile, select: publicProfile});
    if (profile.showBaggage === false) await cancelPendingBaggageForUser(db, userId);
    return result;
  });
  audit('profile_updated', userId);
  const rooms = await prisma.flightMembership.findMany({where: {userId, isActive: true}, select: {flightId: true}});
  const peers = await prisma.flightMembership.findMany({where: {flightId: {in: rooms.map((room) => room.flightId)}, isActive: true}, select: {flightId: true, userId: true}});
  await Promise.allSettled(peers.map((peer) => publishUser(peer.userId, 'flight:updated', {flightId: peer.flightId})));
  const chatPeers = new Set((await Promise.all(rooms.map(({flightId}) => conversationCounterparts(userId, flightId)))).flat());
  await Promise.allSettled([...chatPeers].map((id) => publishUser(id, 'conversations:updated', {})));
  return updated;
}

const sameFlight = (flightId: string) => new HttpError(404, 'FLIGHT_NOT_FOUND', flightId ? 'This flight room is not available to you.' : 'Flight room not found.');

export async function requireMembership(flightId: string, userId: string) {
  const membership = await prisma.flightMembership.findUnique({where: {flightId_userId: {flightId, userId}}});
  if (!membership?.isActive) throw sameFlight(flightId);
  return membership;
}

export async function flightRoom(flightId: string, userId: string) {
  const membership = await prisma.flightMembership.findFirst({where: {flightId, userId, isActive: true}, include: {flight: {include: {_count: {select: {memberships: {where: {isActive: true}}}}}}}});
  if (!membership) throw sameFlight(flightId);
  return {...flightDto(membership.flight, membership.flight._count.memberships), membership: {
    id: membership.id, verificationStatus: membership.verificationStatus, partySize: membership.partySize,
  }};
}

type Notice = {userId: string; type: string; payload: {flightId: string}};
export async function joinFlight(userId: string, input: z.output<typeof joinFlightSchema>) {
  const {token, baggageAllowance, expectedBaggageWeight, cabinBaggage, partySize, ...profile} = input;
  const raw = await redis.eval(`local token = redis.call('GET', KEYS[1]); if token then redis.call('DEL', KEYS[1]); end; return token;`, 1, verifyKey(userId, token));
  if (typeof raw !== 'string') throw new HttpError(409, 'VERIFICATION_EXPIRED', 'Confirm your flight details again before joining.');
  const {flight: {departureDate, ...details}, verificationStatus, method}: Verification = JSON.parse(raw);
  const instanceKey = flightKey({...details, departureDate});
  const result = await socialWrite(async (tx) => {
    const flight = await tx.flight.upsert({where: {instanceKey}, create: {...details, departureDate: toDate(departureDate), instanceKey}, update: {}});
    if (details.departureTime && !flight.departureTime) await tx.flight.updateMany({where: {id: flight.id, departureTime: null}, data: {departureTime: details.departureTime}});
    const flightId = flight.id;
    const key = {flightId_userId: {flightId, userId}};
    const previous = await tx.flightMembership.findUnique({where: key});
    const earlierProfile = await tx.passengerProfile.findUnique({where: {userId}, select: publicProfile});
    await tx.passengerProfile.upsert({where: {userId}, create: {...profile, userId}, update: profile});
    // An unverified entry must not replace an existing verified assertion.
    const effectiveStatus = previous?.verificationStatus === 'VERIFIED' ? 'VERIFIED' : previous?.verificationStatus === 'SELF_REPORTED' && verificationStatus === 'MOCK' ? 'SELF_REPORTED' : verificationStatus;
    const baggageReported = (baggageAllowance !== undefined && expectedBaggageWeight !== undefined) || (previous?.baggageReported ?? false);
    const attributes = {baggageAllowance: baggageAllowance ?? previous?.baggageAllowance ?? 0, expectedBaggageWeight: expectedBaggageWeight ?? previous?.expectedBaggageWeight ?? 0,
      baggageReported, cabinBaggage: cabinBaggage === undefined ? previous?.cabinBaggage ?? null : cabinBaggage,
      verificationStatus: effectiveStatus, partySize: partySize ?? previous?.partySize ?? 1, isActive: true};
    await tx.flightMembership.upsert({where: key, create: {...attributes, userId, flightId, alias: `Traveller ${randomBytes(5).toString('hex').toUpperCase()}`}, update: {...attributes, ...(previous?.isActive ? {} : {joinedAt: new Date()})}});
    if (!profile.showBaggage) await cancelPendingBaggageForUser(tx, userId);
    if (profile.showBaggage && previous?.isActive) await prunePendingBaggage(tx, flightId, userId);
    if (previous?.verificationStatus !== 'VERIFIED') {
      const verifiedAt = effectiveStatus === 'VERIFIED' ? new Date() : null;
      const record = {verificationMethod: method, verificationStatus: effectiveStatus, verifiedAt};
      await tx.verificationRecord.upsert({where: {userId_flightId: {flightId, userId}}, create: {...record, flightId, userId}, update: record});
    }
    const peerRows = await matchingPeers(tx, flightId, userId);
    const balance = profile.showBaggage && baggageReported ? remainingWeight(Number(attributes.baggageAllowance), Number(attributes.expectedBaggageWeight)) : 0;
    const earlier = previous?.isActive && previous.baggageReported && earlierProfile?.showBaggage ? remainingWeight(+previous.baggageAllowance, +previous.expectedBaggageWeight) : 0;
    const reserved = await tx.baggageReservation.findFirst({where: {membership: {flightId, userId}}, select: {membershipId: true}});
    const notices = reserved ? [] : newMatchNotices(flightId, userId, balance, earlier, peerRows);
    if (!previous?.isActive) for (const peer of peerRows) notices.push({userId: peer.userId, type: 'NEW_PASSENGER', payload: {flightId}});
    if (notices.length) await tx.notification.createMany({data: notices});
    const profileChanged = earlierProfile && Object.keys(publicProfile).some((key) => earlierProfile[key as keyof typeof earlierProfile] !== profile[key as keyof typeof profile]);
    const otherRooms = profileChanged ? await tx.flightMembership.findMany({where: {userId, isActive: true, flightId: {not: flightId}}, select: {flightId: true}}) : [];
    const otherPeers = otherRooms.length ? await tx.flightMembership.findMany({where: {flightId: {in: otherRooms.map(({flightId}) => flightId)}, isActive: true}, select: {flightId: true, userId: true}}) : [];
    return {id: flightId, notices, peers: peerRows.map((peer) => peer.userId), otherPeers};
  });
  await notify(result.notices, [userId, ...result.peers], result.id);
  await Promise.allSettled(result.otherPeers.map(({userId, flightId}) => publishUser(userId, 'flight:updated', {flightId})));
  await Promise.allSettled((await conversationCounterparts(userId, result.id)).map((id) => publishUser(id, 'conversations:updated', {})));
  audit('flight_joined', userId);
  return {id: result.id};
}

async function matchingPeers(tx: Prisma.TransactionClient, flightId: string, userId: string) {
  const blocks = await tx.userBlock.findMany({where: blocked(userId), select: {blockedId: true, blockerId: true}});
  return tx.flightMembership.findMany({where: {flightId, isActive: true, userId: {notIn: [userId, ...blocks.map((block) => block.blockerId === userId ? block.blockedId : block.blockerId)]}}, select: {
    userId: true, baggageReported: true, baggageAllowance: true, expectedBaggageWeight: true, baggageReservation: {select: {membershipId: true}}, user: {select: {profile: {select: {showBaggage: true}}}},
  }});
}

function newMatchNotices(flightId: string, userId: string, newBalance: number, oldBalance: number, peers: Awaited<ReturnType<typeof matchingPeers>>) {
  const notices: Notice[] = [];
  for (const peer of peers) {
    if (peer.baggageReservation || !peer.baggageReported || !peer.user.profile?.showBaggage) continue;
    const balance = remainingWeight(+peer.baggageAllowance, +peer.expectedBaggageWeight);
    if (potentialMatch(newBalance, balance) && !potentialMatch(oldBalance, balance)) notices.push({userId: peer.userId, type: 'BAGGAGE_MATCH', payload: {flightId}});
  }
  if (notices.length) notices.push({userId, type: 'BAGGAGE_MATCH', payload: {flightId}});
  return notices;
}

async function notify(notices: Notice[], peers: string[], flightId: string) {
  const recipients = new Set(notices.map((notice) => notice.userId));
  const outcomes = await Promise.allSettled([...recipients].map((id) => publishUser(id, 'notification:new', {})).concat(peers.map((id) => publishUser(id, 'flight:updated', {flightId}))));
  if (outcomes.some((outcome) => outcome.status === 'rejected')) logger.warn('Real-time update delivery incomplete');
}

export async function updateBaggage(userId: string, input: z.output<typeof baggageSchema>) {
  const {flightId, ...data} = input;
  const {notices, peers, baggage} = await socialWrite(async (tx) => {
    const where = {flightId_userId: {flightId, userId}};
    const before = await tx.flightMembership.findUnique({where});
    if (!before?.isActive) throw sameFlight(flightId);
    if (!before.baggageReported && (data.baggageAllowance === undefined || data.expectedBaggageWeight === undefined)) throw new HttpError(400, 'BAGGAGE_FIELDS_REQUIRED', 'Enter your allowance and expected baggage weight together.');
    const after = await tx.flightMembership.update({where, data: {...data, baggageReported: true}, include: {baggageReservation: {select: {membershipId: true}}, user: {select: {profile: {select: {showBaggage: true}}}}}});
    await prunePendingBaggage(tx, flightId, userId);
    const peers = await matchingPeers(tx, flightId, userId);
    const notices = !after.baggageReservation && after.user.profile?.showBaggage ? newMatchNotices(flightId, userId, remainingWeight(+after.baggageAllowance, +after.expectedBaggageWeight), remainingWeight(+before.baggageAllowance, +before.expectedBaggageWeight), peers) : [];
    if (notices.length) await tx.notification.createMany({data: notices});
    return {notices, peers, baggage: baggageDto(after)};
  });
  await notify(notices, [userId, ...peers.map((peer) => peer.userId)], flightId);
  return baggage;
}

export async function leaveFlight(flightId: string, userId: string) {
  const {cabPeers, peers} = await socialWrite(async (db) => {
    const member = await db.flightMembership.findFirst({where: {flightId, userId, isActive: true}, select: {id: true}});
    if (!member) throw sameFlight(flightId);
    await db.flightMembership.update({where: {id: member.id}, data: {isActive: false}});
    await retireBaggageForMembership(db, flightId, userId);
    return {cabPeers: await retireCabsForMembership(db, member.id), peers: await baggageRoomRecipients(db, flightId)};
  });
  await notify([], [userId, ...peers], flightId);
  const affected = new Set([...cabPeers, ...await conversationCounterparts(userId, flightId)]);
  await Promise.allSettled([...affected].map((id) => publishUser(id, 'conversations:updated', {})));
  audit('flight_left', userId);
  return {left: true};
}

export async function deleteAccount(userId: string) {
  const peers = await socialWrite(async (tx) => {
    const memberships = await tx.flightMembership.findMany({where: {userId, isActive: true}, select: {flightId: true}});
    await tx.user.delete({where: {id: userId}});
    if (!memberships.length) return [];
    return tx.flightMembership.findMany({where: {flightId: {in: memberships.map(({flightId}) => flightId)}, isActive: true}, select: {flightId: true, userId: true}});
  });
  await Promise.allSettled(peers.map(({userId, flightId}) => publishUser(userId, 'flight:updated', {flightId})));
  audit('account_deleted', userId);
  return {deleted: true};
}

type DirectoryRow = {
  id: string; displayName: string; alias: string; isAnonymous: boolean; isSelf: boolean; verificationStatus: string;
  transportation: string | null; companionship: boolean | null; partySize: number | null;
};

export async function listPassengers(flightId: string, userId: string, {filter, sort, q, page}: z.output<typeof directorySchema>) {
  await requireMembership(flightId, userId);
  const filters = {
    all: Prisma.empty,
    cab: Prisma.sql`AND transportation = 'CAB_SHARE'`, companions: Prisma.sql`AND companionship`,
  };
  const sorts = {recent: Prisma.sql`"joinedAt" DESC`, name: Prisma.sql`lower("displayName") ASC, alias ASC`};
  const rows = await prisma.$queryRaw<DirectoryRow[]>(Prisma.sql`
    WITH visible AS (
      SELECT m.id, m.alias, m."joinedAt", p."isAnonymous", m."verificationStatus", (m."userId" = ${userId}) AS "isSelf",
        CASE WHEN p."isAnonymous" THEN 'Anonymous Traveller' ELSE p."displayName" END AS "displayName",
        CASE WHEN p."showTravelPreferences" THEN p.transportation END AS transportation,
        CASE WHEN p."showTravelPreferences" THEN m."partySize" END AS "partySize",
        CASE WHEN p."showTravelPreferences" THEN p.companionship END AS companionship
      FROM "FlightMembership" m JOIN "PassengerProfile" p ON p."userId" = m."userId"
      WHERE m."flightId" = ${flightId} AND m."isActive" AND EXISTS (
        SELECT 1 FROM "FlightMembership" viewer WHERE viewer."flightId" = m."flightId" AND viewer."userId" = ${userId} AND viewer."isActive"
      ) AND NOT EXISTS (
        SELECT 1 FROM "UserBlock" b WHERE
          (b."blockerId" = ${userId} AND b."blockedId" = m."userId") OR
          (b."blockedId" = ${userId} AND b."blockerId" = m."userId")
      )
    ) SELECT id, alias, "isAnonymous", "verificationStatus", "isSelf", "displayName", transportation, companionship, "partySize"
      FROM visible WHERE (strpos(lower("displayName"), lower(${q})) > 0 OR strpos(lower(alias), lower(${q})) > 0) ${filters[filter]}
      ORDER BY "isSelf" DESC, ${sorts[sort]}, id LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}
  `);
  return {items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE};
}

export async function policy(flightId: string, userId: string) {
  const flight = await flightRoom(flightId, userId);
  return airlinePolicyProvider.getBaggagePolicy(flight.airline, flight);
}