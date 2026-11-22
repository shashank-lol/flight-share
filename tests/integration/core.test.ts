import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

const origin = process.env.BASE_URL ?? process.env.APP_ORIGIN ?? 'http://localhost:3000';
const suffix = randomUUID().slice(0, 12);

async function call(path: string, method = 'GET', body?: unknown, session = '', requestOrigin = origin) {
  const response = await fetch(`${origin}/api/v1/${path}`, {
    method, signal: AbortSignal.timeout(25_000),
    headers: {origin: requestOrigin, cookie: session, ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const envelope = await response.json();
  return {response, status: response.status, ...envelope};
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const roomDetails = {method: 'manual', airline: 'QZ', flightNumber: `${1000 + parseInt(suffix.slice(0, 4), 16) % 8999}`, departureAirport: 'LAX', arrivalAirport: 'SEA', departureDate: future(12)};

test('real API: guest sessions, isolated rooms, private profiles, matches, messaging and safety', {timeout: 120_000}, async (t) => {
  const sessions = new Set<string>();
  t.after(async () => {
    await Promise.allSettled([...sessions].map((session) => call('profile', 'DELETE', undefined, session)));
  });
  async function guest() {
    const signed = await call('auth/guest', 'POST', {});
    assert.equal(signed.status, 200);
    const header = signed.response.headers.get('set-cookie') ?? '';
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    const session = header.split(';')[0];
    assert.ok(session);
    sessions.add(session);
    assert.deepEqual(Object.keys(signed.data), ['id']);
    const resumed = await call('auth/guest', 'POST', {}, session);
    assert.deepEqual(resumed.data, signed.data);
    assert.equal(resumed.response.headers.get('set-cookie'), null);
    return {session, id: signed.data.id};
  }

  assert.equal((await call('profile')).status, 401);
  assert.equal((await call('auth/guest', 'POST', {}, '', 'https://outside.example')).status, 403);
  assert.equal((await call('auth/guest', 'POST', {email: 'not-needed@example.test'})).status, 400);
  assert.equal((await call('auth/login', 'POST', {})).status, 401);
  assert.equal((await call('flights/search?code=AS2223&date='+future(2))).status, 401);
  const [a, b, outsider] = await Promise.all([guest(), guest(), guest()]);
  assert.equal(new Set([a.id, b.id, outsider.id]).size, 3);
  assert.ok(!('email' in (await call('profile', 'GET', undefined, a.session)).data));

  async function join(session: string, options: {displayName: string; weight: number; isAnonymous?: boolean; otherDate?: boolean}) {
    const verified = await call('flights/verify', 'POST', {...roomDetails, ...(options.otherDate ? {departureDate: future(13)} : {})}, session);
    assert.equal(verified.status, 200);
    assert.equal(verified.data.verificationStatus, 'SELF_REPORTED');
    const result = await call('flights/join', 'POST', {token: verified.data.token, displayName: options.displayName, isAnonymous: options.isAnonymous ?? false, baggageAllowance: 20, expectedBaggageWeight: options.weight, transportation: 'CAB_SHARE'}, session);
    assert.equal(result.status, 200, JSON.stringify(result.error));
    return result.data.id as string;
  }

  const flightId = await join(a.session, {displayName: 'Alex Test', weight: 23});
  assert.equal(await join(b.session, {displayName: 'Hidden Test Name', weight: 12, isAnonymous: true}), flightId);
  assert.notEqual(await join(outsider.session, {displayName: 'Other Flight', weight: 12, otherDate: true}), flightId);
  const room = `flights/${flightId}`;
  assert.equal((await call(room, 'GET', undefined, outsider.session)).status, 404);
  const passengers = await call(`${room}/passengers?filter=available`, 'GET', undefined, a.session);
  assert.equal(passengers.status, 200);
  assert.equal(passengers.data.items.length, 1);
  const peer = passengers.data.items[0];
  assert.equal(peer.displayName, 'Anonymous Traveller');
  assert.ok(peer.alias);
  assert.equal(peer.remainingWeight, 8);
  assert.doesNotMatch(JSON.stringify(passengers.data), /Hidden Test Name|@example\.test/);
  const matches = await call(`${room}/matches`, 'GET', undefined, a.session);
  assert.equal(matches.data.items[0].potentialWeight, 3);
  assert.equal(matches.data.items[0].status, 'POTENTIAL');
  assert.equal((await call(`${room}/policy`, 'GET', undefined, a.session)).data.status, 'UNKNOWN');

  assert.equal((await call('profile', 'PATCH', {showBaggage: false, showTravelPreferences: false}, b.session)).status, 200);
  assert.equal((await call('profile', 'PATCH', {displayName: 'Still Private'}, b.session)).data.isAnonymous, true);
  const hidden = (await call(`${room}/passengers`, 'GET', undefined, a.session)).data.items.find((item: {id: string}) => item.id === peer.id);
  assert.equal(hidden.baggageAllowance, null);
  assert.equal(hidden.transportation, null);
  assert.equal((await call(`${room}/matches`, 'GET', undefined, a.session)).data.items.length, 0);
  assert.equal((await call('profile/baggage', 'PATCH', {flightId, expectedBaggageWeight: 22.5}, a.session)).data.membership.expectedBaggageWeight, 22.5);

  const opened = await call(`${room}/conversations`, 'POST', {passengerId: peer.id}, a.session);
  assert.equal(opened.status, 200);
  const conversation = `conversations/${opened.data.id}`;
  assert.equal((await call(`${conversation}/messages`, 'GET', undefined, outsider.session)).status, 404);
  const payload = {clientId: randomUUID(), content: 'Would you like to share a ride from the airport?'};
  const first = await call(`${conversation}/messages`, 'POST', payload, a.session);
  assert.equal(first.status, 200);
  const duplicate = await call(`${conversation}/messages`, 'POST', payload, a.session);
  assert.equal(first.data.id, duplicate.data.id);
  const history = await call(`${conversation}/messages`, 'GET', undefined, b.session);
  assert.equal(history.data.items.length, 1);
  assert.equal(history.data.items[0].content, payload.content);
  assert.equal(history.data.items[0].isOwn, false);
  const notifications = await call('notifications', 'GET', undefined, b.session);
  assert.equal(notifications.data.items.filter((item: {type: string}) => item.type === 'NEW_MESSAGE').length, 1);
  assert.equal((await call(`${conversation}/read`, 'PATCH', {messageId: first.data.id}, b.session)).status, 200);
  assert.ok((await call(`${conversation}/messages`, 'GET', undefined, a.session)).data.items[0].readAt);

  assert.equal((await call(`${room}/report`, 'POST', {passengerId: peer.id, reason: 'Other'}, a.session)).data.status, 'OPEN');
  assert.equal((await call(`${room}/block`, 'POST', {passengerId: peer.id}, a.session)).status, 200);
  assert.equal((await call(`${conversation}/messages`, 'GET', undefined, a.session)).status, 404);
  assert.equal((await call(`${conversation}/messages`, 'GET', undefined, b.session)).status, 404);
  const blocks = await call('blocks', 'GET', undefined, a.session);
  assert.equal(blocks.data.items.length, 1);
  assert.equal((await call(`blocks/${blocks.data.items[0].id}`, 'DELETE', undefined, a.session)).status, 200);
  assert.equal((await call(`${room}/leave`, 'DELETE', undefined, b.session)).status, 200);
  assert.equal((await call(`${room}/passengers`, 'GET', undefined, b.session)).status, 404);
  assert.equal((await call(`${conversation}/messages`, 'GET', undefined, a.session)).status, 404);
  assert.equal((await call('profile', 'DELETE', undefined, outsider.session)).status, 200);
  sessions.delete(outsider.session);
  assert.equal((await call('profile', 'GET', undefined, outsider.session)).status, 401);
});