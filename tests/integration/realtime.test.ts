import assert from 'node:assert/strict';
import {randomInt, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {io, type Socket} from 'socket.io-client';

const baseURL = new URL(process.env.BASE_URL ?? process.env.APP_ORIGIN ?? 'http://localhost:3000');
const socketTimeout = 10_000;

async function api<T>(path: string, method = 'GET', body?: unknown, cookie?: string) {
  const response = await fetch(new URL(`/api/v1/${path}`, baseURL), {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      origin: baseURL.origin,
      ...(cookie ? {cookie} : {}),
      ...(body === undefined ? {} : {'content-type': 'application/json'}),
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const envelope = await response.json() as {data: T} | {error: {code: string}};
  assert.equal(response.status, 200, `${method} ${path}: ${'error' in envelope ? envelope.error.code : response.statusText}`);
  assert.ok('data' in envelope, `${method} ${path} did not return data`);
  return {data: envelope.data, setCookie: response.headers.get('set-cookie')};
}

function connect(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', connected).off('connect_error', failed);
    };
    const connected = () => { cleanup(); resolve(); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => failed(new Error('Socket handshake timed out')), socketTimeout);
    socket.once('connect', connected).once('connect_error', failed).connect();
  });
}

function nextEvent(socket: Socket, name: string) {
  return new Promise<unknown>((resolve, reject) => {
    const received = (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(name, received);
      reject(new Error(`Timed out waiting for ${name}`));
    }, socketTimeout);
    socket.once(name, received);
  });
}

test('Socket.IO delivers scoped invalidations and REST recovers messages missed while disconnected', {timeout: 120_000}, async (t) => {
  const cookies: string[] = [];
  const sockets: Socket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await Promise.allSettled(cookies.map((cookie) => api('profile', 'DELETE', undefined, cookie)));
  });

  function client(cookie?: string) {
    const socket = io(baseURL.origin, {
      transports: ['websocket'], path: '/socket.io/', forceNew: true,
      autoConnect: false, reconnection: false, timeout: socketTimeout / 2,
      extraHeaders: {origin: baseURL.origin, ...(cookie ? {cookie} : {})},
    });
    sockets.push(socket);
    return socket;
  }

  async function guest() {
    const {setCookie} = await api('auth/guest', 'POST', {});
    const cookie = setCookie?.split(';', 1)[0];
    assert.ok(cookie, 'Expected a guest session cookie');
    cookies.push(cookie);
    return cookie;
  }

  const [sender, recipient, outsider] = await Promise.all([guest(), guest(), guest()]);
  const flight = {
    method: 'manual', airline: 'QY', flightNumber: String(randomInt(1000, 10_000)),
    departureAirport: 'SFO', arrivalAirport: 'PDX',
    departureDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
  };
  async function join(cookie: string, displayName: string) {
    const {data: {token}} = await api<{token: string}>('flights/verify', 'POST', flight, cookie);
    const {data: {id}} = await api<{id: string}>('flights/join', 'POST', {
      token, displayName, isAnonymous: false, baggageAllowance: 20, expectedBaggageWeight: 15,
    }, cookie);
    return id;
  }

  const flightId = await join(sender, 'Socket Sender');
  assert.equal(await join(recipient, 'Socket Recipient'), flightId);
  const room = `flights/${flightId}`;
  const {data: passengers} = await api<{items: {id: string; displayName: string}[]}>(`${room}/passengers`, 'GET', undefined, sender);
  const peer = passengers.items.find(({displayName}) => displayName === 'Socket Recipient');
  assert.ok(peer, 'Recipient is listed in the flight room');
  const {data: {id: conversationId}} = await api<{id: string}>(`${room}/conversations`, 'POST', {passengerId: peer.id}, sender);
  const messagesPath = `conversations/${conversationId}/messages`;

  await assert.rejects(connect(client()), (error: Error) => error.message !== 'Socket handshake timed out');
  const memberSocket = client(recipient);
  const outsiderSocket = client(outsider);
  await Promise.all([connect(memberSocket), connect(outsiderSocket)]);
  const outsiderEvents: string[] = [];
  outsiderSocket.onAny((name) => outsiderEvents.push(name));

  async function checkSubscriptions(socket: Socket, ok: boolean) {
    assert.deepEqual(await socket.timeout(socketTimeout).emitWithAck('flight:join', {flightId}), {ok});
    assert.deepEqual(await socket.timeout(socketTimeout).emitWithAck('conversation:join', {conversationId}), {ok});
  }
  await Promise.all([checkSubscriptions(memberSocket, true), checkSubscriptions(outsiderSocket, false)]);

  async function send(content: string) {
    const {data: {id}} = await api<{id: string}>(messagesPath, 'POST', {clientId: randomUUID(), content}, sender);
    return id;
  }

  async function sendAndObserve(content: string) {
    // Start both listeners before the write so a fast gateway cannot beat the assertions.
    const [conversation, notification, messageId] = await Promise.all([
      nextEvent(memberSocket, 'conversation:updated'),
      nextEvent(memberSocket, 'notification:new'),
      send(content),
    ]);
    assert.deepEqual(conversation, {conversationId});
    assert.deepEqual(notification, {});
    return messageId;
  }

  const firstId = await sendAndObserve('I have arrived at the airport.');
  const previousSocketId = memberSocket.id;
  memberSocket.disconnect();
  assert.equal(memberSocket.connected, false);
  const missedContent = 'I will wait near the check-in desks.';
  const missedId = await send(missedContent);

  await connect(memberSocket);
  assert.notEqual(memberSocket.id, previousSocketId);
  await checkSubscriptions(memberSocket, true);
  const {data: history} = await api<{items: {id: string; content: string; isOwn: boolean}[]}>(messagesPath, 'GET', undefined, recipient);
  assert.deepEqual(new Set(history.items.map(({id}) => id)), new Set([firstId, missedId]));
  const missed = history.items.find(({id}) => id === missedId);
  assert.equal(missed?.content, missedContent);
  assert.equal(missed?.isOwn, false);

  await sendAndObserve('I am back online now.');
  assert.deepEqual(outsiderEvents, [], 'No flight, conversation or notification invalidations were sent to the outsider');
});