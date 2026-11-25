import {Prisma, type Conversation, type ConversationContext} from '@prisma/client';
import {prisma} from '../db';
import {HttpError} from '../errors';

export const conversationUnavailable = () => new HttpError(404, 'CONVERSATION_NOT_FOUND', 'This conversation is not available to you.');
export const flightUnavailable = () => new HttpError(404, 'FLIGHT_NOT_FOUND', 'This flight room is not available to you.');

// A context is valid only when both participants still belong to its respective flights.
// Ride matching, listing capacity and opt-in are checked at authorization, not on later access.
const activeContext = Prisma.sql`
  ctx."conversationId" = c.id
  AND EXISTS (SELECT 1 FROM "FlightMembership" m WHERE m."flightId" = ctx."flightOneId" AND m."userId" = c."participantOneId" AND m."isActive")
  AND EXISTS (SELECT 1 FROM "FlightMembership" m WHERE m."flightId" = ctx."flightTwoId" AND m."userId" = c."participantTwoId" AND m."isActive")`;

const viewerFlight = (userId: string) => Prisma.sql`
  (CASE WHEN c."participantOneId" = ${userId} THEN ctx."flightOneId" ELSE ctx."flightTwoId" END)`;

// Queries including this predicate must alias the conversation table as c.
export const conversationScope = (userId: string, flightId?: string) => Prisma.sql`
  (${userId} = c."participantOneId" OR ${userId} = c."participantTwoId")
  AND EXISTS (SELECT 1 FROM "ConversationContext" ctx WHERE ${activeContext}
    ${flightId ? Prisma.sql`AND ${viewerFlight(userId)} = ${flightId}` : Prisma.empty})
  AND NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE
    (b."blockerId" = c."participantOneId" AND b."blockedId" = c."participantTwoId") OR
    (b."blockerId" = c."participantTwoId" AND b."blockedId" = c."participantOneId"))`;

export async function findVisibleConversation(userId: string, id: string, db: Prisma.TransactionClient = prisma) {
  const [row] = await db.$queryRaw<Conversation[]>(Prisma.sql`
    SELECT c.id, c."participantOneId", c."participantTwoId", c."createdAt" FROM "Conversation" c
    WHERE c.id = ${id} AND ${conversationScope(userId)}`);
  return row;
}

export async function requireConversation(db: Prisma.TransactionClient, userId: string, id: string) {
  const c = await findVisibleConversation(userId, id, db);
  if (!c) throw conversationUnavailable();
  return c;
}

export const otherParticipant = (c: Conversation, userId: string) => c.participantOneId === userId ? c.participantTwoId : c.participantOneId;

export const participantFlight = (c: Conversation, context: ConversationContext, userId: string) =>
  c.participantOneId === userId ? context.flightOneId : context.flightTwoId;

// Call after requireConversation or with a thread already authorized in this transaction.
export function activeConversationContexts(db: Prisma.TransactionClient, conversationId: string) {
  return db.$queryRaw<ConversationContext[]>(Prisma.sql`
    SELECT ctx.* FROM "Conversation" c JOIN "ConversationContext" ctx ON ${activeContext}
    WHERE c.id = ${conversationId} ORDER BY ctx.ride DESC, ctx."createdAt" DESC, ctx.id DESC`);
}

// Includes inactive contexts so both participants can invalidate cached visibility after a leave.
export async function conversationCounterparts(userId: string, flightId: string, db: Prisma.TransactionClient = prisma) {
  const rows = await db.$queryRaw<{peerId: string}[]>(Prisma.sql`
    SELECT c."participantTwoId" AS "peerId" FROM "ConversationContext" ctx JOIN "Conversation" c ON c.id = ctx."conversationId"
    WHERE c."participantOneId" = ${userId} AND ctx."flightOneId" = ${flightId}
    UNION
    SELECT c."participantOneId" AS "peerId" FROM "ConversationContext" ctx JOIN "Conversation" c ON c.id = ctx."conversationId"
    WHERE c."participantTwoId" = ${userId} AND ctx."flightTwoId" = ${flightId}`);
  return [userId, ...rows.map(({peerId}) => peerId)];
}

export function isFlightMember(userId: string, flightId: string, db: Prisma.TransactionClient = prisma) {
  return db.flightMembership.findFirst({where: {flightId, userId, isActive: true}, select: {id: true}});
}

export const peerUnavailable = () => new HttpError(404, 'PASSENGER_NOT_FOUND', 'This passenger is not available in this flight room.');

export async function requirePeer(db: Prisma.TransactionClient, userId: string, flightId: string, passengerId: string) {
  if (!await isFlightMember(userId, flightId, db)) throw peerUnavailable();
  const peer = await db.flightMembership.findFirst({where: {id: passengerId, flightId, isActive: true, userId: {not: userId}}, select: {userId: true}});
  if (!peer) throw peerUnavailable();
  return peer.userId;
}

export function blockBetween(a: string, b: string) {
  return {OR: [{blockerId: a, blockedId: b}, {blockerId: b, blockedId: a}]};
}

export function socialRead<T>(read: (db: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(read, {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead});
}

export async function socialWrite<T>(write: (db: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(write, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error;
      if (attempt >= 7) throw new HttpError(409, 'SOCIAL_CONFLICT', 'The details changed while saving. Please try again.');
      const delay = Math.min(25 * 2 ** attempt, 400);
      await new Promise((resolve) => setTimeout(resolve, delay / 2 + Math.random() * delay));
    }
  }
}