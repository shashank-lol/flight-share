import {Prisma} from '@prisma/client';
import {localDate} from '@/domain/flights';
import {prisma} from './db';
import {HttpError} from './errors';
import {getFlyers} from './flyer';
import {publishUser} from './social/events';

type Alias = 'fromFlight' | 'otherFlight' | 'f1' | 'f2' | 'origin' | 'destination';
const aliases: Record<Alias, Prisma.Sql> = {
  fromFlight: Prisma.sql`fromFlight`, otherFlight: Prisma.sql`otherFlight`, f1: Prisma.sql`f1`, f2: Prisma.sql`f2`,
  origin: Prisma.sql`origin`, destination: Prisma.sql`destination`,
};
const moment = (alias: Alias) => Prisma.sql`(${aliases[alias]}."departureDate" + ${aliases[alias]}."departureTime"::time)`;
export function rideWindowSql(a: Alias, b: Alias) {
  return Prisma.sql`(${aliases[a]}."departureAirport" = ${aliases[b]}."departureAirport"
    AND ${aliases[b]}."departureDate" BETWEEN ${aliases[a]}."departureDate" - 1 AND ${aliases[a]}."departureDate" + 1
    AND ${moment(b)} BETWEEN ${moment(a)} - INTERVAL '20 minutes' AND ${moment(a)} + INTERVAL '20 minutes')`;
}
const notBlocked = (userId: string) => Prisma.sql`NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE
  (b."blockerId" = ${userId} AND b."blockedId" = peer."userId") OR (b."blockedId" = ${userId} AND b."blockerId" = peer."userId"))`;
const fromQuery = (userId: string, flightId: string) => Prisma.sql`
  FROM "FlightMembership" viewer JOIN "Flight" origin ON origin.id = viewer."flightId"
  JOIN "Flight" destination ON ${rideWindowSql('origin', 'destination')}
  JOIN "FlightMembership" peer ON peer."flightId" = destination.id AND peer."isActive" AND peer."rideOptIn"
  JOIN "PassengerProfile" p ON p."userId" = peer."userId"
  WHERE viewer."userId" = ${userId} AND viewer."flightId" = ${flightId} AND viewer."isActive" AND viewer."rideOptIn"
  AND peer."userId" <> ${userId} AND ${notBlocked(userId)}
`;

type RideRow = {id: string; userId: string; showFlyer: boolean; displayName: string; alias: string; partySize: number; pickupArea: string | null; departureTime: string; departureDate: Date; flightLabel: string; minutesApart: number};
const missingRoom = () => new HttpError(404, 'FLIGHT_NOT_FOUND', 'This flight room is not available to you.');
const unavailable = () => new HttpError(404, 'RIDE_UNAVAILABLE', 'This traveller is no longer available for this ride match.');

export async function requireRidePeer(db: Prisma.TransactionClient, userId: string, passengerId: string, fromFlightId: string) {
  const [peer] = await db.$queryRaw<{peerUserId: string; peerFlightId: string}[]>(Prisma.sql`
    SELECT peer."userId" AS "peerUserId", peer."flightId" AS "peerFlightId" ${fromQuery(userId, fromFlightId)}
    AND peer.id = ${passengerId} AND origin."departureDate" >= ${localDate(-1)}::date LIMIT 1
  `);
  if (!peer) throw unavailable();
  return peer;
}

export async function listRides(userId: string, flightId: string, page: number) {
  const membership = await prisma.flightMembership.findFirst({where: {userId, flightId, isActive: true}, select: {rideOptIn: true, flight: {select: {departureDate: true, departureTime: true}}}});
  if (!membership) throw missingRoom();
  const state = !membership.rideOptIn ? 'OPT_IN_REQUIRED' : !membership.flight.departureTime ? 'MISSING_TIME' : membership.flight.departureDate.toISOString().slice(0, 10) < localDate(-1) ? 'EXPIRED' : 'READY';
  if (state !== 'READY') return {items: [], page, hasMore: false, eligibility: state};
  const limit = 24;
  const rows = await prisma.$queryRaw<RideRow[]>(Prisma.sql`
    SELECT peer.id, peer."userId", p."showFlyer", CASE WHEN p."isAnonymous" THEN peer.alias ELSE p."displayName" END AS "displayName",
      peer.alias, peer."partySize", peer."pickupArea", destination."departureTime", destination."departureDate",
      destination.airline || ' ' || destination."flightNumber" AS "flightLabel", ABS(EXTRACT(EPOCH FROM ${moment('destination')} - ${moment('origin')}) / 60)::int AS "minutesApart"
    ${fromQuery(userId, flightId)}
    ORDER BY "minutesApart", peer.id LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}
  `);
  const visible = rows.slice(0, limit);
  const flyers = await getFlyers(visible.filter((row) => row.showFlyer).map((row) => row.userId));
  return {items: visible.map(({userId, showFlyer, departureDate, ...row}) => ({...row, departureDate: departureDate.toISOString().slice(0, 10), flyer: showFlyer ? flyers.get(userId) ?? null : null})), page, hasMore: rows.length > limit, eligibility: state};
}

export async function updateRideSettings(userId: string, flightId: string, value: {partySize: number; rideOptIn: boolean; pickupArea?: string | null; departureTime?: string}) {
  const {departureTime, pickupArea, ...preferences} = value;
  const counterpartIds = await prisma.$transaction(async (db) => {
    const membership = await db.flightMembership.updateMany({where: {flightId, userId, isActive: true}, data: {...preferences, pickupArea: preferences.rideOptIn ? pickupArea ?? null : null}});
    if (!membership.count) throw missingRoom();
    if (departureTime) await db.flight.updateMany({where: {id: flightId, departureTime: null}, data: {departureTime}});
    return rideCounterparts(userId, flightId, db);
  });
  await Promise.allSettled(counterpartIds.map((id) => publishUser(id, 'conversations:updated', {})));
  return {saved: true};
}

export async function rideCounterparts(userId: string, flightId: string, db: Prisma.TransactionClient = prisma) {
  const rows = await db.conversation.findMany({where: {rideFlightId: {not: null}, OR: [{flightId, participantOneId: userId}, {rideFlightId: flightId, participantTwoId: userId}]}, select: {participantOneId: true, participantTwoId: true}});
  return Array.from(new Set([userId, ...rows.map((row) => row.participantOneId === userId ? row.participantTwoId : row.participantOneId)]));
}