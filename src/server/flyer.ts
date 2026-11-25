import {Prisma} from '@prisma/client';
import {flyerStats} from '@/domain/flyer';
import {prisma} from './db';
import {HttpError} from './errors';
import {activeConversationContexts, otherParticipant, requireConversation, socialRead, socialWrite} from './social/access';
import {publishUser} from './social/events';

export async function getFlyers(ids: string[]) {
  if (!ids.length) return new Map<string, ReturnType<typeof flyerStats>>();
  const [joined, rides] = await Promise.all([
    prisma.flightMembership.groupBy({by: ['userId'], where: {userId: {in: ids}, verificationStatus: {not: 'MOCK'}}, _count: {_all: true}}),
    prisma.$queryRaw<Array<{userId: string; rides: number; credited: number}>>(Prisma.sql`
      SELECT a."userId", COUNT(*)::int AS rides,
        COUNT(DISTINCT CASE WHEN c."participantOneId" = a."userId" THEN ctx."flightOneId" ELSE ctx."flightTwoId" END)::int AS credited
      FROM "RideConfirmation" a JOIN "ConversationContext" ctx ON ctx.id = a."contextId" AND ctx.ride
      JOIN "Conversation" c ON c.id = ctx."conversationId" AND a."userId" IN (c."participantOneId", c."participantTwoId")
      JOIN "RideConfirmation" b ON b."contextId" = ctx.id AND b."userId" =
        CASE WHEN c."participantOneId" = a."userId" THEN c."participantTwoId" ELSE c."participantOneId" END
      JOIN "FlightMembership" m1 ON m1."flightId" = ctx."flightOneId" AND m1."userId" = c."participantOneId" AND m1."verificationStatus" <> 'MOCK'
      JOIN "FlightMembership" m2 ON m2."flightId" = ctx."flightTwoId" AND m2."userId" = c."participantTwoId" AND m2."verificationStatus" <> 'MOCK'
      WHERE a."userId" IN (${Prisma.join(ids)}) GROUP BY a."userId"
    `),
  ]);
  const trips = new Map(joined.map((row) => [row.userId, row._count._all]));
  const checks = new Map(rides.map((row) => [row.userId, row]));
  return new Map(ids.map((id) => [id, flyerStats(trips.get(id) ?? 0, checks.get(id)?.rides ?? 0, checks.get(id)?.credited ?? 0)]));
}

export async function rideCompletion(userId: string, conversationId: string, confirm = false, contextId?: string) {
  const {state, peer} = await (confirm ? socialWrite : socialRead)(async (db) => {
    const c = await requireConversation(db, userId, conversationId);
    const context = (await activeConversationContexts(db, c.id)).find((ctx) => ctx.ride && (!contextId || ctx.id === contextId));
    if (!context) throw new HttpError(404, 'RIDE_NOT_FOUND', 'This ride is not available to you.');
    const detail = await db.conversationContext.findUniqueOrThrow({where: {id: context.id}, select: {
      flightOne: {select: {departureDate: true}}, flightTwo: {select: {departureDate: true}},
    }});
    // Use a conservative cutoff: both local departure days must have ended anywhere in the world.
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const available = [detail.flightOne.departureDate, detail.flightTwo.departureDate].every((date) => date.toISOString().slice(0, 10) < cutoff);
    if (confirm && !available) throw new HttpError(409, 'RIDE_NOT_COMPLETE', 'You can confirm a ride after the departure day.');
    const key = {contextId: context.id, userId};
    if (confirm) await db.rideConfirmation.upsert({where: {contextId_userId: key}, create: key, update: {}});
    const confirmations = await db.rideConfirmation.findMany({where: {contextId: context.id}, select: {userId: true}});
    const peer = otherParticipant(c, userId);
    const confirmedByMe = confirmations.some((row) => row.userId === userId);
    return {peer, state: {available, confirmedByMe, confirmedByBoth: confirmedByMe && confirmations.some((row) => row.userId === peer)}};
  });
  if (confirm) await Promise.allSettled([userId, peer].map((id) => publishUser(id, 'conversation:updated', {conversationId})));
  return state;
}