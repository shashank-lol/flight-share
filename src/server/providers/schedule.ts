import {z} from 'zod';
import {demoFlight} from '@/domain/demo';
import {flightKey, normalizeFlightNumber, type FlightDetails} from '@/domain/flights';
import {canUseDevDelivery} from '../config';
import {prisma} from '../db';
import {redis} from '../redis';
import {tripDateSchema} from '../validation';

export const scheduleQuery = z.object({code: z.string().trim().max(16).transform((s) => s.toUpperCase().replace(/\s/g, '')).pipe(z.string().regex(/^(?:[A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/)), date: tripDateSchema});
type Query = z.output<typeof scheduleQuery>;
type Result = {flight: FlightDetails; source: 'COMMUNITY' | 'SCHEDULE' | 'DEMO'};
export interface FlightScheduleProvider { search(query: Query): Promise<FlightDetails[]> }
const movement = z.object({airport: z.object({iata: z.string().regex(/^[A-Z]{3}$/)}), scheduledTime: z.object({local: z.string()}).nullish()});
const providerFlight = z.object({departure: movement, arrival: movement});

function flightCode(code: string) {
  const match = /^(?<airline>[A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])(?<number>\d{1,4}[A-Z]?)$/.exec(code);
  if (!match?.groups) throw new Error('Invalid validated flight code');
  return {airline: match.groups.airline, flightNumber: normalizeFlightNumber(match.groups.airline, match.groups.number)};
}

export function mapSchedule(payload: unknown, query: Query): FlightDetails[] {
  if (!Array.isArray(payload)) throw new Error('Unexpected schedule response');
  return payload.slice(0, 25).flatMap((value) => {
    const row = providerFlight.safeParse(value);
    if (!row.success) return [];
    const {departure, arrival} = row.data;
    const local = /^(\d{4}-\d{2}-\d{2})[T ]((?:[01]\d|2[0-3]):[0-5]\d)/.exec(departure.scheduledTime?.local ?? '');
    if (!local || local[1] !== query.date || departure.airport.iata === arrival.airport.iata) return [];
    return [{...flightCode(query.code), departureAirport: departure.airport.iata, arrivalAirport: arrival.airport.iata, departureDate: query.date, departureTime: local[2]}];
  });
}

const rapidHost = 'aerodatabox.p.rapidapi.com';

export class AeroDataBoxSchedule implements FlightScheduleProvider {
  constructor(private readonly key: string, private readonly request: typeof fetch = fetch) {}

  async search(query: Query) {
    const url = new URL(`/flights/number/${query.code}/${query.date}`, `https://${rapidHost}`);
    url.searchParams.set('dateLocalRole', 'Departure');
    url.searchParams.set('withAircraftImage', 'false');
    url.searchParams.set('withLocation', 'false');
    url.searchParams.set('withFlightPlan', 'false');
    const headers = new Headers({accept: 'application/json', 'x-rapidapi-key': this.key, 'x-rapidapi-host': rapidHost});
    const response = await this.request(url, {headers, signal: AbortSignal.timeout(4500), cache: 'no-store', redirect: 'error'});
    if (response.status === 204 || response.status === 404) return [];
    if (!response.ok) throw new Error('Schedule provider unavailable');
    return mapSchedule(await response.json(), query);
  }
}

export async function searchFlights(query: Query) {
  const identity = flightCode(query.code);
  const key = process.env.AERODATABOX_RAPIDAPI_KEY?.trim();
  let liveError = false;
  const live = async () => {
    if (!key) return [];
    const cacheKey = `fs:schedule:v2:rapidapi:${identity.airline}${identity.flightNumber}:${query.date}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as FlightDetails[];
      const results = await new AeroDataBoxSchedule(key).search(query);
      await redis.set(cacheKey, JSON.stringify(results), 'EX', results.length ? 3600 : 300);
      return results;
    } catch { liveError = true; return []; }
  };
  const [shared, scheduled] = await Promise.all([
    prisma.flight.findMany({where: {...identity, departureDate: new Date(`${query.date}T00:00:00Z`), memberships: {some: {isActive: true, verificationStatus: {not: 'MOCK'}}}}, take: 10, select: {departureAirport: true, arrivalAirport: true, departureTime: true}}),
    live(),
  ]);
  const items = new Map<string, Result>();
  function add(flight: FlightDetails, source: Result['source']) {
    const key = flightKey(flight);
    if (!items.has(key)) items.set(key, {flight, source});
  }
  scheduled.forEach((flight) => add(flight, 'SCHEDULE'));
  shared.forEach((flight) => add({...flight, ...identity, departureDate: query.date}, 'COMMUNITY'));
  if (canUseDevDelivery() && process.env.FLIGHT_PROVIDER === 'mock' && identity.airline === demoFlight.airline && identity.flightNumber === demoFlight.flightNumber) {
    add({...demoFlight, departureDate: query.date}, 'DEMO');
  }
  return {items: [...items.values()], liveEnabled: !!key, liveError};
}