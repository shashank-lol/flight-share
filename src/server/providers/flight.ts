import {localDate, type FlightDetails} from '@/domain/flights';
import {demoBooking, demoFlight} from '@/domain/demo';
import type {VerificationStatus} from '@prisma/client';
import {canUseDevDelivery} from '../config';
import {HttpError} from '../errors';

export type Verification = { flight: FlightDetails; verificationStatus: VerificationStatus; method: string; suggestedDisplayName?: string };
export interface FlightProvider {
  verifyBooking(input: Readonly<{pnr: string; surname: string; departureDate?: string}>): Promise<Verification>;
}

class ManualOnlyProvider implements FlightProvider {
  async verifyBooking(): Promise<never> {
    throw new HttpError(422, 'BOOKING_VERIFICATION_UNAVAILABLE', 'Live booking verification is unavailable. Enter flight details manually to continue.');
  }
}

class MockFlightProvider implements FlightProvider {
  async verifyBooking(input: {pnr: string; surname: string; departureDate?: string}): Promise<Verification> {
    if (input.pnr !== demoBooking.pnr || input.surname.toLowerCase() !== demoBooking.surname.toLowerCase()) {
      throw new HttpError(422, 'MOCK_BOOKING_NOT_FOUND', 'Only the documented demo reference is accepted. Do not enter a real booking reference.');
    }
    return {
      flight: {...demoFlight, departureDate: input.departureDate ?? localDate(7)},
      verificationStatus: 'MOCK', method: 'MOCK', suggestedDisplayName: demoBooking.firstName,
    };
  }
}

export function flightProvider(): FlightProvider {
  return canUseDevDelivery() && process.env.FLIGHT_PROVIDER === 'mock' ? new MockFlightProvider() : new ManualOnlyProvider();
}