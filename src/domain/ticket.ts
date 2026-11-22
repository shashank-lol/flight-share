type TicketLeg = {airline: string; flightNumber: string; departureAirport: string; arrivalAirport: string; departureDate: string; departureTime?: string};
type Ticket = {displayName?: string; legs: TicketLeg[]};
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function givenName(input: string) {
  const value = input.trim().split(/\s+/)[0];
  if (!value || !/^[\p{L}\p{M}][\p{L}\p{M}’'\-]{0,46}$/u.test(value)) return undefined;
  return value === value.toUpperCase() ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
}

function dateString(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(+value) || year !== value.getUTCFullYear() || month !== value.getUTCMonth() + 1 || day !== value.getUTCDate()) return undefined;
  return value.toISOString().slice(0, 10);
}

/** Runs in the browser. Returns a first-name suggestion and itinerary fields only, never PNR or surname. */
export function parseTicketText(input: string, reference = new Date()): Ticket {
  const raw = input.slice(0, 12_000).replace(/\r\n?/g, '\n');
  const bcbp = /^M([1-4])(.{20})[A-Z0-9 ](.+)$/i.exec(raw);
  if (bcbp && bcbp[3].length >= 35) {
    const legs: TicketLeg[] = [];
    let rest = bcbp[3];
    for (let i = 0; i < +bcbp[1]; i++) {
      const [, from, to, airline, number, julian, variableLength] = /^.{7}([A-Z]{3})([A-Z]{3})([A-Z0-9 ]{3})([0-9A-Z ]{5})(\d{3})[A-Z0-9 ]{11}([0-9A-F]{2})/i.exec(rest) ?? [];
      if (!julian || +julian < 1 || +julian > 366 || from === to) break;
      const next = [reference.getUTCFullYear() - 1, reference.getUTCFullYear(), reference.getUTCFullYear() + 1]
        .map((year) => ({year, date: new Date(Date.UTC(year, 0, +julian))})).filter(({year, date}) => date.getUTCFullYear() === year)
        .sort((a, b) => Math.abs(+a.date - +reference) - Math.abs(+b.date - +reference))[0];
      if (next) legs.push({airline: airline.trim().toUpperCase(), flightNumber: number.trim().toUpperCase(), departureAirport: from.toUpperCase(), arrivalAirport: to.toUpperCase(), departureDate: next.date.toISOString().slice(0, 10)});
      rest = rest.slice(37 + parseInt(variableLength, 16));
    }
    return {displayName: givenName(bcbp[2].split('/')[1] ?? ''), legs};
  }

  const who = /^(?:Passenger(?: name)?|Traveller(?: name)?|Traveler(?: name)?|Name)\s*:\s*([^\n]{1,100})/im.exec(raw)?.[1];
  const displayName = who ? givenName(who.includes('/') ? who.split('/')[1] : who) : undefined;
  const legs: TicketLeg[] = [];
  const segments = raw.split(/(?=^[ \t]*Flight(?: number)?[ \t]*:?[ \t]+(?:[A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])[ \t]*\d)/im);
  for (const block of segments.slice(0, 13)) {
    const flight = /\b(?:flight(?: number)?\s*:?\s*)([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])\s*(\d{1,4}[A-Z]?)\b/i.exec(block);
    const route = /\b([A-Z]{3})\s*(?:→|->|–|—|-|\bto\b)\s*([A-Z]{3})\b/.exec(block) ?? /\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/i.exec(block);
    const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(block);
    const readable = /\b(\d{1,2})\s+([A-Z]{3})[A-Z]*\s+(20\d{2})\b/i.exec(block);
    const date = iso ? dateString(+iso[1], +iso[2], +iso[3]) : readable ? dateString(+readable[3], months.indexOf(readable[2].toUpperCase()) + 1, +readable[1]) : undefined;
    const scheduled = /\bdepart(?:ure|s)?(?:\s+time)?\s*:?\s*[^\n]{0,40}?\b((?:[01]\d|2[0-3]):[0-5]\d)\b/i.exec(block)?.[1];
    if (flight && route && date && route[1].toUpperCase() !== route[2].toUpperCase()) legs.push({airline: flight[1].toUpperCase(), flightNumber: flight[2].toUpperCase(), departureAirport: route[1].toUpperCase(), arrivalAirport: route[2].toUpperCase(), departureDate: date, ...(scheduled ? {departureTime: scheduled} : {})});
  }
  return {displayName, legs};
}