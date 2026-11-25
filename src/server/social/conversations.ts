import {Prisma, type Conversation, type Message} from '@prisma/client';
import {HttpError} from '../errors';
import {activeConversationContexts, blockBetween, conversationScope, conversationUnavailable, flightUnavailable, isFlightMember, otherParticipant, participantFlight, peerUnavailable, requireConversation, requirePeer, socialRead, socialWrite} from './access';
import {publishUpdates} from './events';
import {before, messagePage, MESSAGE_PAGE_SIZE, recentFirst, type MessageCursor} from './message-page';

const PAGE_SIZE = 30;
function messageDto(m: Message, userId: string) {
  return {id: m.id, conversationId: m.conversationId, clientId: m.clientId, content: m.content, isOwn: m.senderId === userId, createdAt: m.createdAt, readAt: m.readAt};
}

async function conversationDto(db: Prisma.TransactionClient, c: Conversation, userId: string, flightId?: string) {
  const peerId = otherParticipant(c, userId);
  const contexts = (await activeConversationContexts(db, c.id)).map((context) => ({
    id: context.id, flightId: participantFlight(c, context, userId), peerFlightId: participantFlight(c, context, peerId), ride: context.ride,
  }));
  const context = flightId ? contexts.find((item) => item.flightId === flightId) : contexts[0];
  if (!context) throw conversationUnavailable();
  const [member, lastMessage, unreadCount] = await Promise.all([
    db.flightMembership.findUniqueOrThrow({where: {flightId_userId: {flightId: context.peerFlightId, userId: peerId}}, select: {
      id: true, alias: true, user: {select: {profile: {select: {displayName: true, isAnonymous: true}}}},
    }}),
    db.message.findFirst({where: {conversationId: c.id}, orderBy: [...recentFirst]}),
    db.message.count({where: {conversationId: c.id, senderId: peerId, readAt: null}}),
  ]);
  const profile = member.user.profile;
  const isAnonymous = profile?.isAnonymous ?? true;
  return {id: c.id, flightId: context.flightId, rideFlightId: context.ride ? context.peerFlightId : null, contexts, createdAt: c.createdAt, participant: {
    id: member.id, displayName: isAnonymous || !profile ? `Anonymous Traveller · ${member.alias}` : profile.displayName, isAnonymous,
  }, lastMessage: lastMessage ? messageDto(lastMessage, userId) : null, unreadCount};
}

export function conversationUpdates(c: Conversation) {
  return [c.participantOneId, c.participantTwoId].map((userId) => ({userId, event: 'conversation:updated', payload: {conversationId: c.id}}));
}

// Only call inside a transaction after authorizing the same-flight, baggage, or cab workflow.
// Recheck safety here, regardless of what the caller checked while granting the context.
export async function ensureConversation(db: Prisma.TransactionClient, userId: string, fromFlightId: string, peerId: string, peerFlightId: string, ride = false): Promise<Conversation> {
  if (peerId === userId || (!ride && fromFlightId !== peerFlightId)) throw peerUnavailable();
  const [member, peer, block] = await Promise.all([
    isFlightMember(userId, fromFlightId, db),
    isFlightMember(peerId, peerFlightId, db),
    db.userBlock.findFirst({where: blockBetween(userId, peerId), select: {id: true}}),
  ]);
  if (!member || !peer || block) throw peerUnavailable();

  const [participantOneId, participantTwoId] = [userId, peerId].sort();
  const pair = {participantOneId, participantTwoId};
  const c = await db.conversation.upsert({where: {participantOneId_participantTwoId: pair}, create: pair, update: {}});
  const [flightOneId, flightTwoId] = participantOneId === userId ? [fromFlightId, peerFlightId] : [peerFlightId, fromFlightId];
  const key = {conversationId: c.id, flightOneId, flightTwoId};
  await db.conversationContext.upsert({where: {conversationId_flightOneId_flightTwoId: key}, create: {...key, ride}, update: ride ? {ride: true} : {}});
  return c;
}

export async function openConversation(userId: string, flightId: string, passengerId: string) {
  const {c, dto} = await socialWrite(async (db) => {
    const peerId = await requirePeer(db, userId, flightId, passengerId);
    const c = await ensureConversation(db, userId, flightId, peerId, flightId);
    return {c, dto: await conversationDto(db, c, userId, flightId)};
  });
  await publishUpdates(conversationUpdates(c));
  return dto;
}

export function getConversation(userId: string, id: string) {
  return socialRead(async (db) => conversationDto(db, await requireConversation(db, userId, id), userId));
}

export function listConversations(userId: string, page: number, flightId?: string) {
  return socialRead(async (db) => {
    if (flightId && !await isFlightMember(userId, flightId, db)) throw flightUnavailable();
    const rows = await db.$queryRaw<Conversation[]>(Prisma.sql`
      SELECT c.id, c."participantOneId", c."participantTwoId", c."createdAt"
      FROM "Conversation" c
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m WHERE m."conversationId" = c.id
        ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1
      ) recent ON true
      WHERE ${conversationScope(userId, flightId)}
      ORDER BY COALESCE(recent."createdAt", c."createdAt") DESC, c.id DESC
      LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`);
    const items = await Promise.all(rows.slice(0, PAGE_SIZE).map((row) => conversationDto(db, row, userId, flightId)));
    return {items, page, hasMore: rows.length > PAGE_SIZE};
  });
}

export function listMessages(userId: string, conversationId: string, page: number, cursor?: MessageCursor) {
  return socialRead(async (db) => {
    await requireConversation(db, userId, conversationId);
    const rows = await db.message.findMany({where: {conversationId, ...(cursor ? {OR: before(cursor)} : {})}, orderBy: [...recentFirst], take: MESSAGE_PAGE_SIZE + 1, skip: cursor ? 0 : (page - 1) * MESSAGE_PAGE_SIZE});
    const batch = messagePage(rows, page);
    return {...batch, items: batch.items.map((m) => messageDto(m, userId))};
  });
}

export async function sendMessage(userId: string, conversationId: string, clientId: string, content: string) {
  const {m, c, sent} = await socialWrite(async (db) => {
    const c = await requireConversation(db, userId, conversationId);
    const key = {conversationId, senderId: userId, clientId};
    const previous = await db.message.findUnique({where: {conversationId_senderId_clientId: key}});
    if (previous) {
      if (previous.content !== content) throw new HttpError(409, 'MESSAGE_CLIENT_ID_CONFLICT', 'This message identifier is already in use.');
      return {m: previous, c, sent: false};
    }
    const m = await db.message.create({data: {...key, content}});
    const peerId = otherParticipant(c, userId);
    await db.notification.create({data: {userId: peerId, type: 'NEW_MESSAGE', payload: {conversationId}}});
    return {m, c, sent: true};
  });
  if (sent) await publishUpdates([...conversationUpdates(c), {userId: otherParticipant(c, userId), event: 'notification:new', payload: {}}]);
  return messageDto(m, userId);
}

export async function readConversation(userId: string, conversationId: string, messageId?: string) {
  const {c, count} = await socialWrite(async (db) => {
    const c = await requireConversation(db, userId, conversationId);
    const through = messageId ? await db.message.findFirst({where: {id: messageId, conversationId}, select: {id: true, createdAt: true}}) : null;
    if (messageId && !through) throw conversationUnavailable();
    const {count} = await db.message.updateMany({where: {conversationId, senderId: otherParticipant(c, userId), readAt: null,
      ...(through ? {OR: [{createdAt: {lt: through.createdAt}}, {createdAt: through.createdAt, id: {lte: through.id}}]} : {}),
    }, data: {readAt: new Date()}});
    return {c, count};
  });
  if (count) await publishUpdates(conversationUpdates(c));
  return {updated: count};
}