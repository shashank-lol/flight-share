import type {FlightGroupMessage, Prisma} from '@prisma/client';
import {HttpError} from '../errors';
import {flightUnavailable, isFlightMember, socialRead, socialWrite} from './access';
import {publishGroupMessage} from './events';
import {before, messagePage, MESSAGE_PAGE_SIZE, recentFirst, type MessageCursor} from './message-page';

const profile = {select: {displayName: true, isAnonymous: true}} as const;
const sender = (userId: string) => ({
  blocksMade: {none: {blockedId: userId}},
  blocksReceived: {none: {blockerId: userId}},
});

async function requireMember(db: Prisma.TransactionClient, userId: string, flightId: string) {
  if (!await isFlightMember(userId, flightId, db)) throw flightUnavailable();
}

async function messageDtos(db: Prisma.TransactionClient, rows: FlightGroupMessage[], userId: string, flightId: string) {
  if (!rows.length) return [];
  // Inactive senders stay in flight history. Respect their current anonymity preferences.
  const members = await db.flightMembership.findMany({where: {flightId, userId: {in: [...new Set(rows.map((row) => row.senderId))]}}, select: {
    userId: true, alias: true, user: {select: {profile}},
  }});
  const names = new Map(members.map(({userId, alias, user}) => [userId, !user.profile || user.profile.isAnonymous ? `Anonymous Traveller · ${alias}` : user.profile.displayName]));
  return rows.map(({id, clientId, content, createdAt, senderId}) => ({
    id, flightId, content, createdAt, isOwn: senderId === userId,
    ...(senderId === userId ? {clientId} : {}),
    displayName: names.get(senderId) ?? 'Anonymous Traveller',
  }));
}

export function listGroupMessages(userId: string, flightId: string, page: number, cursor?: MessageCursor) {
  return socialRead(async (db) => {
    await requireMember(db, userId, flightId);
    const rows = await db.flightGroupMessage.findMany({
      where: {flightId, sender: sender(userId), ...(cursor ? {OR: before(cursor)} : {})},
      orderBy: [...recentFirst], take: MESSAGE_PAGE_SIZE + 1, skip: cursor ? 0 : (page - 1) * MESSAGE_PAGE_SIZE,
    });
    const batch = messagePage(rows, page);
    return {...batch, items: await messageDtos(db, batch.items, userId, flightId)};
  });
}

export async function sendGroupMessage(userId: string, flightId: string, clientId: string, content: string) {
  const {dto, sent} = await socialWrite(async (db) => {
    await requireMember(db, userId, flightId);
    const key = {flightId, senderId: userId, clientId};
    const previous = await db.flightGroupMessage.findUnique({where: {flightId_senderId_clientId: key}});
    if (previous && previous.content !== content) throw new HttpError(409, 'MESSAGE_CLIENT_ID_CONFLICT', 'This message identifier is already in use.');
    const row = previous ?? await db.flightGroupMessage.create({data: {...key, content}});
    const [dto] = await messageDtos(db, [row], userId, flightId);
    return {dto, sent: !previous};
  });
  if (sent) await publishGroupMessage(flightId, userId);
  return dto;
}