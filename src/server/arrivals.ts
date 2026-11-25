import type {Flight, Prisma} from '@prisma/client';
import {airborne, historyCutoff} from '@/domain/flight-history';
import type {FlightDetails} from '@/domain/flights';
import {prisma} from './db';
import {cachedSchedule, liveSchedule, type ScheduledFlight} from './providers/schedule';
import {redis} from './redis';

const hour = 3_600_000;
const refreshInterval = hour;
const cooldown = 1800;
const dailyBudget = 12;

type Identity = Pick<FlightDetails, 'airline' | 'flightNumber' | 'departureAirport' | 'arrivalAirport' | 'departureDate'>;

function lookup(identity: Identity) {
  const code = `${identity.airline}${identity.flightNumber}`;
  return /^(?:[A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/.test(code) ? {code, date: identity.departureDate} : null;
}

function routeMatch(rows: ScheduledFlight[] | null, flight: Identity) {
  const matches = rows?.filter((row) => row.departureAirport === flight.departureAirport && row.arrivalAirport === flight.arrivalAirport);
  return matches?.length === 1 ? matches[0] : undefined;
}

export async function knownArrival(flight: Identity) {
  const query = lookup(flight);
  if (!query) return undefined;
  try { return routeMatch(await cachedSchedule(query), flight); } catch { return undefined; }
}

export function arrivalUpdate(schedule: ScheduledFlight): Pick<Prisma.FlightUncheckedUpdateInput, 'scheduledArrivalAt' | 'estimatedArrivalAt' | 'landedAt' | 'status'> {
  return {
    ...(schedule.scheduledArrivalAt ? {scheduledArrivalAt: new Date(schedule.scheduledArrivalAt)} : {}),
    ...(schedule.estimatedArrivalAt ? {estimatedArrivalAt: new Date(schedule.estimatedArrivalAt)} : {}),
    ...(schedule.landedAt ? {landedAt: new Date(schedule.landedAt)} : {}),
    ...(schedule.status && schedule.status !== 'Unknown' ? {status: schedule.status} : {}),
  };
}

export function flightHistoryCutoff(flight: Flight) {
  return historyCutoff({departureDate: flight.departureDate.toISOString().slice(0, 10), status: flight.status,
    scheduledArrivalAt: flight.scheduledArrivalAt?.toISOString(), estimatedArrivalAt: flight.estimatedArrivalAt?.toISOString(),
    landedAt: flight.landedAt?.toISOString(), arrivalCheckedAt: flight.arrivalCheckedAt?.toISOString()});
}

async function takeRefreshBudget(userId: string, code: string, date: string) {
  // Shared by all app instances; explicit flight search has its own limits.
  const result = await redis.eval(`
    local used = tonumber(redis.call('GET', KEYS[1]) or '0')
    if used >= tonumber(ARGV[1]) or redis.call('EXISTS', KEYS[2], KEYS[3]) > 0 then return 0 end
    if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], 86400) end
    redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
    redis.call('SET', KEYS[3], '1', 'EX', 3600)
    return 1
  `, 3, 'fs:arrival:budget', `fs:arrival:user:${userId}`, `fs:arrival:code:${code}:${date}`, dailyBudget, cooldown);
  return result === 1;
}

export async function refreshArrival(userId: string, flights: Flight[], now: Date): Promise<void> {
  if (!process.env.AERODATABOX_RAPIDAPI_KEY?.trim()) return;
  const candidates = flights.filter((flight) => {
    if (flight.landedAt || (flight.status === 'Arrived' && (flight.estimatedArrivalAt || flight.scheduledArrivalAt))) return false;
    const age = +now - +flight.departureDate;
    const expected = flight.estimatedArrivalAt ?? flight.scheduledArrivalAt;
    return age >= 0 && (age < 72 * hour || (airborne(flight.status) && age < 168 * hour)) && (!expected || airborne(flight.status) || +expected - +now <= hour)
      && (!flight.arrivalCheckedAt || +now - +flight.arrivalCheckedAt >= refreshInterval);
  }).sort((a, b) => +(a.arrivalCheckedAt ?? 0) - +(b.arrivalCheckedAt ?? 0));
  try {
    for (const flight of candidates.slice(0, 8)) {
      const identity = {...flight, departureDate: flight.departureDate.toISOString().slice(0, 10)};
      const query = lookup(identity);
      if (!query) continue;
      const cached = await cachedSchedule(query);
      if (cached === null && !await takeRefreshBudget(userId, query.code, query.date)) continue;
      const schedule = routeMatch(cached ?? await liveSchedule(query), identity);
      const update = await prisma.flight.updateMany({where: {id: flight.id, arrivalCheckedAt: flight.arrivalCheckedAt, landedAt: null},
        data: {...(schedule ? arrivalUpdate(schedule) : {}), arrivalCheckedAt: now}});
      if (update.count) Object.assign(flight, await prisma.flight.findUniqueOrThrow({where: {id: flight.id}}));
      if (cached === null) break; // at most one live request per dashboard load
    }
  } catch { /* Retain known arrival data if Redis or the status provider is unavailable. */ }
}