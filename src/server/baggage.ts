import {Prisma, type BaggageRequest, type Conversation, type FlightMembership} from '@prisma/client';
import {matchDisclaimer, potentialMatch, remainingWeight} from '@/domain/baggage';
import {HttpError} from './errors';
import {blockBetween, flightUnavailable, socialRead, socialWrite} from './social/access';
import {conversationUpdates, ensureConversation} from './social/conversations';
import {publishUpdates} from './social/events';

const PAGE_SIZE = 24;
const openStatuses = ['PENDING', 'ACCEPTED'] as const;
const memberSelect = {
  id: true, userId: true, alias: true, flightId: true, baggageReported: true, baggageAllowance: true, expectedBaggageWeight: true, cabinBaggage: true,
  user: {select: {profile: {select: {showBaggage: true, isAnonymous: true, displayName: true}}}},
} satisfies Prisma.FlightMembershipSelect;
type Member = Prisma.FlightMembershipGetPayload<{select: typeof memberSelect}>;
const requestSelect = {senderMembership: {select: memberSelect}, recipientMembership: {select: memberSelect}};
type Request = Prisma.BaggageRequestGetPayload<{include: typeof requestSelect}>;
type Action = 'accept' | 'decline' | 'withdraw' | 'end';
type Eligibility = 'READY' | 'MISSING_BAGGAGE' | 'PRIVATE' | 'BALANCED' | 'MATCHED';

export function baggageDto(m: Pick<FlightMembership, 'baggageReported' | 'baggageAllowance' | 'expectedBaggageWeight' | 'cabinBaggage'>) {
  return {baggageReported: m.baggageReported, baggageAllowance: Number(m.baggageAllowance), expectedBaggageWeight: Number(m.expectedBaggageWeight), cabinBaggage: m.cabinBaggage};
}

const balance = (m: Member) => remainingWeight(Number(m.baggageAllowance), Number(m.expectedBaggageWeight));
const participates = (m: Member) => m.baggageReported && m.user.profile?.showBaggage;
const complementary = (a: Member, b: Member) => participates(a) && participates(b) && !!potentialMatch(balance(a), balance(b));
const displayName = (m: Pick<Member, 'alias' | 'user'>) => {
  const profile = m.user.profile;
  return !profile || profile.isAnonymous ? `Anonymous Traveller · ${m.alias}` : profile.displayName;
};
const requestUnavailable = () => new HttpError(404, 'BAGGAGE_REQUEST_NOT_FOUND', 'This baggage request is not available to you.');
const matchUnavailable = () => new HttpError(404, 'BAGGAGE_MATCH_NOT_AVAILABLE', 'This potential baggage match is no longer available.');
const invalidAction = () => new HttpError(409, 'BAGGAGE_REQUEST_CHANGED', 'This action is not available for the current baggage request.');
const involving = (ids: string[]): Prisma.BaggageRequestWhereInput => ({OR: [{senderMembershipId: {in: ids}}, {recipientMembershipId: {in: ids}}]});
const otherMember = (r: Request, memberId: string) => r.senderMembershipId === memberId ? r.recipientMembership : r.senderMembership;
const statusDto = ({id, status, conversationId}: BaggageRequest) => ({id, status, conversationId});

async function activeMember(db: Prisma.TransactionClient, flightId: string, userId: string) {
  const member = await db.flightMembership.findFirst({where: {flightId, userId, isActive: true}, select: memberSelect});
  if (!member) throw flightUnavailable();
  return member;
}

export function getOwnBaggage(flightId: string, userId: string) {
  return socialRead(async (db) => baggageDto(await activeMember(db, flightId, userId)));
}

export function matches(flightId: string, userId: string, page: number) {
  return socialRead(async (db) => {
    const member = await activeMember(db, flightId, userId);
    const sides = [{senderMembershipId: member.id, recipientMembership: {isActive: true}}, {recipientMembershipId: member.id, senderMembership: {isActive: true}}];
    const [reservation, blocks] = await Promise.all([
      db.baggageReservation.findUnique({where: {membershipId: member.id}, select: {membershipId: true}}),
      db.userBlock.findMany({where: {OR: [{blockerId: userId}, {blockedId: userId}]}, select: {blockerId: true, blockedId: true}}),
    ]);
    const blocked = blocks.map(({blockerId, blockedId}) => blockerId === userId ? blockedId : blockerId);
    const rows = await db.baggageRequest.findMany({where: {
      flightId, status: {in: [...openStatuses]}, OR: sides,
      senderMembership: {userId: {notIn: blocked}}, recipientMembership: {userId: {notIn: blocked}},
    }, include: requestSelect, orderBy: [{createdAt: 'desc'}, {id: 'desc'}]});
    const requests = rows.map((r) => ({id: r.id, status: r.status, conversationId: r.conversationId,
      direction: r.senderMembershipId === member.id ? 'OUTGOING' as const : 'INCOMING' as const, displayName: displayName(otherMember(r, member.id)),
    }));
    const ownBalance = balance(member);
    const eligibility: Eligibility = reservation ? 'MATCHED' : !member.baggageReported ? 'MISSING_BAGGAGE' : !member.user.profile?.showBaggage ? 'PRIVATE' : ownBalance === 0 ? 'BALANCED' : 'READY';
    const result = {requests, baggage: baggageDto(member), eligibility, disclaimer: matchDisclaimer, page};
    if (eligibility !== 'READY') return {...result, items: [], hasMore: false};

    const candidates = await db.$queryRaw<{id: string; alias: string; isAnonymous: boolean; displayName: string; balance: Prisma.Decimal}[]>(Prisma.sql`
      SELECT m.id, m.alias, p."isAnonymous", p."displayName", m."baggageAllowance" - m."expectedBaggageWeight" AS balance
      FROM "FlightMembership" m JOIN "PassengerProfile" p ON p."userId" = m."userId"
      WHERE m."flightId" = ${flightId} AND m."isActive" AND m."baggageReported" AND p."showBaggage" AND m.id <> ${member.id}
        AND ${ownBalance < 0 ? Prisma.sql`m."baggageAllowance" > m."expectedBaggageWeight"` : Prisma.sql`m."baggageAllowance" < m."expectedBaggageWeight"`}
        AND NOT EXISTS (SELECT 1 FROM "BaggageReservation" br WHERE br."membershipId" = m.id)
        AND NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE
          (b."blockerId" = ${userId} AND b."blockedId" = m."userId") OR (b."blockedId" = ${userId} AND b."blockerId" = m."userId"))
        AND NOT EXISTS (SELECT 1 FROM "BaggageRequest" r WHERE r.status = 'PENDING' AND (
          (r."senderMembershipId" = ${member.id} AND r."recipientMembershipId" = m.id) OR (r."recipientMembershipId" = ${member.id} AND r."senderMembershipId" = m.id)))
      ORDER BY LEAST(ABS(m."baggageAllowance" - m."expectedBaggageWeight"), ${Math.abs(ownBalance)}::numeric) DESC, m.id
      LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`);
    const items = candidates.slice(0, PAGE_SIZE).flatMap((peer) => {
      const match = potentialMatch(ownBalance, Number(peer.balance));
      return match ? [{passengerId: peer.id, displayName: peer.isAnonymous ? `Anonymous Traveller · ${peer.alias}` : peer.displayName, ...match}] : [];
    });
    return {...result, items, hasMore: candidates.length > PAGE_SIZE};
  });
}

async function available(db: Prisma.TransactionClient, a: Member, b: Member) {
  if (!complementary(a, b) || await db.baggageReservation.findFirst({where: {membershipId: {in: [a.id, b.id]}}, select: {membershipId: true}})) throw matchUnavailable();
}

async function notice(db: Prisma.TransactionClient, flightId: string, userIds: string[], type: 'BAGGAGE_REQUEST_RECEIVED' | 'BAGGAGE_REQUEST_ACCEPTED') {
  await db.notification.createMany({data: userIds.map((userId) => ({userId, type, payload: {flightId}}))});
}

async function accept(db: Prisma.TransactionClient, request: BaggageRequest, a: Member, b: Member) {
  await available(db, a, b);
  // Both reservations are created in the same serializable transaction. Their primary key
  // prevents a person being accepted via two different requests, in either direction.
  const membershipIds = [a.id, b.id].sort();
  await db.baggageReservation.createMany({data: membershipIds.map((membershipId) => ({membershipId, requestId: request.id}))});
  const c = await ensureConversation(db, a.userId, a.flightId, b.userId, b.flightId);
  const r = await db.baggageRequest.update({where: {id: request.id}, data: {status: 'ACCEPTED', conversationId: c.id}});
  await db.baggageRequest.updateMany({where: {id: {not: r.id}, status: 'PENDING', ...involving(membershipIds)}, data: {status: 'CANCELLED'}});
  await notice(db, r.flightId, [a.userId, b.userId], 'BAGGAGE_REQUEST_ACCEPTED');
  return {r, c};
}

export async function baggageRoomRecipients(db: Prisma.TransactionClient, flightId: string) {
  return (await db.flightMembership.findMany({where: {flightId, isActive: true}, select: {userId: true}})).map(({userId}) => userId);
}

export async function baggageRoomUpdates(db: Prisma.TransactionClient, flightIds: string[]) {
  return (await Promise.all(flightIds.map(async (flightId) =>
    (await baggageRoomRecipients(db, flightId)).map((userId) => ({userId, event: 'flight:updated', payload: {flightId}}))))).flat();
}

export async function requestBaggage(userId: string, flightId: string, passengerId: string) {
  const {r, c, recipients, notified} = await socialWrite(async (db) => {
    const a = await activeMember(db, flightId, userId);
    const b = await db.flightMembership.findFirst({where: {id: passengerId, flightId, isActive: true, userId: {not: userId}}, select: memberSelect});
    if (!b || await db.userBlock.findFirst({where: blockBetween(userId, b.userId), select: {id: true}})) throw matchUnavailable();
    const previous = await db.baggageRequest.findFirst({where: {flightId, status: {in: [...openStatuses]}, OR: [
      {senderMembershipId: a.id, recipientMembershipId: b.id}, {senderMembershipId: b.id, recipientMembershipId: a.id},
    ]}});
    if (previous) {
      if (previous.status === 'ACCEPTED' || previous.senderMembershipId === a.id) return {r: previous, c: undefined, recipients: [], notified: []};
      const accepted = await accept(db, previous, a, b);
      return {...accepted, recipients: await baggageRoomRecipients(db, flightId), notified: [a.userId, b.userId]};
    }
    await available(db, a, b);
    const r = await db.baggageRequest.create({data: {flightId, senderMembershipId: a.id, recipientMembershipId: b.id}});
    await notice(db, flightId, [b.userId], 'BAGGAGE_REQUEST_RECEIVED');
    return {r, c: undefined, recipients: [a.userId, b.userId], notified: [b.userId]};
  });
  await updateClients(flightId, recipients, notified, c);
  return statusDto(r);
}

async function updateClients(flightId: string, recipients: string[], notified: string[], c?: Conversation) {
  await publishUpdates([
    ...recipients.map((userId) => ({userId, event: 'flight:updated', payload: {flightId}})),
    ...notified.map((userId) => ({userId, event: 'notification:new', payload: {}})),
    ...(c ? conversationUpdates(c) : []),
  ]);
}

export async function changeBaggageRequest(userId: string, flightId: string, requestId: string, action: Action) {
  const {r, c, recipients, notified} = await socialWrite(async (db) => {
    const a = await activeMember(db, flightId, userId);
    const request = await db.baggageRequest.findFirst({where: {
      id: requestId, flightId, ...involving([a.id]), senderMembership: {isActive: true}, recipientMembership: {isActive: true},
    }, include: requestSelect});
    if (!request) throw requestUnavailable();
    const b = otherMember(request, a.id);
    if (await db.userBlock.findFirst({where: blockBetween(userId, b.userId), select: {id: true}})) throw requestUnavailable();
    const outgoing = a.id === request.senderMembershipId;
    const terminal = {accept: 'ACCEPTED', decline: 'DECLINED', withdraw: 'WITHDRAWN', end: 'ENDED'} as const;
    if ((action === 'withdraw' && !outgoing) || ((action === 'accept' || action === 'decline') && outgoing)) throw invalidAction();
    if (request.status === terminal[action]) return {r: request, c: undefined, recipients: [], notified: []};
    if (action === 'end' ? request.status !== 'ACCEPTED' : request.status !== 'PENDING') throw invalidAction();
    if (action === 'accept') {
      const accepted = await accept(db, request, a, b);
      return {...accepted, recipients: await baggageRoomRecipients(db, flightId), notified: [a.userId, b.userId]};
    }
    const r = await db.baggageRequest.update({where: {id: requestId}, data: {status: terminal[action], conversationId: null}});
    if (action === 'end') await db.baggageReservation.deleteMany({where: {requestId}});
    return {r, c: undefined, recipients: action === 'end' ? await baggageRoomRecipients(db, flightId) : [a.userId, b.userId], notified: []};
  });
  await updateClients(flightId, recipients, notified, c);
  return statusDto(r);
}

async function retire(db: Prisma.TransactionClient, scope: Prisma.BaggageRequestWhereInput) {
  const rows = await db.baggageRequest.findMany({where: {AND: [scope, {status: {in: [...openStatuses]}}]}, select: {id: true, status: true, flightId: true}});
  const accepted = rows.filter(({status}) => status === 'ACCEPTED').map(({id}) => id);
  if (accepted.length) {
    await db.baggageRequest.updateMany({where: {id: {in: accepted}}, data: {status: 'ENDED', conversationId: null}});
    await db.baggageReservation.deleteMany({where: {requestId: {in: accepted}}});
  }
  const pending = rows.filter(({status}) => status === 'PENDING').map(({id}) => id);
  if (pending.length) await db.baggageRequest.updateMany({where: {id: {in: pending}}, data: {status: 'CANCELLED'}});
  return [...new Set(rows.map(({flightId}) => flightId))];
}

export async function retireBaggageForMembership(db: Prisma.TransactionClient, flightId: string, userId: string) {
  await retire(db, {flightId, OR: [{senderMembership: {userId}}, {recipientMembership: {userId}}]});
}

export function retireBaggageForPair(db: Prisma.TransactionClient, userId: string, peerId: string) {
  return retire(db, {OR: [
    {senderMembership: {userId}, recipientMembership: {userId: peerId}},
    {senderMembership: {userId: peerId}, recipientMembership: {userId}},
  ]});
}

export function cancelPendingBaggageForUser(db: Prisma.TransactionClient, userId: string) {
  return db.baggageRequest.updateMany({where: {status: 'PENDING', OR: [{senderMembership: {userId}}, {recipientMembership: {userId}}]}, data: {status: 'CANCELLED'}});
}

export async function prunePendingBaggage(db: Prisma.TransactionClient, flightId: string, userId: string) {
  const member = await activeMember(db, flightId, userId);
  const pending = await db.baggageRequest.findMany({where: {flightId, status: 'PENDING', ...involving([member.id])}, include: requestSelect});
  const invalid = pending.filter((r) => !complementary(member, otherMember(r, member.id))).map(({id}) => id);
  if (invalid.length) await db.baggageRequest.updateMany({where: {id: {in: invalid}}, data: {status: 'CANCELLED'}});
}