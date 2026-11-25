import {Prisma, type CabRequestStatus} from '@prisma/client';
import {z} from 'zod';
import {localDate} from '@/domain/flights';
import {HttpError} from './errors';
import {getFlyers} from './flyer';
import {blockBetween, flightUnavailable, socialRead, socialWrite} from './social/access';
import {conversationUpdates, ensureConversation} from './social/conversations';
import {publishUpdates} from './social/events';

const PAGE_SIZE = 24;
const windowSize = z.number().int().min(0).max(60);
const seats = z.number().int().min(1).max(12);
export const cabWindowQuery = z.string().regex(/^\d{1,2}$/).transform(Number).pipe(windowSize).default(20);
export const cabListingInput = z.strictObject({
  // Allow Indian scripts and areas like Dwarka Sector 21, while rejecting obvious contact details.
  pickupArea: z.string().trim().min(2).max(60).regex(/^[\p{L}\p{M}][\p{L}\p{M}\p{Nd} .,’'()\-]*$/u).refine((area) => (area.match(/\p{Nd}/gu)?.length ?? 0) <= 4 && !/\p{Nd}{4}/u.test(area)),
  freeSeats: seats,
});
export const cabRequestInput = z.strictObject({seats: seats.optional(), window: windowSize.default(20)});
export const cabRequestAction = z.strictObject({action: z.enum(['accept', 'decline', 'withdraw'])});
export const cabRequestDirection = z.enum(['received', 'sent']).default('received');
type ListingInput = z.output<typeof cabListingInput>;

const missingListing = () => new HttpError(404, 'CAB_LISTING_NOT_FOUND', 'This cab listing is not available to you.');
const missingRequest = () => new HttpError(404, 'CAB_REQUEST_NOT_FOUND', 'This cab request is not available to you.');
const notEnoughSeats = () => new HttpError(409, 'CAB_NOT_ENOUGH_SEATS', 'There aren’t enough seats available for this request.');
const closed = () => new HttpError(409, 'CAB_LISTING_CLOSED', 'This cab listing is closed.');

const memberSelect = {id: true, userId: true, flightId: true, isActive: true, alias: true, partySize: true, flight: {
  select: {departureAirport: true, departureDate: true, departureTime: true, airline: true, flightNumber: true},
}} as const;
const profileSelect = {user: {select: {profile: {select: {displayName: true, isAnonymous: true, showFlyer: true}}}}} as const;
type Member = Prisma.FlightMembershipGetPayload<{select: typeof memberSelect}>;
type ScheduledFlight = Member['flight'];
const minutePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const flightEligibility = (flight: ScheduledFlight) => !flight.departureTime || !minutePattern.test(flight.departureTime) ? 'MISSING_TIME' : dateOnly(flight.departureDate) < localDate(-1) ? 'EXPIRED' : 'READY';
const scheduledMinutes = (flight: ScheduledFlight) => Date.parse(`${dateOnly(flight.departureDate)}T${flight.departureTime}:00Z`) / 60_000;
const sameWindow = (a: ScheduledFlight, b: ScheduledFlight, window: number) => a.departureAirport === b.departureAirport
  && flightEligibility(a) === 'READY' && flightEligibility(b) === 'READY' && Math.abs(scheduledMinutes(a) - scheduledMinutes(b)) <= window;
const label = (flight: ScheduledFlight) => `${flight.airline} ${flight.flightNumber}`;
const displayName = (member: {alias: string; user: {profile: {isAnonymous: boolean; displayName: string} | null}}) =>
  !member.user.profile || member.user.profile.isAnonymous ? member.alias : member.user.profile.displayName;

async function requireMember(db: Prisma.TransactionClient, userId: string, flightId: string) {
  const member = await db.flightMembership.findFirst({where: {userId, flightId, isActive: true}, select: memberSelect});
  if (!member) throw flightUnavailable();
  return member;
}

async function seatsTaken(db: Prisma.TransactionClient, listingId: string) {
  return (await db.cabRequest.aggregate({where: {listingId, status: 'ACCEPTED'}, _sum: {seats: true}}))._sum.seats ?? 0;
}

type Listing = {id: string; pickupArea: string; freeSeats: number};
const listingDto = ({id, pickupArea, freeSeats}: Listing, acceptedSeats: number) => ({id, pickupArea, freeSeats, acceptedSeats, availableSeats: freeSeats - acceptedSeats});
type DiscoveryRow = Listing & {hostId: string; displayName: string; showFlyer: boolean; departureDate: Date; departureTime: string; flightLabel: string;
  minutesApart: number; acceptedSeats: number};

export async function listRides(userId: string, flightId: string, page: number, window: number) {
  const {eligibility, ownListing, rows} = await socialRead(async (db) => {
    const viewer = await requireMember(db, userId, flightId);
    const eligibility = flightEligibility(viewer.flight);
    const own = await db.cabListing.findFirst({where: {hostMembershipId: viewer.id, closedAt: null}});
    const ownListing = own ? listingDto(own, await seatsTaken(db, own.id)) : null;
    if (eligibility !== 'READY') return {eligibility, ownListing, rows: []};
    // Compare the airport's scheduled local dates + clock times, not a pickup time or UTC instant.
    const departure = dateOnly(viewer.flight.departureDate);
    const viewerTime = viewer.flight.departureTime;
    const rows = await db.$queryRaw<DiscoveryRow[]>(Prisma.sql`
      SELECT l.id, l."pickupArea", l."freeSeats", m."userId" AS "hostId",
        CASE WHEN p."isAnonymous" THEN m.alias ELSE p."displayName" END AS "displayName", p."showFlyer",
        f."departureDate", f."departureTime", f.airline || ' ' || f."flightNumber" AS "flightLabel",
        ABS(EXTRACT(EPOCH FROM t.difference) / 60)::int AS "minutesApart", capacity."acceptedSeats"
      FROM "Flight" f
      JOIN "FlightMembership" m ON m."flightId" = f.id AND m."isActive"
      JOIN "CabListing" l ON l."hostMembershipId" = m.id AND l."closedAt" IS NULL
      JOIN "PassengerProfile" p ON p."userId" = m."userId"
      CROSS JOIN LATERAL (SELECT COALESCE(SUM(r.seats)::int, 0) AS "acceptedSeats" FROM "CabRequest" r
        WHERE r."listingId" = l.id AND r.status = 'ACCEPTED') capacity
      CROSS JOIN LATERAL (SELECT CASE WHEN f."departureTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        (f."departureDate" + f."departureTime"::time) - (${departure}::date + ${viewerTime}::time) END AS difference) t
      WHERE f."departureAirport" = ${viewer.flight.departureAirport}
        AND f."departureDate" BETWEEN ${departure}::date - 1 AND ${departure}::date + 1
        AND f."departureDate" >= ${localDate(-1)}::date
        AND t.difference BETWEEN ${-window} * INTERVAL '1 minute' AND ${window} * INTERVAL '1 minute'
        AND capacity."acceptedSeats" < l."freeSeats"
        AND NOT EXISTS (SELECT 1 FROM "CabRequest" r JOIN "FlightMembership" rider ON rider.id = r."riderMembershipId"
          WHERE r."listingId" = l.id AND rider."userId" = ${userId})
        AND m."userId" <> ${userId} AND NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE
          (b."blockerId" = ${userId} AND b."blockedId" = m."userId") OR (b."blockedId" = ${userId} AND b."blockerId" = m."userId"))
      ORDER BY "minutesApart", l.id LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    return {eligibility, ownListing, rows};
  });
  const pageRows = rows.slice(0, PAGE_SIZE);
  const flyers = await getFlyers(pageRows.filter((row) => row.showFlyer).map((row) => row.hostId));
  const items = pageRows.map(({hostId, showFlyer, departureDate, id, pickupArea, freeSeats, acceptedSeats, ...row}) => ({
    ...listingDto({id, pickupArea, freeSeats}, acceptedSeats), ...row, departureDate: dateOnly(departureDate), flyer: showFlyer ? flyers.get(hostId) ?? null : null,
  }));
  return {items, page, hasMore: rows.length > PAGE_SIZE, eligibility, window, ownListing};
}

export function publishCab(userId: string, flightId: string, input: ListingInput) {
  return socialWrite(async (db) => {
    const member = await requireMember(db, userId, flightId);
    if (flightEligibility(member.flight) !== 'READY') throw new HttpError(409, 'CAB_FLIGHT_UNAVAILABLE', 'A current flight with a scheduled departure time is required to post a cab listing.');
    if (await db.cabListing.findFirst({where: {hostMembershipId: member.id, closedAt: null}, select: {id: true}})) {
      throw new HttpError(409, 'CAB_ALREADY_PUBLISHED', 'Close or edit your current cab listing first.');
    }
    return listingDto(await db.cabListing.create({data: {...input, hostMembershipId: member.id}}), 0);
  });
}

async function listingViewers(db: Prisma.TransactionClient, listingId: string) {
  return (await db.cabRequest.findMany({where: {listingId}, select: {riderMembership: {select: {userId: true}}}})).map((r) => r.riderMembership.userId);
}

function cabUpdates(ids: string[]) {
  // Reuse the private invalidation signal for involved travellers, without sending listing data over sockets.
  return publishUpdates([...new Set(ids)].map((userId) => ({userId, event: 'conversations:updated', payload: {}})));
}

export async function editCab(userId: string, flightId: string, listingId: string, input: ListingInput) {
  const {listing, viewers} = await socialWrite(async (db) => {
    const host = await requireMember(db, userId, flightId);
    const listing = await db.cabListing.findFirst({where: {id: listingId, hostMembershipId: host.id}});
    if (!listing) throw missingListing();
    if (listing.closedAt) throw closed();
    const accepted = await seatsTaken(db, listingId);
    if (input.freeSeats < accepted) throw new HttpError(409, 'CAB_SEATS_ALREADY_ACCEPTED', 'You cannot offer fewer seats than you have already accepted.');
    return {listing: listingDto(await db.cabListing.update({where: {id: listingId}, data: input}), accepted), viewers: await listingViewers(db, listingId)};
  });
  await cabUpdates([userId, ...viewers]);
  return listing;
}

async function closeListings(db: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length) return;
  await db.cabListing.updateMany({where: {id: {in: ids}, closedAt: null}, data: {closedAt: new Date()}});
  await db.cabRequest.updateMany({where: {listingId: {in: ids}, status: 'PENDING'}, data: {status: 'CLOSED'}});
}

export async function closeCab(userId: string, flightId: string, listingId: string) {
  const viewers = await socialWrite(async (db) => {
    const host = await requireMember(db, userId, flightId);
    const listing = await db.cabListing.findFirst({where: {id: listingId, hostMembershipId: host.id}});
    if (!listing) throw missingListing();
    if (listing.closedAt) return [];
    await closeListings(db, [listingId]);
    return listingViewers(db, listingId);
  });
  await cabUpdates([userId, ...viewers]);
  return {closed: true};
}

const requestFields = {id: true, seats: true, status: true, conversationId: true} as const;
const listingInclude = {hostMembership: {select: {...memberSelect, ...profileSelect}}} as const;
const requestInclude = {listing: {include: listingInclude}, riderMembership: {select: {...memberSelect, ...profileSelect}}} as const;

export async function requestCab(userId: string, flightId: string, listingId: string, input: z.output<typeof cabRequestInput>) {
  const {item, hostId, created} = await socialWrite(async (db) => {
    const rider = await requireMember(db, userId, flightId);
    const listing = await db.cabListing.findUnique({where: {id: listingId}, include: listingInclude});
    const host = listing?.hostMembership;
    if (!listing || !host?.isActive || host.userId === userId || !sameWindow(rider.flight, host.flight, input.window)
      || await db.userBlock.findFirst({where: blockBetween(userId, host.userId), select: {id: true}})) throw missingListing();
    if (listing.closedAt) throw closed();
    const requested = input.seats ?? rider.partySize;
    const previous = await db.cabRequest.findFirst({where: {listingId, riderMembership: {userId}}, select: requestFields});
    if (previous) {
      if (previous.status === 'PENDING' && previous.seats === requested) return {item: previous, hostId: host.userId, created: false};
      throw new HttpError(409, 'CAB_ALREADY_REQUESTED', 'You have already requested seats on this cab. Check your sent requests.');
    }
    if (requested > listing.freeSeats - await seatsTaken(db, listingId)) throw notEnoughSeats();
    const item = await db.cabRequest.create({data: {listingId, riderMembershipId: rider.id, seats: requested, window: input.window}, select: requestFields});
    await db.notification.create({data: {userId: host.userId, type: 'CAB_REQUEST_RECEIVED', payload: {flightId: host.flightId, requestId: item.id}}});
    return {item, hostId: host.userId, created: true};
  });
  if (created) await Promise.all([cabUpdates([userId, hostId]), publishUpdates([{userId: hostId, event: 'notification:new', payload: {}}])]);
  return item;
}

export function listCabRequests(userId: string, flightId: string, direction: z.output<typeof cabRequestDirection>, page: number) {
  return socialRead(async (db) => {
    const member = await requireMember(db, userId, flightId);
    const blocks = await db.userBlock.findMany({where: {OR: [{blockerId: userId}, {blockedId: userId}]}, select: {blockerId: true, blockedId: true}});
    const visiblePeer = {isActive: true, userId: {notIn: blocks.map((b) => b.blockedId === userId ? b.blockerId : b.blockedId)}};
    const where: Prisma.CabRequestWhereInput = direction === 'received'
      ? {listing: {hostMembershipId: member.id}, riderMembership: visiblePeer}
      : {riderMembershipId: member.id, listing: {hostMembership: visiblePeer}};
    const rows = await db.cabRequest.findMany({where, include: requestInclude, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1});
    const items = rows.slice(0, PAGE_SIZE).map(({id, seats, status, conversationId, listing, riderMembership}) => {
      const peer = direction === 'received' ? riderMembership : listing.hostMembership;
      return {id, seats, status, conversationId, displayName: displayName(peer), flightLabel: label(peer.flight),
        listingId: listing.id, pickupArea: listing.pickupArea, listingClosed: listing.closedAt !== null};
    });
    return {items, direction, page, hasMore: rows.length > PAGE_SIZE};
  });
}

export async function changeCabRequest(userId: string, flightId: string, requestId: string, action: z.output<typeof cabRequestAction>['action']) {
  const {item, conversation, hostId, riderId, notify} = await socialWrite(async (db) => {
    const member = await requireMember(db, userId, flightId);
    const request = await db.cabRequest.findUnique({where: {id: requestId}, include: requestInclude});
    const host = request?.listing.hostMembership;
    const rider = request?.riderMembership;
    if (!request || !host?.isActive || !rider?.isActive || (action === 'withdraw' ? rider.id !== member.id : host.id !== member.id)
      || await db.userBlock.findFirst({where: blockBetween(host.userId, rider.userId), select: {id: true}})) throw missingRequest();
    const status: CabRequestStatus = action === 'accept' ? 'ACCEPTED' : action === 'decline' ? 'DECLINED' : 'WITHDRAWN';
    const ids = {hostId: host.userId, riderId: rider.userId};
    if (request.status === status) {
      const {id, seats, conversationId} = request;
      return {...ids, item: {id, seats, status, conversationId}, conversation: null, notify: false};
    }
    if (request.status !== 'PENDING' && !(action === 'withdraw' && request.status === 'ACCEPTED')) {
      throw new HttpError(409, 'CAB_REQUEST_NO_LONGER_ACTIONABLE', 'This request is no longer awaiting that action.');
    }
    let conversation = null;
    if (action === 'accept') {
      if (request.listing.closedAt) throw closed();
      if (!sameWindow(host.flight, rider.flight, request.window)) throw missingRequest();
      // Serializable transaction reads the accepted-seat aggregate and writes the new status. Concurrent
      // accepts or capacity edits that invalidate this read are retried by socialWrite before committing.
      if (request.seats > request.listing.freeSeats - await seatsTaken(db, request.listingId)) throw notEnoughSeats();
      conversation = await ensureConversation(db, userId, flightId, rider.userId, rider.flightId, true);
    }
    const item = await db.cabRequest.update({where: {id: request.id}, data: {status, ...(conversation ? {conversationId: conversation.id} : {})}, select: requestFields});
    if (action !== 'withdraw') await db.notification.create({data: {userId: rider.userId, type: action === 'accept' ? 'CAB_REQUEST_ACCEPTED' : 'CAB_REQUEST_DECLINED',
      payload: {flightId: rider.flightId, requestId: item.id, ...(conversation ? {conversationId: conversation.id} : {})},
    }});
    return {...ids, item, conversation, notify: action !== 'withdraw'};
  });
  await Promise.all([cabUpdates([hostId, riderId]), publishUpdates([
    ...(conversation ? conversationUpdates(conversation) : []), ...(notify ? [{userId: riderId, event: 'notification:new', payload: {}}] : []),
  ])]);
  return item;
}

export async function retireCabsForMembership(db: Prisma.TransactionClient, membershipId: string) {
  const listings = await db.cabListing.findMany({where: {hostMembershipId: membershipId, closedAt: null}, select: {id: true}});
  const outgoing = await db.cabRequest.findMany({where: {riderMembershipId: membershipId, status: {in: ['PENDING', 'ACCEPTED']}}, select: {
    id: true, listing: {select: {hostMembership: {select: {userId: true}}}},
  }});
  const viewers = await Promise.all(listings.map(({id}) => listingViewers(db, id)));
  await closeListings(db, listings.map(({id}) => id));
  await db.cabRequest.updateMany({where: {id: {in: outgoing.map(({id}) => id)}}, data: {status: 'WITHDRAWN'}});
  return [...new Set([...viewers.flat(), ...outgoing.map(({listing}) => listing.hostMembership.userId)])];
}