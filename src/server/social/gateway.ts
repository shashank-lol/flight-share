import type {IncomingMessage, Server as HttpServer} from 'node:http';
import {isIP} from 'node:net';
import {createAdapter} from '@socket.io/redis-adapter';
import {Server, type Socket} from 'socket.io';
import {z} from 'zod';
import {getSession, SESSION_COOKIE} from '../auth';
import {appOrigin, secureCookies} from '../config';
import {prisma} from '../db';
import {rateLimit} from '../http';
import {logger} from '../log';
import {redis} from '../redis';
import {findVisibleConversation, isFlightMember, otherParticipant} from './access';
import {EVENT_CHANNEL, groupEventSchema, publishUser, userEventSchema, type UserEvent} from './events';

export const SOCKET_PATH = '/socket.io/';
export const CLIENT_IP_HEADER = 'x-flight-share-client-ip';
export function clientIp(req: IncomingMessage) {
  const trusted = req.headers['x-real-ip'];
  return process.env.TRUST_PROXY === 'true' && typeof trusted === 'string' && isIP(trusted) ? trusted : req.socket.remoteAddress ?? 'unknown';
}

const userRoom = (id: string) => `user:${id}`;
const flightRoom = (id: string) => `flight:${id}`;
const conversationRoom = (id: string) => `conversation:${id}`;
const flightInput = z.object({flightId: z.uuid()}).strict();
const conversationInput = z.object({conversationId: z.uuid()}).strict();
const typingInput = conversationInput.extend({typing: z.boolean()});
const ROOM_LIMIT = 12;
const SESSION_CHECK_MS = 60_000;

type Ack = (reply: {ok: boolean; online?: boolean}) => void;
type ClientEvents = {
  'flight:join': (value: unknown, ack?: Ack) => void;
  'flight:leave': (value: unknown, ack?: Ack) => void;
  'conversation:join': (value: unknown, ack?: Ack) => void;
  'conversation:leave': (value: unknown, ack?: Ack) => void;
  'conversation:presence': (value: unknown, ack?: Ack) => void;
  'conversation:typing': (value: unknown, ack?: Ack) => void;
};
type ServerEvents = {
  'flight:updated': (payload: {flightId: string}) => void;
  'group:updated': (payload: {flightId: string}) => void;
  'conversation:updated': (payload: {conversationId: string}) => void;
  'conversation:typing': (payload: {conversationId: string; typing: boolean}) => void;
  'conversations:updated': (payload: Record<string, never>) => void;
  'notification:new': (payload: Record<string, never>) => void;
};
type InterServerEvents = {'presence:check': (userId: string, ack: (online: boolean) => void) => void};
type SocketData = {userId: string; sessionId: string};
type Gateway = Server<ClientEvents, ServerEvents, InterServerEvents, SocketData>;
type PassengerSocket = Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>;

function validOrigin(req: IncomingMessage) {
  // WebSocket browsers send Origin. Same-origin HTTP polling may omit Origin.
  if (req.headers.origin !== undefined) return req.headers.origin === appOrigin();
  return req.headers['sec-fetch-site'] === 'same-origin' && req.headers.upgrade === undefined;
}

function hasSessionCookie(cookie: string | undefined) {
  return cookie?.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`)) ?? false;
}

async function sessionStillValid(socket: PassengerSocket) {
  return prisma.session.findFirst({where: {id: socket.data.sessionId, userId: socket.data.userId, expiresAt: {gt: new Date()}}, select: {id: true}});
}

function connection(io: Gateway, socket: PassengerSocket) {
  const {userId} = socket.data;
  let subscription = Promise.resolve();
  function updateRoom<T>(schema: z.ZodType<T>, toId: (value: T) => string, name: (id: string) => string, canAccess: (id: string) => Promise<unknown>, join: boolean) {
    return (value: unknown, ack?: Ack) => {
      if (typeof ack !== 'function') return;
      const input = schema.safeParse(value);
      if (!input.success || !socket.connected) return ack({ok: false});
      // Serialize room changes per socket so the room cap cannot be bypassed by concurrent joins.
      // Limit queued work before scheduling Redis/DB calls.
      if (pending >= ROOM_LIMIT) return ack({ok: false});
      pending++;
      subscription = subscription.then(async () => {
        const id = toId(input.data);
        const room = name(id);
        if (!socket.connected) return;
        await rateLimit('socket_room_change', userId, 80, 60);
        if (!join) {
          await socket.leave(room);
          return ack({ok: true});
        }
        if (!await sessionStillValid(socket)) {
          socket.disconnect(true);
          return;
        }
        if ((!socket.rooms.has(room) && socket.rooms.size >= ROOM_LIMIT + 2) || !await canAccess(id)) return ack({ok: false});
        if (socket.connected) {
          await socket.join(room);
          ack({ok: true});
        }
      }).catch(() => { if (socket.connected) ack({ok: false}); }).finally(() => { pending--; });
    };
  }
  let pending = 0;
  const flight = (id: string) => isFlightMember(userId, id);
  const conversation = (id: string) => findVisibleConversation(userId, id);
  socket.on('flight:join', updateRoom(flightInput, (value) => value.flightId, flightRoom, flight, true));
  socket.on('flight:leave', updateRoom(flightInput, (value) => value.flightId, flightRoom, flight, false));
  socket.on('conversation:join', updateRoom(conversationInput, (value) => value.conversationId, conversationRoom, conversation, true));
  socket.on('conversation:leave', updateRoom(conversationInput, (value) => value.conversationId, conversationRoom, conversation, false));

  let presencePending = false;
  function scopedEvent<T extends {conversationId: string}>(schema: z.ZodType<T>, scope: string, max: number, run: (value: T, peerId: string) => Promise<{ok: boolean; online?: boolean}>) {
    return (value: unknown, ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const input = schema.safeParse(value);
      if (!input.success || presencePending || !socket.connected) return reply({ok: false});
      presencePending = true;
      void (async () => {
        await rateLimit(scope, userId, max, 60);
        if (!await sessionStillValid(socket)) {
          socket.disconnect(true);
          return;
        }
        const c = await conversation(input.data.conversationId);
        if (!c || !socket.connected) return reply({ok: false});
        const result = await run(input.data, otherParticipant(c, userId));
        if (socket.connected) reply(result);
      })().catch(() => { if (socket.connected) reply({ok: false}); }).finally(() => { presencePending = false; });
    };
  }
  socket.on('conversation:presence', scopedEvent(conversationInput, 'socket_presence', 30, async (_input, peerId) => {
    if (await isLocallyOnline(io, peerId)) return {ok: true, online: true};
    const online = (await io.serverSideEmitWithAck('presence:check', peerId)).some((value) => value === true);
    return {ok: true, online};
  }));
  socket.on('conversation:typing', scopedEvent(typingInput, 'socket_typing', 50, async (input, peerId) => {
    await publishUser(peerId, 'conversation:typing', input);
    return {ok: true};
  }));
}

async function authorizedRoomCleanup(sockets: PassengerSocket[], userId: string, flightId?: string) {
  if (flightId && sockets.some((socket) => socket.rooms.has(flightRoom(flightId))) && !await isFlightMember(userId, flightId)) {
    for (const socket of sockets) await socket.leave(flightRoom(flightId));
  }
  const ids = new Set(sockets.flatMap((socket) => [...socket.rooms].filter((room) => room.startsWith('conversation:')).map((room) => room.slice('conversation:'.length))));
  await Promise.all([...ids].map(async (id) => {
    if (!await findVisibleConversation(userId, id)) for (const socket of sockets) await socket.leave(conversationRoom(id));
  }));
}

function localUserSockets(io: Gateway, userId: string) {
  const members = io.sockets.adapter.rooms.get(userRoom(userId));
  return [...(members ?? [])].flatMap((id) => {
    const socket = io.sockets.sockets.get(id);
    return socket ? [socket] : [];
  });
}

async function activeSockets(userId: string, sockets: PassengerSocket[]) {
  if (!sockets.length) return [];
  const active = await prisma.session.findMany({where: {userId, id: {in: [...new Set(sockets.map((socket) => socket.data.sessionId))]}, expiresAt: {gt: new Date()}}, select: {id: true}});
  const sessionIds = new Set(active.map(({id}) => id));
  return sockets.filter((socket) => {
    if (sessionIds.has(socket.data.sessionId)) return socket.connected;
    socket.disconnect(true);
    return false;
  });
}

async function isLocallyOnline(io: Gateway, userId: string) {
  return (await activeSockets(userId, localUserSockets(io, userId))).length > 0;
}

async function deliverGroupUpdate(io: Gateway, flightId: string, senderId: string) {
  const room = flightRoom(flightId);
  const local = io.sockets.adapter.rooms.get(room);
  if (!local?.size) return;
  const sockets = [...local].flatMap((id) => {
    const socket = io.sockets.sockets.get(id);
    return socket ? [socket] : [];
  });
  const userIds = [...new Set(sockets.map((socket) => socket.data.userId))];
  // Recheck authorization at delivery time rather than trusting cached room membership.
  const [members, sessions] = await Promise.all([
    prisma.flightMembership.findMany({where: {flightId, isActive: true, userId: {in: userIds}, user: {
      blocksMade: {none: {blockedId: senderId}}, blocksReceived: {none: {blockerId: senderId}},
    }}, select: {userId: true}}),
    prisma.session.findMany({where: {id: {in: [...new Set(sockets.map((socket) => socket.data.sessionId))]}, expiresAt: {gt: new Date()}}, select: {id: true, userId: true}}),
  ]);
  const visibleTo = new Set(members.map(({userId}) => userId));
  const active = new Map(sessions.map(({id, userId}) => [id, userId]));
  for (const socket of sockets) {
    const {sessionId, userId} = socket.data;
    if (active.get(sessionId) !== userId) socket.disconnect(true);
    else if (socket.connected && socket.rooms.has(room) && visibleTo.has(userId)) socket.emit('group:updated', {flightId});
  }
}

async function deliver(io: Gateway, record: UserEvent) {
  const {userId} = record;
  // Every replica consumes the application channel. Only inspect and deliver to its own sockets.
  const sockets = localUserSockets(io, userId);
  if (record.event === 'session:revoked') {
    for (const socket of sockets) if (!record.payload.sessionId || socket.data.sessionId === record.payload.sessionId) socket.disconnect(true);
    return;
  }
  const live = await activeSockets(userId, sockets);
  if (!live.length) return;
  if (record.event === 'conversation:updated') {
    if (!await findVisibleConversation(userId, record.payload.conversationId)) return;
    for (const socket of live) socket.emit('conversation:updated', record.payload);
  } else if (record.event === 'conversation:typing') {
    if (!await findVisibleConversation(userId, record.payload.conversationId)) return;
    for (const socket of live) socket.volatile.emit('conversation:typing', record.payload);
  } else if (record.event === 'flight:updated') {
    await authorizedRoomCleanup(live, userId, record.payload.flightId);
    for (const socket of live) socket.emit('flight:updated', record.payload);
  } else if (record.event === 'conversations:updated') {
    await authorizedRoomCleanup(live, userId);
    for (const socket of live) socket.emit('conversations:updated', {});
  } else {
    for (const socket of live) socket.emit('notification:new', {});
  }
}

export async function startGateway(http: HttpServer) {
  const sub = redis.duplicate();
  sub.on('error', () => logger.warn({component: 'socket_redis'}, 'Realtime Redis connection error'));
  try {
    await Promise.all([redis.ping(), sub.connect()]);
    await sub.subscribe(EVENT_CHANNEL);
  } catch (error) {
    sub.disconnect();
    throw error;
  }
  const io: Gateway = new Server(http, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: 8_192,
    connectTimeout: 10_000,
    adapter: createAdapter(redis, sub, {key: 'fs:socket.io', requestsTimeout: 1_500, publishOnSpecificResponseChannel: true}),
    allowRequest(req, done) {
      if (!validOrigin(req) || !hasSessionCookie(req.headers.cookie)) return done('Connection not authorized', false);
      void rateLimit('socket_handshake', clientIp(req), 80, 60).then(() => done(null, true), () => done('Connection not authorized', false));
    },
  });
  io.engine.on('headers', (headers) => {
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['Cache-Control'] = 'no-store';
    if (secureCookies()) headers['Strict-Transport-Security'] = 'max-age=31536000';
  });
  io.use((socket, next) => {
    void (async () => {
      if (!validOrigin(socket.request)) return next(new Error('Connection not authorized'));
      const session = await getSession(socket.request.headers.cookie);
    if (!session) return next(new Error('A guest session is required'));
      await rateLimit('socket_user_connect', session.id, 40, 60);
      socket.data = {userId: session.id, sessionId: session.sessionId};
      next();
    })().catch(() => next(new Error('Realtime is unavailable')));
  });
  io.on('connection', (socket) => {
    // The configured Redis adapter changes local room membership synchronously.
    void socket.join(userRoom(socket.data.userId));
    connection(io, socket);
  });
  io.on('presence:check', (userId, ack) => {
    if (!z.uuid().safeParse(userId).success || typeof ack !== 'function') return;
    void isLocallyOnline(io, userId).then(ack, () => ack(false));
  });
  sub.on('message', (channel, message) => {
    if (channel !== EVENT_CHANNEL) return;
    let value: unknown;
    try { value = JSON.parse(message); } catch { return; }
    const record = userEventSchema.safeParse(value);
    if (record.success) {
      void deliver(io, record.data).catch(() => logger.warn('Realtime notification delivery failed'));
      return;
    }
    const group = groupEventSchema.safeParse(value);
    if (group.success) void deliverGroupUpdate(io, group.data.flightId, group.data.senderId).catch(() => logger.warn('Realtime group delivery failed'));
  });

  // Removes expired/revoked idle connections even if a Redis invalidation was missed.
  let checking = false;
  const expiration = setInterval(() => {
    if (checking) return;
    checking = true;
    const sockets = [...io.sockets.sockets.values()];
    void (async () => {
      for (let i = 0; i < sockets.length; i += 200) {
        const batch = sockets.slice(i, i + 200);
        const sessions = await prisma.session.findMany({where: {id: {in: [...new Set(batch.map((socket) => socket.data.sessionId))]}, expiresAt: {gt: new Date()}}, select: {id: true}});
        const active = new Set(sessions.map(({id}) => id));
        for (const socket of batch) if (!active.has(socket.data.sessionId)) socket.disconnect(true);
      }
    })().catch(() => logger.warn('Realtime session check failed')).finally(() => { checking = false; });
  }, SESSION_CHECK_MS).unref();

  return async () => {
    clearInterval(expiration);
    try { await io.close(); }
    finally { sub.disconnect(); }
  };
}