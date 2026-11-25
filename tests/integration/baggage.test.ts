import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {test, type TestContext} from 'node:test';

type Traveller = {session: string; membershipId: string; flightId: string};
type Request = {id: string; status: string; conversationId: string | null};
type Candidate = {passengerId: string};
type MatchPage = {items: Candidate[]; requests: (Request & {direction: string; displayName: string})[]; eligibility: string};
const origin = process.env.BASE_URL ?? process.env.APP_ORIGIN ?? 'http://localhost:3000';

async function api<T>(path: string, session = '', method = 'GET', body?: unknown) {
  const res = await fetch(`${origin}/api/v1/${path}`, {
    method, signal: AbortSignal.timeout(25_000),
    headers: {cookie: session, origin, ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const {data, error} = await res.json() as {data: T; error?: {code: string}};
  return {status: res.status, data, error, cookie: res.headers.get('set-cookie')?.split(';')[0]};
}

function expectStatus<T>(response: {status: number; data: T; error?: unknown}, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.error));
  return response.data;
}

function fixture(t: TestContext) {
  const sessions: string[] = [];
  t.after(() => Promise.allSettled(sessions.map((session) => api('profile', session, 'DELETE'))));
  const details = {method: 'manual', airline: '6E', flightNumber: String(randomInt(1000, 9999)), departureAirport: 'HYD', arrivalAirport: 'BLR'};
  async function traveller(displayName: string, weight: number | undefined, days = 17): Promise<Traveller> {
    const guest = await api('auth/guest', '', 'POST', {});
    expectStatus(guest);
    assert.ok(guest.cookie);
    const session = guest.cookie;
    sessions.push(session);
    const departureDate = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const {token} = expectStatus(await api<{token: string}>('flights/verify', session, 'POST', {...details, departureDate}));
    const {id: flightId} = expectStatus(await api<{id: string}>('flights/join', session, 'POST', {
      token, displayName, ...(weight === undefined ? {} : {baggageAllowance: 20, expectedBaggageWeight: weight}),
    }));
    const {membership} = expectStatus(await api<{membership: {id: string}}>(`flights/${flightId}`, session));
    return {session, flightId, membershipId: membership.id};
  }
  return {traveller};
}

const matchPage = async (a: Traveller) => expectStatus(await api<MatchPage>(`flights/${a.flightId}/matches`, a.session));
const send = (a: Traveller, b: Traveller) => api<Request>(`flights/${a.flightId}/baggage-requests`, a.session, 'POST', {passengerId: b.membershipId});
const decide = (a: Traveller, r: Request, action: string) => api<Request>(`flights/${a.flightId}/baggage-requests/${r.id}`, a.session, 'PATCH', {action});
const weight = (a: Traveller, expectedBaggageWeight: number) => api('profile/baggage', a.session, 'PATCH', {flightId: a.flightId, expectedBaggageWeight});
const hasCandidate = (page: MatchPage, b: Traveller) => page.items.some(({passengerId}) => passengerId === b.membershipId);

test('baggage requests support private confirmation, decline, withdraw, reopen, and safety retirement', {timeout: 120_000}, async (t) => {
  const {traveller} = fixture(t);
  const a = await traveller('Excess traveller', 27);
  const b = await traveller('Space traveller', 10);
  const c = await traveller('Another excess', 25);
  const missing = await traveller('Undeclared', undefined);
  const outsider = await traveller('Other flight', 10, 18);
  assert.equal((await matchPage(missing)).eligibility, 'MISSING_BAGGAGE');
  assert.equal(hasCandidate(await matchPage(a), b), true);
  expectStatus(await send(a, a), 404);
  expectStatus(await send(a, c), 404);
  expectStatus(await send(a, missing), 404);
  expectStatus(await send(a, outsider), 404);
  expectStatus(await api(`flights/${a.flightId}/matches`, outsider.session), 404);

  const initial = expectStatus(await send(a, b));
  assert.equal(initial.status, 'PENDING');
  assert.equal(initial.conversationId, null);
  assert.equal(expectStatus(await send(a, b)).id, initial.id);
  assert.equal((await matchPage(a)).requests[0]?.direction, 'OUTGOING');
  assert.equal((await matchPage(b)).requests[0]?.direction, 'INCOMING');
  assert.deepEqual((await matchPage(c)).requests, []);
  expectStatus(await decide(c, initial, 'accept'), 404);
  expectStatus(await decide({...outsider, flightId: a.flightId}, initial, 'accept'), 404);
  expectStatus(await decide(a, initial, 'accept'), 409);
  expectStatus(await decide(b, initial, 'withdraw'), 409);
  assert.equal(expectStatus(await decide(b, initial, 'decline')).status, 'DECLINED');
  assert.equal(hasCandidate(await matchPage(a), b), true);

  const next = expectStatus(await send(a, b));
  assert.notEqual(next.id, initial.id);
  assert.equal(expectStatus(await decide(a, next, 'withdraw')).status, 'WITHDRAWN');
  const stale = expectStatus(await send(a, b));
  expectStatus(await weight(a, 20));
  assert.equal((await matchPage(a)).eligibility, 'BALANCED');
  assert.deepEqual((await matchPage(b)).requests, []);
  expectStatus(await decide(b, stale, 'accept'), 409);
  expectStatus(await weight(a, 26));

  const visibilityChanged = expectStatus(await send(b, a));
  expectStatus(await api('profile', b.session, 'PATCH', {showBaggage: false}));
  assert.equal((await matchPage(b)).eligibility, 'PRIVATE');
  assert.deepEqual((await matchPage(a)).requests, []);
  expectStatus(await decide(a, visibilityChanged, 'accept'), 409);
  expectStatus(await api('profile', b.session, 'PATCH', {showBaggage: true}));

  const shared = expectStatus(await send(a, b));
  const accepted = expectStatus(await send(b, a));
  assert.equal(accepted.id, shared.id);
  assert.equal(accepted.status, 'ACCEPTED');
  assert.ok(accepted.conversationId);
  expectStatus(await api(`conversations/${accepted.conversationId}`, a.session));
  expectStatus(await api(`conversations/${accepted.conversationId}`, b.session));
  expectStatus(await api(`conversations/${accepted.conversationId}`, c.session), 404);
  for (const person of [a, b]) {
    const match = await matchPage(person);
    assert.equal(match.eligibility, 'MATCHED');
    assert.deepEqual(match.items, []);
    assert.equal(match.requests[0]?.conversationId, accepted.conversationId);
    const notices = expectStatus(await api<{items: {type: string; payload: unknown}[]}>('notifications', person.session));
    assert.deepEqual(notices.items.filter(({type}) => type === 'BAGGAGE_REQUEST_ACCEPTED').map(({payload}) => payload), [{flightId: a.flightId}]);
  }
  const thirdParty = await matchPage(c);
  assert.deepEqual(thirdParty.requests, []);
  assert.equal(hasCandidate(thirdParty, b), false);
  expectStatus(await send(c, b), 404);

  expectStatus(await weight(a, 20));
  expectStatus(await api('profile', b.session, 'PATCH', {showBaggage: false}));
  assert.equal((await matchPage(a)).eligibility, 'MATCHED');
  assert.equal((await matchPage(b)).eligibility, 'MATCHED');
  assert.equal(expectStatus(await decide(b, accepted, 'end')).status, 'ENDED');
  expectStatus(await api(`conversations/${accepted.conversationId}`, a.session));
  assert.equal((await matchPage(b)).eligibility, 'PRIVATE');
  expectStatus(await weight(a, 26));
  expectStatus(await api('profile', b.session, 'PATCH', {showBaggage: true}));
  assert.equal(hasCandidate(await matchPage(a), b), true);

  const rematch = expectStatus(await send(a, b));
  assert.equal(expectStatus(await decide(b, rematch, 'accept')).conversationId, accepted.conversationId);
  expectStatus(await api(`flights/${a.flightId}/block`, a.session, 'POST', {passengerId: b.membershipId}));
  assert.deepEqual((await matchPage(b)).requests, []);
  assert.equal(hasCandidate(await matchPage(c), b), true);
  expectStatus(await send(b, a), 404);
  expectStatus(await send(a, b), 404);
  expectStatus(await decide(b, rematch, 'end'), 404);
  expectStatus(await api(`conversations/${accepted.conversationId}`, b.session), 404);

  const third = expectStatus(await send(c, b));
  expectStatus(await decide(b, third, 'accept'));
  expectStatus(await api(`flights/${b.flightId}/leave`, b.session, 'DELETE'));
  expectStatus(await api(`flights/${b.flightId}/matches`, b.session), 404);
  assert.deepEqual((await matchPage(c)).requests, []);
  assert.equal((await matchPage(c)).eligibility, 'READY');
});

test('concurrent baggage acceptances share exactly one winner across request directions', {timeout: 120_000}, async (t) => {
  const {traveller} = fixture(t);
  const a = await traveller('Excess', 26);
  const b = await traveller('Space one', 15);
  const c = await traveller('Space two', 10);
  const d = await traveller('More excess', 29);
  const first = expectStatus(await send(b, a));
  const second = expectStatus(await send(a, c));
  const extraB = expectStatus(await send(d, b));
  const extraC = expectStatus(await send(c, d));

  const decisions = await Promise.all([decide(a, first, 'accept'), decide(c, second, 'accept')]);
  const successes = decisions.filter(({status}) => status === 200);
  assert.equal(successes.length, 1, JSON.stringify(decisions));
  assert.ok(decisions.some(({status}) => status === 409));
  const [{data: winner}] = successes;
  assert.equal(winner.status, 'ACCEPTED');
  assert.ok(winner.conversationId);
  const winnerPeer = winner.id === first.id ? b : c;
  const otherPeer = winner.id === first.id ? c : b;
  const cancelled = winner.id === first.id ? extraB : extraC;
  const outstanding = winner.id === first.id ? extraC : extraB;
  assert.equal((await matchPage(a)).requests[0]?.id, winner.id);
  assert.equal((await matchPage(winnerPeer)).requests[0]?.id, winner.id);
  assert.equal((await matchPage(otherPeer)).eligibility, 'READY');
  const thirdParty = await matchPage(d);
  assert.deepEqual(thirdParty.requests.map(({id}) => id), [outstanding.id]);
  assert.equal(hasCandidate(thirdParty, winnerPeer), false);
  expectStatus(await decide(winner.id === first.id ? b : d, cancelled, 'accept'), 409);
  expectStatus(await api(`conversations/${winner.conversationId}`, otherPeer.session), 404);

  expectStatus(await decide(a, winner, 'end'));
  const reverse = await Promise.all([send(a, winnerPeer), send(winnerPeer, a)]);
  assert.deepEqual(reverse.map((r) => expectStatus(r).status).sort(), ['ACCEPTED', 'PENDING']);
  assert.equal(reverse[0].data.id, reverse[1].data.id);
  assert.equal((await matchPage(a)).requests[0]?.conversationId, winner.conversationId);
});