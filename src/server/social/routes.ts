import {z} from 'zod';
import type {SessionUser} from '../auth';
import {changeBaggageRequest, requestBaggage} from '../baggage';
import {rateLimit, readJson} from '../http';
import {getConversation, listConversations, listMessages, openConversation, readConversation, sendMessage} from './conversations';
import {listGroupMessages, sendGroupMessage} from './group-messages';
import {decodeMessageCursor} from './message-page';
import {listNotifications, readNotifications} from './notifications';
import {blockConversationPeer, blockPassenger, listBlocks, reportConversationPeer, reportPassenger, unblockPassenger} from './safety';

const id = z.uuid();
const page = z.coerce.number().int().min(1).max(1000).default(1);
const passenger = z.object({passengerId: id}).strict();
const baggageDecision = z.strictObject({action: z.enum(['accept', 'decline', 'withdraw', 'end'])});
// Store plain text, not HTML. Keep line breaks but reject hidden control characters except LF and tab.
const text = (max: number) => z.string().max(max + 128).transform((s) => s.replace(/\r\n?/g, '\n').trim())
  .pipe(z.string().min(1).max(max).refine((s) => !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(s.replace(/[\n\t]/g, ''))));
const reportDetails = z.object({reason: text(80), description: z.string().optional().transform((s) => s?.trim() || undefined).pipe(text(1000).optional())}).strict();
const report = passenger.extend(reportDetails.shape);
const message = z.object({clientId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/), content: text(2000)}).strict();
const readAnchor = z.object({messageId: id.optional()}).strict();

function historyQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  return {page: page.parse(params.get('page') ?? undefined), cursor: decodeMessageCursor(params.get('cursor'))};
}

export async function routeSocial(method: string, path: string[], request: Request, user: SessionUser) {
  // The enclosing router has already enforced session, origin on mutations and general rate limits.
  const userId = user.id;
  if (path[0] === 'flights' && path[2] === 'baggage-requests') {
    if (method === 'POST' && path.length === 3) {
      await rateLimit('baggage_request', userId, 24, 60);
      const {passengerId} = await readJson(request, passenger);
      return requestBaggage(userId, id.parse(path[1]), passengerId);
    }
    if (method === 'PATCH' && path.length === 4) {
      const {action} = await readJson(request, baggageDecision);
      return changeBaggageRequest(userId, id.parse(path[1]), id.parse(path[3]), action);
    }
  }
  if (path[0] === 'flights' && path.length === 3 && path[2] === 'group-messages') {
    const flightId = id.parse(path[1]);
    if (method === 'GET') {
      const query = historyQuery(request);
      return listGroupMessages(userId, flightId, query.page, query.cursor);
    }
    if (method === 'POST') {
      await rateLimit('group_message_send', userId, 40, 60);
      const {clientId, content} = await readJson(request, message);
      return sendGroupMessage(userId, flightId, clientId, content);
    }
  }
  if (method === 'POST' && path[0] === 'flights' && path.length === 3) {
    const action = path[2];
    if (action === 'conversations') {
      await rateLimit('conversation_open', userId, 30, 60);
      const {passengerId} = await readJson(request, passenger);
      return openConversation(userId, id.parse(path[1]), passengerId);
    }
    if (action === 'block') {
      await rateLimit('passenger_block', userId, 15, 60);
      const {passengerId} = await readJson(request, passenger);
      return blockPassenger(userId, id.parse(path[1]), passengerId);
    }
    if (action === 'report') {
      await rateLimit('passenger_report', userId, 10, 3600);
      const {passengerId, reason, description} = await readJson(request, report);
      return reportPassenger(userId, id.parse(path[1]), passengerId, reason, description);
    }
  }
  if (path[0] === 'conversations') {
    if (method === 'GET' && path.length === 1) {
      const params = new URL(request.url).searchParams;
      return listConversations(userId, page.parse(params.get('page') ?? undefined), id.optional().parse(params.get('flightId') ?? undefined));
    }
    if (method === 'GET' && path.length === 2) return getConversation(userId, id.parse(path[1]));
    if (method === 'POST' && path.length === 3 && path[2] === 'block') {
      await rateLimit('passenger_block', userId, 15, 60);
      await readJson(request, z.strictObject({}));
      return blockConversationPeer(userId, id.parse(path[1]));
    }
    if (method === 'POST' && path.length === 3 && path[2] === 'report') {
      await rateLimit('passenger_report', userId, 10, 3600);
      const {reason, description} = await readJson(request, reportDetails);
      return reportConversationPeer(userId, id.parse(path[1]), reason, description);
    }
    if (path.length === 3 && path[2] === 'messages') {
      const conversationId = id.parse(path[1]);
      if (method === 'GET') {
        const query = historyQuery(request);
        return listMessages(userId, conversationId, query.page, query.cursor);
      }
      if (method === 'POST') {
        await rateLimit('message_send', userId, 40, 60);
        const {clientId, content} = await readJson(request, message);
        return sendMessage(userId, conversationId, clientId, content);
      }
    }
    if (method === 'PATCH' && path.length === 3 && path[2] === 'read') {
      const {messageId} = request.body ? await readJson(request, readAnchor) : {};
      return readConversation(userId, id.parse(path[1]), messageId);
    }
  }
  if (path[0] === 'notifications') {
    if (method === 'GET' && path.length === 1) return listNotifications(userId, page.parse(new URL(request.url).searchParams.get('page') ?? undefined));
    if (method === 'PATCH' && path.length === 2 && path[1] === 'read') return readNotifications(userId);
    if (method === 'PATCH' && path.length === 3 && path[2] === 'read') return readNotifications(userId, id.parse(path[1]));
  }
  if (path[0] === 'blocks') {
    if (method === 'GET' && path.length === 1) return listBlocks(userId);
    if (method === 'DELETE' && path.length === 2) return unblockPassenger(userId, id.parse(path[1]));
  }
  return undefined;
}