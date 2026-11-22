import assert from 'node:assert/strict';
import {test} from 'node:test';
import {potentialMatch, remainingWeight} from '../../src/domain/baggage';
import {flightKey} from '../../src/domain/flights';
import {editProfileSchema} from '../../src/server/validation';

test('baggage balance keeps two decimal places and distinguishes excess', () => {
  assert.equal(remainingWeight(20, 23), -3);
  assert.equal(remainingWeight(20, 12), 8);
  assert.equal(remainingWeight(0.3, 0.2), 0.1);
  assert.equal(remainingWeight(23, 23), 0);
});

test('matches compute the possible fit and unresolved excess without approving pooling', () => {
  const full = {excess: 3, available: 8, potentialWeight: 3, remainingExcess: 0, status: 'POTENTIAL'};
  assert.deepEqual(potentialMatch(-3, 8), full);
  assert.deepEqual(potentialMatch(8, -3), full);
  assert.deepEqual(potentialMatch(-3.25, 2), {excess: 3.25, available: 2, potentialWeight: 2, remainingExcess: 1.25, status: 'POTENTIAL'});
  for (const [a, b] of [[0, 0], [0, 5], [-5, -2], [5, 2]]) assert.equal(potentialMatch(a, b), null);
});

test('flight keys normalize equivalent entries and scope the room to the flight instance', () => {
  const trip = {airline: 'BA', flightNumber: '117', departureAirport: 'LHR', arrivalAirport: 'JFK', departureDate: '2026-11-22'};
  assert.equal(flightKey(trip), flightKey({...trip, flightNumber: 'ba 0117', departureAirport: 'lhr', departureTime: '08:25'}));
  assert.notEqual(flightKey(trip), flightKey({...trip, departureDate: '2026-11-23'}));
  assert.notEqual(flightKey(trip), flightKey({...trip, arrivalAirport: 'BOS'}));
  assert.notEqual(flightKey({...trip, externalFlightId: 'one'}), flightKey({...trip, externalFlightId: 'two'}));
});

test('partial profile updates never reset omitted privacy preferences', () => {
  assert.deepEqual(editProfileSchema.parse({displayName: 'Sky'}), {displayName: 'Sky'});
  assert.deepEqual(editProfileSchema.parse({showBaggage: false}), {showBaggage: false});
});