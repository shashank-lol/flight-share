import assert from 'node:assert/strict';
import {test} from 'node:test';
import {flyerStats} from '../../src/domain/flyer';
import {localDate} from '../../src/domain/flights';
import {parseTicketText} from '../../src/domain/ticket';
import {AeroDataBoxSchedule, mapSchedule, scheduleQuery} from '../../src/server/providers/schedule';

test('ticket text returns separate legs and a first-name suggestion, not booking or surname fields', () => {
  const result = parseTicketText([
    'Passenger: PRIVATE-SURNAME/ALEX MORGAN',
    'Booking reference: XZY812',
    'Flight BA 117',
    'LHR → JFK',
    'Departure: 2028-02-29 08:25',
    'Flight number: AA 112A',
    'JFK — BOS',
    'Departure: 1 March 2028',
  ].join('\r\n'));
  assert.deepEqual(result, {
    displayName: 'Alex',
    legs: [
      {airline: 'BA', flightNumber: '117', departureAirport: 'LHR', arrivalAirport: 'JFK', departureDate: '2028-02-29', departureTime: '08:25'},
      {airline: 'AA', flightNumber: '112A', departureAirport: 'JFK', arrivalAirport: 'BOS', departureDate: '2028-03-01'},
    ],
  });
});

test('boarding pass text reads fixed-width segments across the year boundary without exposing reservation data', () => {
  const first = 'XZY812 LHRJFKBA 00117365Y004A0001 104ABCD';
  const second = 'KLM987 JFKBOSAA 00223002Y009C0002 100';
  const pass = `M2${'PRIVATE/ALEX'.padEnd(20)}E${first}${second}`;
  assert.deepEqual(parseTicketText(pass, new Date('2027-01-02T00:00:00Z')), {
    displayName: 'Alex',
    legs: [
      {airline: 'BA', flightNumber: '00117', departureAirport: 'LHR', arrivalAirport: 'JFK', departureDate: '2026-12-31'},
      {airline: 'AA', flightNumber: '00223', departureAirport: 'JFK', arrivalAirport: 'BOS', departureDate: '2027-01-02'},
    ],
  });
});

test('ticket parsing ignores incomplete, impossible, and same-airport segments', () => {
  for (const text of [
    '',
    'Booking reference: XZY812\nFlight BA 117\nDeparture: 2027-02-28',
    'Flight BA 117\nLHR → JFK',
    'Flight BA 117\nLHR → JFK\nDeparture: 2027-02-29',
    'Flight BA 117\nLHR → JFK\nDeparture: 1 Fobruary 2027',
    'Flight BA 117\nLHR → LHR\nDeparture: 2027-02-28',
  ]) {
    assert.deepEqual(parseTicketText(text).legs, [], `Unexpected leg for ${JSON.stringify(text)}`);
  }
  const partial = 'Flight BA 117\nDeparture: 2027-02-28\nFlight AA 112\nJFK → BOS\nDeparture: 2027-03-01 25:17';
  assert.deepEqual(parseTicketText(partial).legs, [
    {airline: 'AA', flightNumber: '112', departureAirport: 'JFK', arrivalAirport: 'BOS', departureDate: '2027-03-01'},
  ], 'Legs do not borrow each other’s fields; an invalid time is not imported');
});

test('Flyer uses cumulative threshold tiers and caps ride credit by distinct flight', () => {
  assert.deepEqual(flyerStats(0, 0), {points: 0, tier: 'New Flyer', flightsAdded: 0, ridesConfirmed: 0});
  assert.deepEqual(flyerStats(2, 3, 1), {points: 250, tier: 'New Flyer', flightsAdded: 2, ridesConfirmed: 3});
  for (const [flights, rides, points, tier] of [
    [2, 2, 300, 'Silver Flyer'],
    [6, 1, 650, 'Silver Flyer'],
    [6, 2, 700, 'Gold Flyer'],
    [14, 1, 1450, 'Gold Flyer'],
    [14, 2, 1500, 'Platinum Flyer'],
  ] as const) {
    assert.deepEqual(flyerStats(flights, rides), {points, tier, flightsAdded: flights, ridesConfirmed: rides});
  }
});

test('schedule adapter normalizes flight codes and keeps departure-local dates and times', () => {
  const date = '2028-02-29';
  const tomorrow = localDate(1);
  assert.deepEqual(scheduleQuery.parse({code: '  ba  0117 ', date: tomorrow}), {code: 'BA0117', date: tomorrow});
  assert.equal(scheduleQuery.safeParse({code: 'DEMO12 / ALEX', date: tomorrow}).success, false);

  const row = (local: string, destination = 'JFK') => ({
    departure: {airport: {iata: 'LHR'}, scheduledTime: {local, utc: '2028-02-28 23:05Z'}},
    arrival: {airport: {iata: destination}},
    number: 'Ignored provider label',
  });
  assert.deepEqual(mapSchedule([
    row(`${date}T01:05:00+02:00`),
    row('2028-02-28T23:05:00Z'),
    row(`${date} 09:00`, 'LHR'),
    row(`${date} 24:00`),
    row(`${date} 09:00`, '???'),
    {departure: {airport: {iata: 'LHR'}}, arrival: {airport: {iata: 'JFK'}}},
    null,
  ], {code: 'BA0117', date}), [
    {airline: 'BA', flightNumber: '117', departureAirport: 'LHR', arrivalAirport: 'JFK', departureDate: date, departureTime: '01:05'},
  ]);
  assert.throws(() => mapSchedule({data: []}, {code: 'BA0117', date}), /Unexpected schedule response/);
});

test('RapidAPI lookup uses the dated schedule endpoint and keeps credentials in headers', async () => {
  const date = '2027-01-05';
  let called = false;
  const provider = new AeroDataBoxSchedule('unit-test-placeholder', async (input, init) => {
    called = true;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://aerodatabox.p.rapidapi.com');
    assert.equal(url.pathname, `/flights/number/AS2223/${date}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), {dateLocalRole: 'Departure', withAircraftImage: 'false', withLocation: 'false', withFlightPlan: 'false'});
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-rapidapi-key'), 'unit-test-placeholder');
    assert.equal(headers.get('x-rapidapi-host'), url.hostname);
    assert.equal(headers.get('accept'), 'application/json');
    assert.equal(headers.has('x-api-key'), false);
    assert.equal(init?.redirect, 'error');
    return Response.json([{departure: {airport: {iata: 'SEA'}, scheduledTime: {local: `${date} 23:40-08:00`}}, arrival: {airport: {iata: 'PDX'}}}]);
  });
  assert.deepEqual(await provider.search({code: 'AS2223', date}), [
    {airline: 'AS', flightNumber: '2223', departureAirport: 'SEA', arrivalAirport: 'PDX', departureDate: date, departureTime: '23:40'},
  ]);
  assert.equal(called, true);
});

test('schedule lookup distinguishes no result from quota or authentication errors', async () => {
  const query = {code: 'AS2223', date: '2027-01-05'};
  for (const status of [204, 404, 401, 403, 429]) {
    const provider = new AeroDataBoxSchedule('unit-test-placeholder', async () => {
      return new Response(null, {status});
    });
    if (status === 204 || status === 404) assert.deepEqual(await provider.search(query), []);
    else await assert.rejects(provider.search(query), {message: 'Schedule provider unavailable'});
  }
});