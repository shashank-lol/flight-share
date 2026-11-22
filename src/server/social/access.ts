import {Prisma} from '@prisma/client';
import {prisma} from '../db';
import {HttpError} from '../errors';
import {rideWindowSql} from '../rides';

export const conversationUnavailable = () => new HttpError(404, 'CONVERSATION_NOT_FOUND', 'This conversation is not available to you.');
export const flightUnavailable = () => new HttpError(404, 'FLIGHT_NOT_FOUND', 'This flight room is not available to you.');

// Queries including this predicate must alias the conversation table as c.
export const conversationScope = (userId: string) => Prisma.sql`
  (${userId} = c."participantOneId" OR ${userId} = c."participantTwoId")
  AND EXISTS (SELECT 1 FROM "FlightMembership" m WHERE m."flightId" = c."flightId" AND m."userId" = c."participantOneId" AND m."isActive")
  AND EXISTS (SELECT 1 FROM "FlightMembership" m WHERE m."flightId" = COALESCE(c."rideFlightId", c."flightId") AND m."userId" = c."participantTwoId" AND m."isActive")
  AND (c."rideFlightId" IS NULL OR EXISTS (
    SELECT 1 FROM "FlightMembership" m1 JOIN "Flight" f1 ON f1.id = m1."flightId"
    JOIN "Flight" f2 ON f2.id = c."rideFlightId"
    JOIN "FlightMembership" m2 ON m2."flightId" = f2.id AND m2."userId" = c."participantTwoId"
    WHERE f1.id = c."flightId" AND m1."userId" = c."participantOneId"
      AND m1."isActive" AND m2."isActive" AND m1."rideOptIn" AND m2."rideOptIn"
      AND (${rideWindowSql('f1', 'f2')})
  ))
  AND NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE
    (b."blockerId" = c."participantOneId" AND b."blockedId" = c."participantTwoId") OR
    (b."blockerId" = c."participantTwoId" AND b."blockedId" = c."participantOneId"))`;

export type ConversationRow = {id: string; flightId: string; rideFlightId: string | null; participantOneId: string; participantTwoId: string; createdAt: Date};

export async function findVisibleConversation(userId: string, id: string, db: Prisma.TransactionClient = prisma) {
  const [row] = await db.$queryRaw<ConversationRow[]>(Prisma.sql`
    SELECT c.id, c."flightId", c."rideFlightId", c."participantOneId", c."participantTwoId", c."createdAt" FROM "Conversation" c
    WHERE c.id = ${id} AND ${conversationScope(userId)}`);
  return row;
}

export async function requireConversation(db: Prisma.TransactionClient, userId: string, id: string) {
  const c = await findVisibleConversation(userId, id, db);
  if (!c) throw conversationUnavailable();
  return c;
}

export const otherParticipant = (c: ConversationRow, userId: string) => c.participantOneId === userId ? c.participantTwoId : c.participantOneId;
export const participantFlight = (c: ConversationRow, userId: string) => c.participantOneId === userId ? c.flightId : c.rideFlightId ?? c.flightId;
// Queries including this expression must alias the conversation table as c.
export const participantFlightSql = (userId: string) => Prisma.sql`(CASE WHEN c."participantOneId" = ${userId} THEN c."flightId" ELSE COALESCE(c."rideFlightId", c."flightId") END)`;

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
      if (attempt >= 3) throw new HttpError(409, 'SOCIAL_CONFLICT', 'The conversation changed. Please try again.');
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 10));
    }
  }
}