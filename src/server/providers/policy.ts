import type {FlightDetails} from '@/domain/flights';

export interface AirlinePolicyProvider {
  getBaggagePolicy(airline: string, flightDetails: FlightDetails): Promise<{status: 'UNKNOWN' | 'RESTRICTED' | 'PUBLISHED'; summary: string; restrictions: string[]}>;
  canPoolAllowance(passengerA: string, passengerB: string): Promise<'UNKNOWN' | 'NOT_PERMITTED' | 'ASK_AIRLINE'>;
  getPolicyRestrictions(): string[];
}

const restrictions = [
  'Ask your airline whether pooling is allowed for your fare, route, and booking. Separate tickets do not automatically qualify.',
  'Keep your luggage with you and answer all baggage ownership questions accurately.',
  'Never accept, check in, or carry another traveller’s items. Follow airline and airport security instructions.',
];

export const airlinePolicyProvider: AirlinePolicyProvider = {
  async getBaggagePolicy() {
    return {status: 'UNKNOWN', summary: 'Pooling eligibility is not verified. Only your airline can confirm the rules for your booking.', restrictions: [...restrictions]};
  },
  async canPoolAllowance() { return 'UNKNOWN'; },
  getPolicyRestrictions() { return [...restrictions]; },
};