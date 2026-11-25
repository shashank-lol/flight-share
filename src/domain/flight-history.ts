const hour = 60 * 60 * 1000;
const gracePeriod = 3 * hour;
// Without any arrival time, allow for the entire departure day in any time zone
// plus a long-haul flight. This is a history cutoff, not a claim that it landed.
const unknownArrivalCutoff = 60 * hour;

export type ArrivalTracking = {
  scheduledArrivalAt?: string | null;
  estimatedArrivalAt?: string | null;
  landedAt?: string | null;
  status?: string | null;
};

export const airborne = (status?: string | null) => ['EnRoute', 'Departed', 'Approaching', 'Diverted'].includes(status ?? '');

export function historyCutoff(flight: ArrivalTracking & {departureDate: string; arrivalCheckedAt?: string | null}): number | null {
  if (airborne(flight.status)) return null;
  const departure = Date.parse(`${flight.departureDate}T00:00:00.000Z`);
  const landed = flight.landedAt ? Date.parse(flight.landedAt) : NaN;
  if (Number.isFinite(landed)) return landed + gracePeriod;
  const arrival = [flight.estimatedArrivalAt, flight.scheduledArrivalAt].map((value) => value ? Date.parse(value) : NaN).find(Number.isFinite);
  const fallback = arrival === undefined ? departure + unknownArrivalCutoff : arrival + gracePeriod;
  const checked = flight.arrivalCheckedAt ? Date.parse(flight.arrivalCheckedAt) : NaN;
  // A delay reported without a revised arrival is not a reliable schedule.
  const cutoff = flight.status === 'Delayed' && arrival === undefined ? Math.max(fallback, (Number.isFinite(checked) ? checked : departure) + unknownArrivalCutoff) : fallback;
  return Number.isFinite(cutoff) ? cutoff : null;
}