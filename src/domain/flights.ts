export type FlightDetails = {
  airline: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDate: string;
  departureTime?: string | null;
  externalFlightId?: string | null;
};

export function normalizeFlightNumber(airline: string, number: string) {
  const compact = number.trim().toUpperCase().replace(/\s/g, '');
  return (compact.startsWith(airline) ? compact.slice(airline.length) : compact).replace(/^0+(?=\d)/, '');
}

export function flightKey(flight: FlightDetails) {
  const airline = flight.airline.trim().toUpperCase();
  const natural = [airline, normalizeFlightNumber(airline, flight.flightNumber), flight.departureAirport.trim().toUpperCase(), flight.arrivalAirport.trim().toUpperCase(), flight.departureDate];
  return JSON.stringify(flight.externalFlightId ? [...natural, flight.externalFlightId] : natural);
}

export function localDate(offset = 0) {
  // UTC date arithmetic avoids DST, without interpreting a submitted local flight date as an instant.
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}