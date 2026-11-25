import assert from 'node:assert/strict';
import {randomInt, randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import type {CabListing, CabRequest, CabSearch, Flyer, Page, Room} from '../../src/components/app/api';

const origin = new URL(process.env.BASE_URL ?? process.env.APP_ORIGIN ?? 'http://localhost:3000');
type Envelope<T> = {data: T} | {error: {code: string; message: string}};
type RequestOptions = {method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown};
type Message = {id: string; content: string; isOwn: boolean; displayName: string; clientId?: string};
type ManualFlight = {method: 'manual'; airline: string; flightNumber: string; departureAirport: string; arrivalAirport: string; departureDate: string; departureTime?: string};

async function request<T>(path: string, cookie?: string, {method, body}: RequestOptions = {}) {
  const response = await fetch(new URL(`/api/v1/${path}`, origin), {
    method, signal: AbortSignal.timeout(20_000),
    headers: {origin: origin.origin, ...(cookie ? {cookie} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  return {status: response.status, headers: response.headers, envelope: await response.json() as Envelope<T>};
}

async function ok<T>(path: string, cookie?: string, options?: RequestOptions) {
  const result = await request<T>(path, cookie, options);
  const label = `${options?.method ?? 'GET'} ${path}`;
  assert.equal(result.status, 200, `${label}: ${'error' in result.envelope ? result.envelope.error.code : result.status}`);
  assert.ok('data' in result.envelope, `${label}: missing data`);
  return {data: result.envelope.data, headers: result.headers};
}

async function denied(path: string, cookie: string, status: number, options?: RequestOptions, code?: string) {
  const result = await request(path, cookie, options);
  const label = `${options?.method ?? 'GET'} ${path}`;
  assert.equal(result.status, status, `${label}: ${JSON.stringify(result.envelope)}`);
  assert.ok('error' in result.envelope && !('data' in result.envelope), `${label} must not reveal any data`);
  if (code) assert.equal(result.envelope.error.code, code);
}

const post = (body: unknown): RequestOptions => ({method: 'POST', body});
const patch = (body: unknown): RequestOptions => ({method: 'PATCH', body});
const remove: RequestOptions = {method: 'DELETE'};
const message = (content: string) => ({clientId: randomUUID(), content});
const flightCredit = {points: 100, tier: 'New Flyer', flightsAdded: 1, ridesConfirmed: 0};

function fixture(t: TestContext, daysAhead: number) {
  const sessions: string[] = [];
  t.after(async () => { await Promise.allSettled(sessions.map((cookie) => ok('profile', cookie, remove))); });
  async function guest() {
    const {headers} = await ok('auth/guest', undefined, post({}));
    const cookie = headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie, 'Guest initialization should set a session cookie');
    sessions.push(cookie);
    return cookie;
  }
  const day = Date.now() + daysAhead * 86_400_000;
  const flightNumber = randomInt(1000, 9990);
  function flight(offset: number, departureTime: string | undefined, nextDay = false, departureAirport = 'DEL'): ManualFlight {
    return {method: 'manual', airline: '6E', flightNumber: String(flightNumber + offset), departureAirport, arrivalAirport: 'BLR', departureDate: new Date(day + (nextDay ? 86_400_000 : 0)).toISOString().slice(0, 10), departureTime};
  }
  async function join(cookie: string, details: ManualFlight, displayName: string, partySize?: number) {
    const {data: {token}} = await ok<{token: string}>('flights/verify', cookie, post(details));
    const {data: {id}} = await ok<{id: string}>('flights/join', cookie, post({token, displayName, partySize}));
    return {room: (await ok<Room>(`flights/${id}`, cookie)).data, path: `flights/${id}`, cookie};
  }
  return {guest, flight, join};
}

type Member = Awaited<ReturnType<ReturnType<typeof fixture>['join']>>;
const publish = async (host: Member, freeSeats = 3) => (await ok<CabListing>(`${host.path}/rides`, host.cookie, post({pickupArea: 'Dwarka Sector 21, Delhi', freeSeats}))).data;
const browse = async (member: Member, window?: number) => (await ok<CabSearch>(`${member.path}/rides${window === undefined ? '' : `?window=${window}`}`, member.cookie)).data;
const ask = async (member: Member, listing: CabListing, body: {seats?: number; window?: number} = {}) =>
  (await ok<Pick<CabRequest, 'id' | 'seats' | 'status' | 'conversationId'>>(`${member.path}/rides/${listing.id}/requests`, member.cookie, post(body))).data;
const requests = async (member: Member, direction: 'received' | 'sent') => (await ok<Page<CabRequest>>(`${member.path}/ride-requests?direction=${direction}`, member.cookie)).data.items;
const decide = (member: Member, id: string, action: 'accept' | 'decline' | 'withdraw') => request<Pick<CabRequest, 'id' | 'seats' | 'status' | 'conversationId'>>(`${member.path}/ride-requests/${id}`, member.cookie, patch({action}));

test('cab discovery uses only published listings and inclusive scheduled departures at the same airport', {timeout: 120_000}, async (t) => {
  const {guest, flight, join} = fixture(t, 92);
  const [viewerCookie, hostCookie, outsiderCookie] = await Promise.all([guest(), guest(), guest()]);
  const viewer = await join(viewerCookie, flight(0, '23:50'), 'Viewer Traveller');
  const same = await join(hostCookie, flight(1, '23:50'), 'Host Traveller');
  const previous = await join(hostCookie, flight(2, '23:30'), 'Host Traveller');
  const midnight = await join(hostCookie, flight(3, '00:10', true), 'Host Traveller');
  const afterDefault = await join(hostCookie, flight(4, '00:11', true), 'Host Traveller');
  const atMax = await join(hostCookie, flight(5, '00:50', true), 'Host Traveller');
  const beyondMax = await join(hostCookie, flight(6, '00:51', true), 'Host Traveller');
  const wrongAirport = await join(hostCookie, flight(7, '23:50', false, 'BOM'), 'Host Traveller');
  const noTime = await join(viewerCookie, flight(8, undefined), 'Viewer Traveller');
  assert.equal(viewer.room.membership.partySize, 1);
  assert.equal((await browse(viewer)).eligibility, 'READY', 'A joined viewer does not have to opt in or publish');
  assert.deepEqual((await browse(viewer)).items, []);
  assert.equal((await browse(noTime)).eligibility, 'MISSING_TIME');
  await denied(`${noTime.path}/rides`, viewerCookie, 409, post({pickupArea: 'Dwarka, Delhi', freeSeats: 1}));
  await denied(`${viewer.path}/rides`, outsiderCookie, 404);
  await denied(`${same.path}/rides`, hostCookie, 400, post({pickupArea: '123 Green Road', freeSeats: 1}));
  await denied(`${same.path}/rides`, hostCookie, 400, post({pickupArea: 'Andheri East, Mumbai', freeSeats: 13}));
  // These are search fixtures, not competing writes. The capacity test below exercises actual races.
  const zero = await publish(same);
  const before = await publish(previous);
  const across = await publish(midnight);
  const outsideDefault = await publish(afterDefault);
  const sixty = await publish(atMax);
  const outsideMax = await publish(beyondMax);
  const wrong = await publish(wrongAirport);
  const results = await browse(viewer);
  assert.equal(results.window, 20);
  const ids = (result: CabSearch) => result.items.map(({id}) => id);
  assert.deepEqual(ids(await browse(viewer, 0)), [zero.id]);
  assert.deepEqual(new Set(ids(results)), new Set([zero.id, before.id, across.id]));
  assert.deepEqual(new Set(ids(await browse(viewer, 60))), new Set([zero.id, before.id, across.id, outsideDefault.id, sixty.id]));
  const acrossResult = results.items.find(({id}) => id === across.id);
  assert.ok(acrossResult);
  assert.equal(acrossResult.minutesApart, 20);
  assert.equal(acrossResult.departureTime, '00:10');
  assert.equal(acrossResult.departureDate, midnight.room.departureDate);
  assert.equal(acrossResult.pickupArea, 'Dwarka Sector 21, Delhi');
  assert.equal(acrossResult.flyer?.flightsAdded, 7);
  for (const invalid of ['-1', '1.5', '61', '']) await denied(`${viewer.path}/rides?window=${invalid}`, viewerCookie, 400);
  for (const listing of [outsideMax, wrong]) await denied(`${viewer.path}/rides/${listing.id}/requests`, viewerCookie, 404, post({window: 60}));
  await denied(`${viewer.path}/rides/${outsideDefault.id}/requests`, viewerCookie, 404, post({}));
  await denied(`${noTime.path}/rides/${across.id}/requests`, viewerCookie, 404, post({}));
  assert.equal((await ask(viewer, sixty, {window: 60})).status, 'PENDING');
});

test('cab requests compete for capacity transactionally; accepted rides share private chat after closing', {timeout: 120_000}, async (t) => {
  const {guest, flight, join} = fixture(t, 95);
  const [hostCookie, aCookie, bCookie, cCookie, dCookie] = await Promise.all([guest(), guest(), guest(), guest(), guest()]);
  assert.deepEqual((await ok<{flyer: Flyer}>('profile', hostCookie)).data.flyer, {points: 0, tier: 'New Flyer', flightsAdded: 0, ridesConfirmed: 0});
  const host = await join(hostCookie, flight(0, '23:50'), 'Host Traveller');
  const a = await join(aCookie, flight(1, '00:10', true), 'Rider A', 2);
  const b = await join(bCookie, flight(1, '00:10', true), 'Rider B');
  const c = await join(cCookie, flight(1, '00:10', true), 'Rider C');
  const d = await join(dCookie, flight(1, '00:10', true), 'Rider D');
  assert.deepEqual((await ok<{flyer: Flyer}>('profile', hostCookie)).data.flyer, flightCredit);
  const listing = await publish(host, 3);
  assert.equal((await browse(host)).ownListing?.id, listing.id);
  await denied(`${host.path}/rides`, hostCookie, 409, post({pickupArea: 'Saket, Delhi', freeSeats: 2}));
  await denied(`${a.path}/rides/${listing.id}`, aCookie, 404, patch({pickupArea: 'Saket, Delhi', freeSeats: 2}));
  const [ra, rb, rc, rd] = await Promise.all([ask(a, listing), ask(b, listing, {seats: 2}), ask(c, listing), ask(d, listing)]);
  assert.equal(ra.seats, 2, 'An omitted seat count uses the joined party size');
  assert.equal(rb.seats, 2, 'A rider can choose a different number of seats');
  assert.deepEqual(await ask(a, listing), ra, 'Sending the same pending request is idempotent');
  assert.equal((await requests(host, 'received')).length, 4);
  assert.deepEqual((await requests(a, 'sent')).map(({id, status}) => ({id, status})), [{id: ra.id, status: 'PENDING'}]);
  assert.equal((await browse(a)).items.length, 0, 'Requests are tracked in the sent tab, not duplicated in discovery');
  await denied(`${a.path}/ride-requests/${ra.id}`, aCookie, 404, patch({action: 'accept'}));
  await denied(`${b.path}/ride-requests/${ra.id}`, bCookie, 404, patch({action: 'withdraw'}));
  assert.equal((await decide(host, rc.id, 'decline')).status, 200);
  assert.equal((await requests(c, 'sent'))[0].status, 'DECLINED');
  const accepted = await Promise.all([decide(host, ra.id, 'accept'), decide(host, rb.id, 'accept')]);
  assert.deepEqual(accepted.map(({status}) => status).sort(), [200, 409]);
  const failed = accepted.find(({status}) => status === 409);
  assert.ok(failed && 'error' in failed.envelope);
  assert.equal(failed.envelope.error.code, 'CAB_NOT_ENOUGH_SEATS');
  const winner = accepted[0].status === 200 ? a : b;
  const loser = winner === a ? b : a;
  const acceptedRequest = accepted.find(({status}) => status === 200)?.envelope;
  assert.ok(acceptedRequest && 'data' in acceptedRequest);
  const directId = acceptedRequest.data.conversationId;
  assert.ok(directId);
  assert.equal((await browse(host)).ownListing?.acceptedSeats, 2);
  await denied(`${host.path}/rides/${listing.id}`, hostCookie, 409, patch({pickupArea: 'Saket, Delhi', freeSeats: 1}), 'CAB_SEATS_ALREADY_ACCEPTED');
  const {data: edited} = await ok<CabListing>(`${host.path}/rides/${listing.id}`, hostCookie, patch({pickupArea: 'Saket, Delhi', freeSeats: 2}));
  assert.equal(edited.availableSeats, 0);
  assert.equal((await requests(winner, 'sent'))[0].conversationId, directId);
  const winnerRoomChat = await ok<Page<{id: string}>>(`conversations?flightId=${winner.room.id}`, winner.cookie);
  const hostRoomChat = await ok<Page<{id: string}>>(`conversations?flightId=${host.room.id}`, hostCookie);
  assert.deepEqual(winnerRoomChat.data.items.map(({id}) => id), [directId]);
  assert.deepEqual(hostRoomChat.data.items.map(({id}) => id), [directId]);
  const direct = `conversations/${directId}/messages`;
  const {data: sent} = await ok<Message>(direct, hostCookie, post(message('Could we share a cab from Saket?')));
  assert.equal((await ok<Page<Message>>(direct, winner.cookie)).data.items[0].id, sent.id);
  await denied(direct, loser.cookie, 404);
  for (const [member, otherRoom] of [[winner, host], [host, winner]]) {
    for (const resource of ['', '/passengers', '/rides', '/group-messages']) await denied(`${otherRoom.path}${resource}`, member.cookie, 404);
  }
  const loserRequest = loser === a ? ra : rb;
  assert.equal((await decide(loser, loserRequest.id, 'withdraw')).status, 200);
  assert.equal((await requests(loser, 'sent'))[0].status, 'WITHDRAWN');
  await ok(`${host.path}/rides/${listing.id}`, hostCookie, remove);
  assert.equal((await browse(host)).ownListing, null);
  assert.equal((await requests(d, 'sent')).find(({id}) => id === rd.id)?.status, 'CLOSED');
  assert.equal((await requests(winner, 'sent'))[0].status, 'ACCEPTED');
  assert.equal((await ok<Page<Message>>(direct, winner.cookie)).data.items[0].id, sent.id, 'Closing the listing does not delete or hide existing private chat');
  const nextListing = await publish(host, 2);
  const nextRequest = await ask(winner, nextListing, {seats: 2});
  const again = await decide(host, nextRequest.id, 'accept');
  assert.ok('data' in again.envelope);
  assert.equal(again.envelope.data.conversationId, directId, 'Subsequent accepted cabs reuse the same conversation');
  assert.equal((await decide(winner, nextRequest.id, 'withdraw')).status, 200);
  assert.equal((await browse(host)).ownListing?.availableSeats, 2, 'Accepted riders can release their seats');
  await ok(`conversations/${directId}/block`, winner.cookie, post({}));
  await denied(direct, hostCookie, 404);
  await denied(direct, winner.cookie, 404);
  assert.deepEqual((await browse(winner)).items.filter(({id}) => id === nextListing.id), []);
  assert.deepEqual((await requests(winner, 'sent')), []);
  assert.ok(!(await requests(host, 'received')).some(({id}) => id === nextRequest.id));
  await denied(`${winner.path}/rides/${nextListing.id}/requests`, winner.cookie, 404, post({}));
  const {data: blocks} = await ok<{items: {id: string}[]}>('blocks', winner.cookie);
  await ok(`blocks/${blocks.items[0].id}`, winner.cookie, remove);
  await ok(`${host.path}/leave`, hostCookie, remove);
  await denied(direct, winner.cookie, 404);
  await denied(`${host.path}/ride-requests`, hostCookie, 404);
  assert.deepEqual(await requests(winner, 'sent'), []);
  const rejoined = await join(hostCookie, flight(0, '23:50'), 'Host Traveller');
  assert.equal(rejoined.room.membership.id, host.room.membership.id);
  assert.equal((await browse(rejoined)).ownListing, null, 'Leaving closes listings permanently; rejoining does not republish them');
  assert.deepEqual((await ok<{flyer: Flyer}>('profile', hostCookie)).data.flyer, flightCredit, 'Rejoining does not award extra Flyer points');
});

test('flight group history stays member-only and excludes blocked messages', {timeout: 120_000}, async (t) => {
  const {guest, flight, join} = fixture(t, 96);
  const [hostCookie, lateCookie, outsiderCookie] = await Promise.all([guest(), guest(), guest()]);
  const details = flight(0, '10:00');
  const host = await join(hostCookie, details, 'Group Host');
  const group = `${host.path}/group-messages`;
  const early = message('Welcome to the flight room.');
  const {data: first} = await ok<Message>(group, hostCookie, post(early));
  assert.equal((await ok<Message>(group, hostCookie, post(early))).data.id, first.id);
  await denied(group, lateCookie, 404);
  await denied(group, lateCookie, 404, post(message('Not a member yet.')));
  const late = await join(lateCookie, details, 'Late Traveller');
  assert.equal(late.room.id, host.room.id);
  const read = async (cookie: string) => (await ok<Page<Message>>(group, cookie)).data.items;
  const history = await read(lateCookie);
  assert.deepEqual(history.map(({id, content, isOwn, displayName}) => ({id, content, isOwn, displayName})), [{id: first.id, content: early.content, isOwn: false, displayName: 'Group Host'}]);
  assert.ok(!('clientId' in history[0]), 'Other passengers do not receive the sender’s client retry identifier');
  const {data: lateMessage} = await ok<Message>(group, lateCookie, post(message('Hello, I just joined.')));
  assert.ok((await read(hostCookie)).some(({id}) => id === lateMessage.id));
  await ok(`${host.path}/block`, hostCookie, post({passengerId: late.room.membership.id}));
  assert.deepEqual((await read(hostCookie)).map(({id}) => id), [first.id]);
  assert.deepEqual((await read(lateCookie)).map(({id}) => id), [lateMessage.id]);
  await denied(group, outsiderCookie, 404);
  await ok(`${host.path}/leave`, hostCookie, remove);
  await denied(group, hostCookie, 404);
});