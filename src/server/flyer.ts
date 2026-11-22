import {Prisma} from '@prisma/client';
import {flyerStats} from '@/domain/flyer';
import {prisma} from './db';
import {HttpError} from './errors';
import {requireConversation, socialWrite} from './social/access';
import {publishUser} from './social/events';

export async function getFlyers(ids: string[]) {
  if (!ids.length) return new Map<string, ReturnType<typeof flyerStats>>();
  const [joined, rides] = await Promise.all([
    prisma.flightMembership.groupBy({by: ['userId'], where: {userId: {in: ids}, verificationStatus: {not: 'MOCK'}}, _count: {_all: true}}),
    prisma.$queryRaw<Array<{userId: string; rides: number; credited: number}>>(Prisma.sql`
      SELECT a."userId", COUNT(*)::int AS rides, COUNT(DISTINCT CASE WHEN c."participantOneId" = a."userId" THEN c."flightId" ELSE c."rideFlightId" END)::int AS credited
      FROM "RideConfirmation" a JOIN "Conversation" c ON c.id = a."conversationId"
      JOIN "RideConfirmation" b ON b."conversationId" = a."conversationId" AND b."userId" <> a."userId"
      JOIN "FlightMembership" m1 ON m1."flightId" = c."flightId" AND m1."userId" = c."participantOneId" AND m1."verificationStatus" <> 'MOCK'
      JOIN "FlightMembership" m2 ON m2."flightId" = c."rideFlightId" AND m2."userId" = c."participantTwoId" AND m2."verificationStatus" <> 'MOCK'
      WHERE a."userId" IN (${Prisma.join(ids)}) GROUP BY a."userId"
    `),
  ]);
  const trips = new Map(joined.map((row) => [row.userId, row._count._all]));
  const checks = new Map(rides.map((row) => [row.userId, row]));
  return new Map(ids.map((id) => [id, flyerStats(trips.get(id) ?? 0, checks.get(id)?.rides ?? 0, checks.get(id)?.credited ?? 0)]));
}

export async function rideCompletion(userId: string, conversationId: string, confirm = false) {
  const {state, peer} = await socialWrite(async (db) => {
    const c = await requireConversation(db, userId, conversationId);
    const detail = await db.conversation.findUniqueOrThrow({where: {id: conversationId}, select: {
      rideFlightId: true, flight: {select: {departureDate: true}}, rideFlight: {select: {departureDate: true}},
    }});
    if (!detail.rideFlightId || !detail.rideFlight) throw new HttpError(404, 'RIDE_NOT_FOUND', 'This is not a ride chat.');
    // Use a conservative cutoff: both local departure days must have ended anywhere in the world.
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const available = [detail.flight.departureDate, detail.rideFlight.departureDate].every((date) => date.toISOString().slice(0, 10) < cutoff);
    if (confirm && !available) throw new HttpError(409, 'RIDE_NOT_COMPLETE', 'You can confirm a ride after the departure day.');
    if (confirm) await db.rideConfirmation.upsert({where: {conversationId_userId: {conversationId, userId}}, create: {conversationId, userId}, update: {}});
    const confirmations = await db.rideConfirmation.findMany({where: {conversationId}, select: {userId: true}});
    const peer = c.participantOneId === userId ? c.participantTwoId : c.participantOneId;
    const confirmedByMe = confirmations.some((row) => row.userId === userId);
    return {peer, state: {available, confirmedByMe, confirmedByBoth: confirmedByMe && confirmations.some((row) => row.userId === peer)}};
  });
  if (confirm) await Promise.allSettled([userId, peer].map((id) => publishUser(id, 'conversation:updated', {conversationId})));
  return state;
}