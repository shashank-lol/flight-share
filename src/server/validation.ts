import {z} from 'zod';
import {localDate, normalizeFlightNumber} from '@/domain/flights';

const cleanText = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}]+$/u);
const upper = (pattern: RegExp) => z.string().trim().max(16).transform((value) => value.toUpperCase()).pipe(z.string().regex(pattern));
export const idSchema = z.uuid();
export const tripDateSchema = z.iso.date().refine((value) => value >= localDate(-1) && value <= localDate(366));
export const tripTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const airline = upper(/^[A-Z0-9]{2,3}$/);
const airport = upper(/^[A-Z]{3}$/);

const manual = z.object({
  method: z.literal('manual'), airline, flightNumber: z.string().trim().min(1).max(12),
  departureAirport: airport, arrivalAirport: airport, departureDate: tripDateSchema, departureTime: tripTimeSchema.optional(),
}).strict();
const booking = z.object({method: z.literal('pnr'), pnr: upper(/^[A-Z0-9]{5,8}$/), surname: cleanText(100), departureDate: tripDateSchema.optional()}).strict();
export const verifyFlightSchema = z.discriminatedUnion('method', [manual, booking]).transform((input, ctx) => {
  if (input.method === 'pnr') return input;
  const flightNumber = normalizeFlightNumber(input.airline, input.flightNumber);
  if (!/^\d{1,4}[A-Z]?$/.test(flightNumber)) ctx.addIssue({code: 'custom', path: ['flightNumber'], message: 'Invalid flight number'});
  if (input.departureAirport === input.arrivalAirport) ctx.addIssue({code: 'custom', path: ['arrivalAirport'], message: 'Use a different airport'});
  return {...input, flightNumber};
});

const profileFields = {
  displayName: cleanText(48), isAnonymous: z.boolean(), showBaggage: z.boolean(),
  showTravelPreferences: z.boolean(), transportation: z.enum(['NONE', 'CAB_SHARE', 'PUBLIC_TRANSIT', 'OWN_RIDE']),
  companionship: z.boolean(), showFlyer: z.boolean(),
};
export const profileSchema = z.object({
  displayName: profileFields.displayName, isAnonymous: profileFields.isAnonymous.default(false), showBaggage: profileFields.showBaggage.default(true),
  showTravelPreferences: profileFields.showTravelPreferences.default(true), transportation: profileFields.transportation.default('NONE'),
  companionship: profileFields.companionship.default(false), showFlyer: profileFields.showFlyer.default(true),
}).strict();
const kg = z.number().min(0).max(250).refine((weight) => Math.abs(weight * 100 - Math.round(weight * 100)) < 0.00001);
const weightsSchema = z.object({baggageAllowance: kg, expectedBaggageWeight: kg, cabinBaggage: cleanText(120).nullable().optional()});
const pickupArea = cleanText(60).refine((value) => /^[\p{L}\p{M}\d .,’'()\-]+$/u.test(value) && !/^\d/.test(value)).nullable().optional();
const partySize = z.number().int().min(1).max(12);
export const rideSettingsSchema = z.object({partySize, rideOptIn: z.boolean(), pickupArea, departureTime: tripTimeSchema.optional()}).strict();
export const joinFlightSchema = profileSchema.extend({
  ...weightsSchema.partial().shape, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  partySize: partySize.default(1), rideOptIn: z.boolean().default(false), pickupArea,
}).refine((entry) => (entry.baggageAllowance === undefined) === (entry.expectedBaggageWeight === undefined), {path: ['expectedBaggageWeight']});
export const editProfileSchema = z.object(profileFields).partial().strict();
export const baggageSchema = weightsSchema.partial().extend({flightId: idSchema}).strict().refine(({baggageAllowance, expectedBaggageWeight, cabinBaggage}) => baggageAllowance !== undefined || expectedBaggageWeight !== undefined || cabinBaggage !== undefined);
export const directorySchema = z.object({
  filter: z.enum(['all', 'excess', 'available', 'cab', 'companions']).default('all'),
  sort: z.enum(['recent', 'name', 'baggage']).default('recent'),
  q: z.string().trim().max(48).default(''), page: z.coerce.number().int().min(1).max(1000).default(1),
});