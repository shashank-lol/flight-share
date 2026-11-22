import {createHash, randomBytes} from 'node:crypto';
import {Prisma, type Flight} from '@prisma/client';
import type {z} from 'zod';
import {potentialMatch, remainingWeight, matchDisclaimer} from '@/domain/baggage';
import {flightKey} from '@/domain/flights';
import {prisma} from './db';
import {getFlyers} from './flyer';
import {HttpError} from './errors';
import {audit, logger} from './log';
import {flightProvider, type Verification} from './providers/flight';
import {airlinePolicyProvider} from './providers/policy';
import {redis} from './redis';
import {rideCounterparts} from './rides';
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
  const current = await prisma.passengerProfile.findUnique({where: {userId}, select: publicProfile});
  if (!current) throw new HttpError(409, 'PROFILE_NOT_CREATED', 'Join your first flight before editing your profile.');
  const updated = await prisma.passengerProfile.update({where: {userId}, data: profile, select: publicProfile});
  audit('profile_updated', userId);
  const rooms = await prisma.flightMembership.findMany({where: {userId, isActive: true}, select: {flightId: true}});
  const peers = await prisma.flightMembership.findMany({where: {flightId: {in: rooms.map((room) => room.flightId)}, isActive: true, userId: {not: userId}}, select: {flightId: true, userId: true}});
  await Promise.allSettled(peers.map((peer) => publishUser(peer.userId, 'flight:updated', {flightId: peer.flightId})));
  const ridePeers = new Set((await Promise.all(rooms.map(({flightId}) => rideCounterparts(userId, flightId)))).flat());
  await Promise.allSettled([...ridePeers].map((id) => publishUser(id, 'conversations:updated', {})));
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
    id: membership.id, verificationStatus: membership.verificationStatus, baggageAllowance: Number(membership.baggageAllowance),
    expectedBaggageWeight: Number(membership.expectedBaggageWeight), cabinBaggage: membership.cabinBaggage, baggageReported: membership.baggageReported,
    partySize: membership.partySize, rideOptIn: membership.rideOptIn, pickupArea: membership.pickupArea,
  }};
}

type Notice = {userId: string; type: string; payload: {flightId: string}};
export async function joinFlight(userId: string, input: z.output<typeof joinFlightSchema>) {
  const {token, baggageAllowance, expectedBaggageWeight, cabinBaggage, partySize, rideOptIn, pickupArea, ...profile} = input;
  const raw = await redis.eval(`local token = redis.call('GET', KEYS[1]); if token then redis.call('DEL', KEYS[1]); end; return token;`, 1, verifyKey(userId, token));
  if (typeof raw !== 'string') throw new HttpError(409, 'VERIFICATION_EXPIRED', 'Confirm your flight details again before joining.');
  const {flight: {departureDate, ...details}, verificationStatus, method}: Verification = JSON.parse(raw);
  const instanceKey = flightKey({...details, departureDate});
  const result = await prisma.$transaction(async (tx) => {
    const flight = await tx.flight.upsert({where: {instanceKey}, create: {...details, departureDate: toDate(departureDate), instanceKey}, update: {}});
    if (details.departureTime && !flight.departureTime) await tx.flight.updateMany({where: {id: flight.id, departureTime: null}, data: {departureTime: details.departureTime}});
    const flightId = flight.id;
    const key = {flightId_userId: {flightId, userId}};
    const previous = await tx.flightMembership.findUnique({where: key});
    const earlierProfile = await tx.passengerProfile.findUnique({where: {userId}, select: {showBaggage: true}});
    await tx.passengerProfile.upsert({where: {userId}, create: {...profile, userId}, update: profile});
    // An unverified entry must not replace an existing verified assertion.
    const effectiveStatus = previous?.verificationStatus === 'VERIFIED' ? 'VERIFIED' : previous?.verificationStatus === 'SELF_REPORTED' && verificationStatus === 'MOCK' ? 'SELF_REPORTED' : verificationStatus;
    const baggageReported = baggageAllowance !== undefined && expectedBaggageWeight !== undefined;
    const attributes = {baggageAllowance: baggageAllowance ?? 0, expectedBaggageWeight: expectedBaggageWeight ?? 0, baggageReported, cabinBaggage: cabinBaggage ?? null,
      verificationStatus: effectiveStatus, partySize, rideOptIn, pickupArea: rideOptIn ? pickupArea ?? null : null, isActive: true};
    await tx.flightMembership.upsert({where: key, create: {...attributes, userId, flightId, alias: `Traveller ${randomBytes(5).toString('hex').toUpperCase()}`}, update: {...attributes, ...(previous?.isActive ? {} : {joinedAt: new Date()})}});
    if (previous?.verificationStatus !== 'VERIFIED') {
      const verifiedAt = effectiveStatus === 'VERIFIED' ? new Date() : null;
      const record = {verificationMethod: method, verificationStatus: effectiveStatus, verifiedAt};
      await tx.verificationRecord.upsert({where: {userId_flightId: {flightId, userId}}, create: {...record, flightId, userId}, update: record});
    }
    const peerRows = await matchingPeers(tx, flightId, userId);
    const balance = profile.showBaggage && baggageReported ? remainingWeight(baggageAllowance, expectedBaggageWeight) : 0;
    const earlier = previous?.isActive && previous.baggageReported && earlierProfile?.showBaggage ? remainingWeight(+previous.baggageAllowance, +previous.expectedBaggageWeight) : 0;
    const notices = newMatchNotices(flightId, userId, balance, earlier, peerRows);
    if (!previous?.isActive) for (const peer of peerRows) notices.push({userId: peer.userId, type: 'NEW_PASSENGER', payload: {flightId}});
    if (notices.length) await tx.notification.createMany({data: notices});
    return {id: flightId, notices, peers: peerRows.map((peer) => peer.userId)};
  });
  await notify(result.notices, [userId, ...result.peers], result.id);
  audit('flight_joined', userId);
  return {id: result.id};
}

async function matchingPeers(tx: Prisma.TransactionClient, flightId: string, userId: string) {
  const blocks = await tx.userBlock.findMany({where: blocked(userId), select: {blockedId: true, blockerId: true}});
  return tx.flightMembership.findMany({where: {flightId, isActive: true, userId: {notIn: [userId, ...blocks.map((block) => block.blockerId === userId ? block.blockedId : block.blockerId)]}}, select: {
    userId: true, baggageReported: true, baggageAllowance: true, expectedBaggageWeight: true, user: {select: {profile: {select: {showBaggage: true}}}},
  }});
}

function newMatchNotices(flightId: string, userId: string, newBalance: number, oldBalance: number, peers: Awaited<ReturnType<typeof matchingPeers>>) {
  const notices: Notice[] = [];
  for (const peer of peers) {
    if (!peer.baggageReported || !peer.user.profile?.showBaggage) continue;
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
  const {notices, peers} = await prisma.$transaction(async (tx) => {
    const result = await tx.flightMembership.updateMany({where: {flightId, userId, isActive: true}, data: {isActive: true}});
    if (!result.count) throw sameFlight(flightId);
    const where = {flightId_userId: {flightId, userId}};
    const before = await tx.flightMembership.findUniqueOrThrow({where});
    if (!before.baggageReported && (data.baggageAllowance === undefined || data.expectedBaggageWeight === undefined)) throw new HttpError(400, 'BAGGAGE_FIELDS_REQUIRED', 'Enter your allowance and expected baggage weight together.');
    const after = await tx.flightMembership.update({where, data: {...data, baggageReported: true}, include: {user: {select: {profile: {select: {showBaggage: true}}}}}});
    const peers = await matchingPeers(tx, flightId, userId);
    const notices = after.user.profile?.showBaggage ? newMatchNotices(flightId, userId, remainingWeight(+after.baggageAllowance, +after.expectedBaggageWeight), remainingWeight(+before.baggageAllowance, +before.expectedBaggageWeight), peers) : [];
    if (notices.length) await tx.notification.createMany({data: notices});
    return {notices, peers};
  });
  await notify(notices, [userId, ...peers.map((peer) => peer.userId)], flightId);
  return flightRoom(flightId, userId);
}

export async function leaveFlight(flightId: string, userId: string) {
  const result = await prisma.flightMembership.updateMany({where: {flightId, userId, isActive: true}, data: {isActive: false}});
  if (!result.count) throw sameFlight(flightId);
  const peers = await matchingPeers(prisma, flightId, userId);
  await notify([], [userId, ...peers.map((peer) => peer.userId)], flightId);
  await Promise.allSettled((await rideCounterparts(userId, flightId)).map((id) => publishUser(id, 'conversations:updated', {})));
  audit('flight_left', userId);
  return {left: true};
}

export async function deleteAccount(userId: string) {
  await prisma.user.delete({where: {id: userId}});
  audit('account_deleted', userId);
  return {deleted: true};
}

type DirectoryRow = {
  id: string; displayName: string; alias: string; isAnonymous: boolean; isSelf: boolean; verificationStatus: string;
  baggageAllowance: Prisma.Decimal | null; expectedBaggageWeight: Prisma.Decimal | null; remainingWeight: Prisma.Decimal | null;
  transportation: string | null; companionship: boolean | null; partySize: number | null;
};

export async function listPassengers(flightId: string, userId: string, {filter, sort, q, page}: z.output<typeof directorySchema>) {
  await requireMembership(flightId, userId);
  const filters = {
    all: Prisma.empty, excess: Prisma.sql`AND "remainingWeight" < 0`, available: Prisma.sql`AND "remainingWeight" > 0`,
    cab: Prisma.sql`AND transportation = 'CAB_SHARE'`, companions: Prisma.sql`AND companionship`,
  };
  const sorts = {recent: Prisma.sql`"joinedAt" DESC`, name: Prisma.sql`lower("displayName") ASC, alias ASC`, baggage: Prisma.sql`"remainingWeight" DESC NULLS LAST`};
  const rows = await prisma.$queryRaw<DirectoryRow[]>(Prisma.sql`
    WITH visible AS (
      SELECT m.id, m.alias, m."joinedAt", p."isAnonymous", m."verificationStatus", (m."userId" = ${userId}) AS "isSelf",
        CASE WHEN p."isAnonymous" THEN 'Anonymous Traveller' ELSE p."displayName" END AS "displayName",
        CASE WHEN p."showBaggage" AND m."baggageReported" THEN m."baggageAllowance" END AS "baggageAllowance",
        CASE WHEN p."showBaggage" AND m."baggageReported" THEN m."expectedBaggageWeight" END AS "expectedBaggageWeight",
        CASE WHEN p."showBaggage" AND m."baggageReported" THEN m."baggageAllowance" - m."expectedBaggageWeight" END AS "remainingWeight",
        CASE WHEN p."showTravelPreferences" THEN CASE WHEN m."rideOptIn" THEN 'CAB_SHARE'::"Transportation" WHEN p.transportation = 'CAB_SHARE' THEN 'NONE'::"Transportation" ELSE p.transportation END END AS transportation,
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
    ) SELECT id, alias, "isAnonymous", "verificationStatus", "isSelf", "displayName", "baggageAllowance", "expectedBaggageWeight", "remainingWeight", transportation, companionship, "partySize"
      FROM visible WHERE (strpos(lower("displayName"), lower(${q})) > 0 OR strpos(lower(alias), lower(${q})) > 0) ${filters[filter]}
      ORDER BY "isSelf" DESC, ${sorts[sort]}, id LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}
  `);
  const asNumber = (value: Prisma.Decimal | null) => value === null ? null : Number(value);
  return {items: rows.slice(0, PAGE_SIZE).map((row) => ({...row, baggageAllowance: asNumber(row.baggageAllowance), expectedBaggageWeight: asNumber(row.expectedBaggageWeight), remainingWeight: asNumber(row.remainingWeight)})), page, hasMore: rows.length > PAGE_SIZE};
}

export async function matches(flightId: string, userId: string, page: number) {
  const member = await requireMembership(flightId, userId);
  const balance = remainingWeight(+member.baggageAllowance, +member.expectedBaggageWeight);
  const empty = {items: [], disclaimer: matchDisclaimer, page, hasMore: false};
  const profile = await prisma.passengerProfile.findUnique({where: {userId}, select: {showBaggage: true}});
  if (!member.baggageReported || !balance || !profile?.showBaggage) return empty;
  // The directory filters by visible baggage only. The caller cannot use matches to infer hidden data.
  const directory = await listPassengers(flightId, userId, {filter: balance < 0 ? 'available' : 'excess', sort: 'baggage', q: '', page});
  return {items: directory.items.flatMap((peer) => {
    const match = !peer.isSelf && peer.remainingWeight !== null ? potentialMatch(balance, peer.remainingWeight) : null;
    return match ? [{passengerId: peer.id, displayName: peer.isAnonymous ? `Anonymous Traveller · ${peer.alias}` : peer.displayName, ...match}] : [];
  }), disclaimer: matchDisclaimer, page, hasMore: directory.hasMore};
}

export async function policy(flightId: string, userId: string) {
  const flight = await flightRoom(flightId, userId);
  return airlinePolicyProvider.getBaggagePolicy(flight.airline, flight);
}