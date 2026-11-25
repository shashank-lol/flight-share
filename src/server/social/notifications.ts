import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {HttpError} from '../errors';
import {conversationScope, socialRead, socialWrite} from './access';
import {publishUpdates} from './events';

const PAGE_SIZE = 30;
const messagePayload = z.object({conversationId: z.uuid()});
const flightPayload = z.object({flightId: z.uuid()});
const cabPayload = flightPayload.extend({conversationId: z.uuid().optional()});
const scope = (userId: string) => Prisma.sql`n."userId" = ${userId} AND (
  (n.type = 'NEW_MESSAGE' AND EXISTS (
    SELECT 1 FROM "Conversation" c WHERE c.id = n.payload->>'conversationId' AND ${conversationScope(userId)}
  )) OR (n.type IN ('NEW_PASSENGER', 'BAGGAGE_MATCH', 'BAGGAGE_REQUEST_RECEIVED', 'BAGGAGE_REQUEST_ACCEPTED') AND EXISTS (
    SELECT 1 FROM "FlightMembership" m WHERE m."userId" = ${userId} AND m."flightId" = n.payload->>'flightId' AND m."isActive"
  )) OR (n.type IN ('CAB_REQUEST_RECEIVED', 'CAB_REQUEST_ACCEPTED', 'CAB_REQUEST_DECLINED') AND EXISTS (
    SELECT 1 FROM "CabRequest" r JOIN "CabListing" l ON l.id = r."listingId"
    JOIN "FlightMembership" host ON host.id = l."hostMembershipId" AND host."isActive"
    JOIN "FlightMembership" rider ON rider.id = r."riderMembershipId" AND rider."isActive"
    WHERE r.id = n.payload->>'requestId' AND (
      (n.type = 'CAB_REQUEST_RECEIVED' AND host."userId" = ${userId} AND host."flightId" = n.payload->>'flightId') OR
      (n.type <> 'CAB_REQUEST_RECEIVED' AND rider."userId" = ${userId} AND rider."flightId" = n.payload->>'flightId')
    ) AND NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE
      (b."blockerId" = host."userId" AND b."blockedId" = rider."userId") OR
      (b."blockerId" = rider."userId" AND b."blockedId" = host."userId"))
  ))
)`;

type Notice = {id: string; type: string; payload: unknown; readAt: Date | null; createdAt: Date};

export function listNotifications(userId: string, page: number) {
  return socialRead(async (db) => {
    const where = scope(userId);
    const [rows, [{count}]] = await Promise.all([
      db.$queryRaw<Notice[]>(Prisma.sql`SELECT n.id, n.type, n.payload, n."readAt", n."createdAt"
        FROM "Notification" n WHERE ${where} ORDER BY n."createdAt" DESC, n.id DESC
        LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`),
      db.$queryRaw<{count: bigint}[]>(Prisma.sql`SELECT count(*) AS count FROM "Notification" n WHERE ${where} AND n."readAt" IS NULL`),
    ]);
    return {items: rows.slice(0, PAGE_SIZE).flatMap((row) => {
      const payload = (row.type === 'NEW_MESSAGE' ? messagePayload : row.type.startsWith('CAB_REQUEST_') ? cabPayload : flightPayload).safeParse(row.payload);
      return payload.success ? [{...row, payload: payload.data}] : [];
    }), page, hasMore: rows.length > PAGE_SIZE, unreadCount: Number(count)};
  });
}

export async function readNotifications(userId: string, id?: string) {
  const updated = await socialWrite(async (db) => {
    const where = scope(userId);
    if (id) {
      const [found] = await db.$queryRaw<{id: string}[]>(Prisma.sql`SELECT n.id FROM "Notification" n WHERE ${where} AND n.id = ${id}`);
      if (!found) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'This notification is not available to you.');
    }
    return db.$executeRaw(Prisma.sql`UPDATE "Notification" n SET "readAt" = ${new Date()}
      WHERE ${where} AND n."readAt" IS NULL ${id ? Prisma.sql`AND n.id = ${id}` : Prisma.empty}`);
  });
  if (updated) await publishUpdates([{userId, event: 'notification:new', payload: {}}]);
  return {updated};
}