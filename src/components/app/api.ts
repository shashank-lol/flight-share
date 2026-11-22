export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, options: {method?: string; body?: unknown; signal?: AbortSignal} = {}): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    ...(options.body !== undefined ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(options.body)} : {}),
  });
  const result = await response.json().catch(() => null) as {data?: T; error?: {code: string; message: string}} | null;
  if (!response.ok || !result || !('data' in result)) {
    throw new ApiError(response.status, result?.error?.code ?? 'REQUEST_FAILED', result?.error?.message ?? 'We couldn’t complete that request. Please try again.');
  }
  return result.data as T;
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Couldn’t reach Flight Share. Check your connection and try again.';
}

export type VerificationStatus = 'SELF_REPORTED' | 'MOCK' | 'VERIFIED';
export type Transportation = 'NONE' | 'CAB_SHARE' | 'PUBLIC_TRANSIT' | 'OWN_RIDE';
export type Preferences = {
  displayName: string; isAnonymous: boolean; showBaggage: boolean; showTravelPreferences: boolean;
  transportation: Transportation; companionship: boolean; showFlyer: boolean;
};
export const defaultPreferences: Preferences = {displayName: '', isAnonymous: false, showBaggage: true, showTravelPreferences: true, transportation: 'NONE', companionship: false, showFlyer: true};
export const transportationLabels: Record<Transportation, string> = {NONE: 'No preference', CAB_SHARE: 'Open to sharing a cab', PUBLIC_TRANSIT: 'Taking public transit', OWN_RIDE: 'Arranging my own ride'};
export type Baggage = {baggageAllowance: number; expectedBaggageWeight: number; cabinBaggage: string | null};
export type FlightDetails = {airline: string; flightNumber: string; departureAirport: string; arrivalAirport: string; departureDate: string; departureTime: string | null};
export type Flight = FlightDetails & {id: string; status: string; memberCount: number};
export type RideSettings = {partySize: number; rideOptIn: boolean; pickupArea: string | null};
export type Room = Flight & {membership: Baggage & RideSettings & {id: string; verificationStatus: VerificationStatus; baggageReported: boolean}};
export type Flyer = {points: number; tier: 'New Flyer' | 'Silver Flyer' | 'Gold Flyer' | 'Platinum Flyer'; flightsAdded: number; ridesConfirmed: number};
export type Profile = {profile: Preferences | null; flights: Flight[]; flyer: Flyer};
export type Passenger = {
  id: string; displayName: string; alias: string; isAnonymous: boolean; isSelf: boolean;
  verificationStatus: VerificationStatus; baggageAllowance: number | null; expectedBaggageWeight: number | null;
  remainingWeight: number | null; transportation: Transportation | null; companionship: boolean | null; partySize: number | null;
};
export type Page<T> = {items: T[]; page: number; hasMore: boolean};
export type RideMatch = {id: string; displayName: string; alias: string; partySize: number; pickupArea: string | null; departureTime: string; departureDate: string; flightLabel: string; minutesApart: number; flyer: Flyer | null};
export type RideResults = Page<RideMatch> & {eligibility: 'READY' | 'OPT_IN_REQUIRED' | 'MISSING_TIME' | 'EXPIRED'};
export type WeightMatch = {passengerId: string; displayName: string; excess: number; available: number; potentialWeight: number; remainingExcess: number; status: string};
export type Policy = {status: string; summary: string; restrictions: string[]};

export function flightLabel(flight: FlightDetails) { return `${flight.airline} ${flight.flightNumber}`; }

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(new Date(`${value}T00:00:00Z`));
}

export function formatKg(value: number) { return `${new Intl.NumberFormat('en', {maximumFractionDigits: 2}).format(value)} kg`; }