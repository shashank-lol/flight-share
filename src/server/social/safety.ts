import type {Prisma} from '@prisma/client';
import {prisma} from '../db';
import {HttpError} from '../errors';
import {audit} from '../log';
import {conversationUnavailable, otherParticipant, requireConversation, requirePeer, socialWrite} from './access';
import {publishUpdates} from './events';

async function visibilityChanged(userId: string, peerId: string, flightIds: string[]) {
  await publishUpdates([userId, peerId].flatMap((recipient) => [
    {userId: recipient, event: 'conversations:updated', payload: {}},
    ...flightIds.map((flightId) => ({userId: recipient, event: 'flight:updated', payload: {flightId}})),
  ]));
}

async function sharedActiveFlights(db: Prisma.TransactionClient, a: string, b: string) {
  const flights = await db.flightMembership.findMany({where: {userId: a, isActive: true, flight: {memberships: {some: {userId: b, isActive: true}}}}, select: {flightId: true}});
  return flights.map(({flightId}) => flightId);
}

type ResolvePeer = (db: Prisma.TransactionClient) => Promise<string>;

async function block(userId: string, resolvePeer: ResolvePeer) {
  const {peerId, flightIds} = await socialWrite(async (db) => {
    const peerId = await resolvePeer(db);
    const key = {blockerId: userId, blockedId: peerId};
    await db.userBlock.upsert({where: {blockerId_blockedId: key}, create: key, update: {}});
    return {peerId, flightIds: await sharedActiveFlights(db, userId, peerId)};
  });
  audit('passenger_blocked', userId);
  await visibilityChanged(userId, peerId, flightIds);
  return {blocked: true};
}

async function reportIncident(userId: string, resolvePeer: ResolvePeer, reason: string, description?: string) {
  const report = await socialWrite(async (db) => db.userReport.create({data: {
    reporterId: userId, reportedUserId: await resolvePeer(db), reason, description,
  }, select: {id: true, status: true}}));
  audit('passenger_reported', userId);
  return report;
}

export const blockPassenger = (userId: string, flightId: string, passengerId: string) => block(userId, (db) => requirePeer(db, userId, flightId, passengerId));

// A block must not prevent reporting an incident involving the same active flight.
export const reportPassenger = (userId: string, flightId: string, passengerId: string, reason: string, description?: string) =>
  reportIncident(userId, (db) => requirePeer(db, userId, flightId, passengerId), reason, description);

function ridePeer(userId: string, conversationId: string): ResolvePeer {
  return async (db) => {
    const conversation = await requireConversation(db, userId, conversationId);
    if (!conversation.rideFlightId) throw conversationUnavailable();
    return otherParticipant(conversation, userId);
  };
}

export const blockRidePeer = (userId: string, conversationId: string) => block(userId, ridePeer(userId, conversationId));
export const reportRidePeer = (userId: string, conversationId: string, reason: string, description?: string) =>
  reportIncident(userId, ridePeer(userId, conversationId), reason, description);

export async function listBlocks(userId: string) {
  const rows = await prisma.userBlock.findMany({where: {blockerId: userId}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 200, select: {
    id: true, createdAt: true, blocked: {select: {profile: {select: {displayName: true, isAnonymous: true}}}},
  }});
  return {items: rows.map(({id, createdAt, blocked: {profile}}) => ({id, createdAt, displayName: !profile || profile.isAnonymous ? 'Anonymous Traveller' : profile.displayName}))};
}

export async function unblockPassenger(userId: string, id: string) {
  const {peerId, flightIds} = await socialWrite(async (db) => {
    const block = await db.userBlock.findFirst({where: {id, blockerId: userId}, select: {id: true, blockedId: true}});
    if (!block) throw new HttpError(404, 'BLOCK_NOT_FOUND', 'This block is not available to you.');
    await db.userBlock.delete({where: {id: block.id}});
    return {peerId: block.blockedId, flightIds: await sharedActiveFlights(db, userId, block.blockedId)};
  });
  audit('passenger_unblocked', userId);
  await visibilityChanged(userId, peerId, flightIds);
  return {unblocked: true};
}