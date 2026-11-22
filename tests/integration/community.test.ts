import assert from 'node:assert/strict';
import {randomInt, randomUUID} from 'node:crypto';
import {test} from 'node:test';

const origin = new URL(process.env.BASE_URL ?? process.env.APP_ORIGIN ?? 'http://localhost:3000');
type Envelope<T> = {data: T} | {error: {code: string; message: string}};
type RequestOptions = {method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown};
type Flyer = {points: number; tier: string; flightsAdded: number; ridesConfirmed: number};
type Room = {id: string; membership: {id: string; partySize: number; rideOptIn: boolean; pickupArea: string | null; baggageReported: boolean}};
type Ride = {id: string; flightLabel: string; departureDate: string; departureTime: string; minutesApart: number; partySize: number; pickupArea: string | null; flyer: Flyer | null};
type Rides = {items: Ride[]; eligibility: string};
type Message = {id: string; content: string; isOwn: boolean; displayName: string; clientId?: string};
type Conversation = {id: string; flightId: string; rideFlightId: string; participant: {id: string}};
type Flight = {method: 'manual'; airline: string; flightNumber: string; departureAirport: string; arrivalAirport: string; departureDate: string; departureTime: string};

async function request<T>(path: string, cookie?: string, {method, body}: RequestOptions = {}) {
  const response = await fetch(new URL(`/api/v1/${path}`, origin), {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {origin: origin.origin, ...(cookie ? {cookie} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  return {response, envelope: await response.json() as Envelope<T>};
}

async function ok<T>(path: string, cookie?: string, options?: RequestOptions) {
  const {response, envelope} = await request<T>(path, cookie, options);
  const label = `${options?.method ?? 'GET'} ${path}`;
  assert.equal(response.status, 200, `${label}: ${'error' in envelope ? envelope.error.code : response.statusText}`);
  assert.ok('data' in envelope, `${label}: missing data`);
  return {data: envelope.data, headers: response.headers};
}

async function inaccessible(path: string, cookie: string, options?: RequestOptions) {
  const {response, envelope} = await request(path, cookie, options);
  const label = `${options?.method ?? 'GET'} ${path}`;
  assert.equal(response.status, 404, `${label} must not be accessible to this account`);
  assert.ok('error' in envelope && !('data' in envelope), `${label} must not reveal any data`);
}

const post = (body: unknown): RequestOptions => ({method: 'POST', body});
const patch = (body: unknown): RequestOptions => ({method: 'PATCH', body});
const remove: RequestOptions = {method: 'DELETE'};
const message = (content: string) => ({clientId: randomUUID(), content});

test('travel community: cross-flight ride boundaries, scoped chat, late group history and idempotent Flyer credit', {timeout: 120_000}, async (t) => {
  const sessions: string[] = [];
  t.after(async () => {
    await Promise.allSettled(sessions.map((cookie) => ok('profile', cookie, remove)));
  });

  async function guest() {
    const {headers} = await ok('auth/guest', undefined, post({}));
    const cookie = headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie, 'Guest initialization should set a session cookie');
    sessions.push(cookie);
    return cookie;
  }

  const [host, peer, outside, late] = await Promise.all([guest(), guest(), guest(), guest()]);
  const futureDeparture = Date.now() + 90 * 86_400_000;
  const firstDate = new Date(futureDeparture).toISOString().slice(0, 10);
  const nextDate = new Date(futureDeparture + 86_400_000).toISOString().slice(0, 10);
  const firstNumber = randomInt(1000, 9995);
  const template: Flight = {method: 'manual', airline: 'QZ', flightNumber: String(firstNumber), departureAirport: 'LHR', arrivalAirport: 'BOS', departureDate: firstDate, departureTime: '23:50'};
  const at = (offset: number, departureDate: string, departureTime: string, departureAirport = template.departureAirport): Flight =>
    ({...template, flightNumber: String(firstNumber + offset), departureDate, departureTime, departureAirport});

  async function join(cookie: string, flight: Flight, displayName: string, ride?: {rideOptIn: boolean; partySize: number; pickupArea?: string}) {
    const {data: {token}} = await ok<{token: string}>('flights/verify', cookie, post(flight));
    const {data: {id}} = await ok<{id: string}>('flights/join', cookie, post({token, displayName, ...ride}));
    const {data: room} = await ok<Room>(`flights/${id}`, cookie);
    return room;
  }

  const stats = async () => (await ok<{flyer: Flyer}>('profile', host)).data.flyer;
  assert.deepEqual(await stats(), {points: 0, tier: 'New Flyer', flightsAdded: 0, ridesConfirmed: 0});

  const hostRoom = await join(host, template, 'Host Traveller');
  const hostPath = `flights/${hostRoom.id}`;
  const peerRoom = await join(peer, at(1, nextDate, '00:10'), 'Midnight Traveller', {rideOptIn: false, partySize: 3, pickupArea: 'Paddington'});
  const peerPath = `flights/${peerRoom.id}`;
  const optedIn = {rideOptIn: true, partySize: 1};
  const sameDay = await join(outside, at(2, firstDate, '23:30'), 'Boundary Traveller', optedIn);
  const tooLate = await join(outside, at(3, nextDate, '00:11'), 'Boundary Traveller', optedIn);
  const wrongAirport = await join(outside, at(4, nextDate, '00:10', 'LGW'), 'Boundary Traveller', optedIn);
  assert.equal(new Set([hostRoom.id, peerRoom.id, sameDay.id, tooLate.id, wrongAirport.id]).size, 5);
  const {partySize, rideOptIn, pickupArea, baggageReported} = hostRoom.membership;
  assert.deepEqual({partySize, rideOptIn, pickupArea, baggageReported}, {partySize: 1, rideOptIn: false, pickupArea: null, baggageReported: false});
  assert.equal(peerRoom.membership.pickupArea, null, 'An opted-out passenger must not store a pickup area');
  const firstFlightCredit = {points: 100, tier: 'New Flyer', flightsAdded: 1, ridesConfirmed: 0};
  assert.deepEqual(await stats(), firstFlightCredit);

  const rides = async () => (await ok<Rides>(`${hostPath}/rides`, host)).data;
  const optedOut = await rides();
  assert.equal(optedOut.eligibility, 'OPT_IN_REQUIRED');
  assert.deepEqual(optedOut.items, []);
  await ok(`${hostPath}/ride-settings`, host, patch(optedIn));
  const peerRequest = post({passengerId: peerRoom.membership.id});
  const before = await rides();
  assert.equal(before.eligibility, 'READY');
  assert.ok(before.items.some(({id}) => id === sameDay.membership.id), '23:30 is within the inclusive window for a 23:50 departure');
  assert.ok(!before.items.some(({id}) => id === peerRoom.membership.id), 'An opted-out passenger is not listed');
  await inaccessible(`${hostPath}/ride-conversations`, host, peerRequest);

  await ok(`${peerPath}/ride-settings`, peer, patch({rideOptIn: true, partySize: 3, pickupArea: 'Paddington'}));
  const after = await rides();
  const midnight = after.items.find(({id}) => id === peerRoom.membership.id);
  assert.ok(midnight, '00:10 on the next local day is exactly 20 minutes later');
  assert.deepEqual({
    label: midnight.flightLabel, day: midnight.departureDate, time: midnight.departureTime,
    minutes: midnight.minutesApart, partySize: midnight.partySize, pickup: midnight.pickupArea, flyer: midnight.flyer,
  }, {label: `QZ ${firstNumber + 1}`, day: nextDate, time: '00:10', minutes: 20, partySize: 3, pickup: 'Paddington', flyer: firstFlightCredit});
  for (const [excluded, reason] of [[tooLate, '21 minutes later'], [wrongAirport, 'different departure airport']] as const) {
    assert.ok(!after.items.some(({id}) => id === excluded.membership.id), `No ride match for ${reason}`);
    await inaccessible(`${hostPath}/ride-conversations`, host, post({passengerId: excluded.membership.id}));
  }

  await inaccessible(`${hostPath}/conversations`, host, peerRequest);
  const {data: conversation} = await ok<Conversation>(`${hostPath}/ride-conversations`, host, peerRequest);
  assert.equal(conversation.flightId, hostRoom.id);
  assert.equal(conversation.rideFlightId, peerRoom.id);
  assert.equal(conversation.participant.id, peerRoom.membership.id);
  const {data: reverse} = await ok<Conversation>(`${peerPath}/ride-conversations`, peer, post({passengerId: hostRoom.membership.id}));
  assert.equal(reverse.id, conversation.id, 'Both passengers open the same private ride chat');
  assert.equal(reverse.flightId, peerRoom.id);
  assert.equal(reverse.rideFlightId, hostRoom.id);

  const directPath = `conversations/${conversation.id}/messages`;
  const direct = message('Could we share a ride from the station?');
  const {data: sentDirect} = await ok<Message>(directPath, host, post(direct));
  const {data: directHistory} = await ok<{items: Message[]}>(directPath, peer);
  assert.deepEqual(directHistory.items.map(({id, content, isOwn}) => ({id, content, isOwn})), [{id: sentDirect.id, content: direct.content, isOwn: false}]);
  await inaccessible(directPath, outside);
  // Being eligible for a ride or opening a chat does not grant membership in the other flight.
  for (const [otherRoom, rider] of [[hostPath, peer], [peerPath, host]]) {
    for (const resource of ['', '/passengers', '/matches', '/rides', '/group-messages']) {
      await inaccessible(`${otherRoom}${resource}`, rider);
    }
    await inaccessible(`${otherRoom}/group-messages`, rider, post(message('Not a member of this group.')));
  }

  const groupPath = `${hostPath}/group-messages`;
  const early = message('Welcome to the flight room.');
  const {data: first} = await ok<Message>(groupPath, host, post(early));
  assert.equal((await ok<Message>(groupPath, host, post(early))).data.id, first.id);
  await inaccessible(groupPath, late);
  await inaccessible(groupPath, late, post(message('Not a member yet.')));
  assert.equal((await join(late, template, 'Late Traveller')).id, hostRoom.id);
  const readGroup = async (cookie: string) => (await ok<{items: Message[]}>(groupPath, cookie)).data.items;
  const history = await readGroup(late);
  assert.deepEqual(history.map(({id, content, isOwn, displayName}) => ({id, content, isOwn, displayName})), [
    {id: first.id, content: early.content, isOwn: false, displayName: 'Host Traveller'},
  ], 'Late joiners see earlier room messages once, without private ride messages');
  assert.ok(!('clientId' in history[0]), 'Other passengers do not receive the sender’s client retry identifier');

  const {data: lateMessage} = await ok<Message>(groupPath, late, post(message('Hello, I just joined.')));
  assert.ok((await readGroup(host)).some(({id}) => id === lateMessage.id));
  const {data: {items: passengers}} = await ok<{items: {id: string; displayName: string}[]}>(`${hostPath}/passengers`, host);
  const lateMember = passengers.find(({displayName}) => displayName === 'Late Traveller');
  assert.ok(lateMember);
  await ok(`${hostPath}/block`, host, post({passengerId: lateMember.id}));
  assert.deepEqual((await readGroup(host)).map(({id}) => id), [first.id]);
  assert.deepEqual((await readGroup(late)).map(({id}) => id), [lateMessage.id]);
  await inaccessible(groupPath, outside);

  await ok(`${peerPath}/ride-settings`, peer, patch({rideOptIn: false, partySize: 3}));
  assert.ok(!(await rides()).items.some(({id}) => id === peerRoom.membership.id), 'Opting out removes an existing ride match');
  await inaccessible(directPath, host);
  await inaccessible(directPath, peer);

  await ok(`${hostPath}/leave`, host, remove);
  await inaccessible(groupPath, host);
  const rejoined = await join(host, template, 'Host Traveller', optedIn);
  assert.equal(rejoined.id, hostRoom.id);
  assert.equal(rejoined.membership.id, hostRoom.membership.id);
  assert.deepEqual(await stats(), firstFlightCredit, 'Adding the same flight again must not award additional Flyer points');
});