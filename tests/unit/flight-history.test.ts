import assert from 'node:assert/strict';
import {test} from 'node:test';
import {historyCutoff} from '../../src/domain/flight-history';
import {mapSchedule} from '../../src/server/providers/schedule';

const departureDate = '2028-03-01';

test('history starts exactly three hours after an actual overnight landing', () => {
  const cutoff = historyCutoff({departureDate, status: 'Arrived', landedAt: '2028-03-02T03:15:00+05:30',
    estimatedArrivalAt: '2028-03-02T04:10:00+05:30', scheduledArrivalAt: '2028-03-02T03:00:00+05:30'});
  assert.equal(cutoff, Date.parse('2028-03-02T06:15:00+05:30'));
  const pastAt = (at: string) => cutoff !== null && Date.parse(at) >= cutoff;
  assert.equal(pastAt('2028-03-02T06:14:59.999+05:30'), false);
  assert.equal(pastAt('2028-03-02T06:15:00+05:30'), true);
});

test('current airborne status overrides a passed arrival estimate', () => {
  const scheduledArrivalAt = '2028-03-01T21:00:00Z';
  const estimatedArrivalAt = '2028-03-01T23:00:00Z';
  assert.equal(historyCutoff({departureDate, scheduledArrivalAt}), Date.parse('2028-03-02T00:00:00Z'));
  assert.equal(historyCutoff({departureDate, scheduledArrivalAt, estimatedArrivalAt}), Date.parse('2028-03-02T02:00:00Z'));
  const arrivalCheckedAt = '2028-03-02T02:30:00Z';
  for (const status of ['EnRoute', 'Departed', 'Approaching']) {
    assert.equal(historyCutoff({departureDate, scheduledArrivalAt, estimatedArrivalAt, status, arrivalCheckedAt}), null);
  }
});

test('missing and invalid timestamps use a conservative date fallback without declaring a landing', () => {
  const expected = Date.parse('2028-03-03T12:00:00Z');
  assert.equal(historyCutoff({departureDate}), expected);
  assert.equal(historyCutoff({departureDate, scheduledArrivalAt: 'unknown', status: 'Unknown'}), expected);
  assert.equal(historyCutoff({departureDate: 'invalid'}), null);
});

test('schedule adapter parses dated estimates but treats runway time as a landing only if arrived', () => {
  const query = {code: '6E203', date: departureDate};
  const departure = {airport: {iata: 'DEL'}, scheduledTime: {local: `${departureDate} 23:30+05:30`}};
  const arrival = {airport: {iata: 'BOM'}, scheduledTime: {local: '2028-03-02 01:00+05:30'}, revisedTime: {utc: '2028-03-01 20:15Z'},
    runwayTime: {local: '2028-03-02T01:32:00+05:30'}};
  const [enRoute, arrived] = mapSchedule([{departure, arrival, status: 'EnRoute'}, {departure, arrival, status: 'Arrived'}], query);
  assert.equal(enRoute.scheduledArrivalAt, '2028-03-01T19:30:00.000Z');
  assert.equal(enRoute.estimatedArrivalAt, '2028-03-01T20:15:00.000Z');
  assert.equal(enRoute.status, 'EnRoute');
  assert.equal(enRoute.landedAt, undefined);
  assert.equal(arrived.landedAt, '2028-03-01T20:02:00.000Z');
});