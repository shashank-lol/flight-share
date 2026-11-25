'use client';

import {ArrowRight, ClipboardPaste, FileText, Search, ShieldCheck} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {demoFlight} from '@/domain/demo';
import {parseTicketText} from '@/domain/ticket';
import {ApiError, flightLabel, formatDate, type FlightDetails} from './api';
import {Field} from './fields';
import {ErrorMessage, FlightTicket, Notice} from './ui';

export type SearchResults = {items: {flight: FlightDetails; source: 'COMMUNITY' | 'SCHEDULE' | 'DEMO'}[]; liveEnabled: boolean; liveError?: boolean};
const sources = {COMMUNITY: 'Community entry', SCHEDULE: 'Published schedule', DEMO: 'Demo schedule'};
const exampleCode = `${demoFlight.airline}${demoFlight.flightNumber}`;
const exampleTicket = `Flight ${demoFlight.airline} ${demoFlight.flightNumber}\n${demoFlight.departureAirport} → ${demoFlight.arrivalAirport}\nDeparture: 2026-12-05 ${demoFlight.departureTime}`;

export function FlightSearch({code, date, results, busy, onCode, onDate, onSearch, onSelect, onManual}: {
  code: string; date: string; results?: SearchResults; busy: boolean;
  onCode: (value: string) => void; onDate: (value: string) => void; onSearch: () => void;
  onSelect: (flight: FlightDetails, source: SearchResults['items'][number]['source']) => void; onManual: () => void;
}) {
  return <>
    <form className="fa-form" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
      <div className="fa-fields-two fa-search-fields">
        <Field label="Flight code" hint="Include the airline code."><input className="fa-uppercase" autoComplete="off" autoCapitalize="characters" spellCheck={false} required readOnly={busy} maxLength={16} pattern="([A-Za-z]{3}|[A-Za-z][A-Za-z0-9]|[0-9][A-Za-z]) *[0-9]{1,4}[A-Za-z]?" placeholder={`e.g. ${exampleCode}`} value={code} onChange={(event) => onCode(event.target.value.toUpperCase())} /></Field>
        <Field label="Departure date" hint="Use the date at your departure airport."><input type="date" required readOnly={busy} value={date} onChange={(event) => onDate(event.target.value)} /></Field>
      </div>
      <button type="submit" className="fa-button fa-primary" disabled={busy}><Search size={17} aria-hidden="true" /> {busy ? 'Working…' : 'Search flights'}</button>
    </form>
    {results && <div className="fa-entry-results" aria-live="polite">
      {results.items.length ? <>
        <h2>Choose your flight</h2>
        <p className="fa-muted">Check the route and time against your ticket. Search results don’t verify your booking.</p>
        <ul>{results.items.map(({flight, source}) => <li key={`${flightLabel(flight)}-${flight.departureAirport}-${flight.arrivalAirport}-${flight.departureDate}`}>
          <span className="fa-badge">{sources[source]}</span><FlightTicket flight={flight} />
          <button type="button" className="fa-button fa-secondary" disabled={busy} onClick={() => onSelect(flight, source)}>Use this flight<span className="fa-sr-only">: {flightLabel(flight)}, {flight.departureAirport} to {flight.arrivalAirport}</span> <ArrowRight size={16} aria-hidden="true" /></button>
        </li>)}</ul>
      </> : <div className="fa-entry-empty"><h2>No flights found</h2><p className="fa-muted">Check the flight code and departure date, or add the details from your itinerary.</p></div>}
      {(!results.liveEnabled || results.liveError) && <p className="fa-entry-caption">{results.liveError ? 'Live schedules are temporarily unavailable.' : 'Live schedule lookup isn’t available here.'} You can still add your flight manually.</p>}
      <button type="button" className="fa-text-button" disabled={busy} onClick={onManual}>Enter flight details manually <ArrowRight size={15} aria-hidden="true" /></button>
    </div>}
  </>;
}

type ParsedTicket = ReturnType<typeof parseTicketText>;

export function TicketImport({onImport}: {onImport: (flight: FlightDetails, suggestedName?: string) => void}) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedTicket>();
  const [error, setError] = useState<unknown>();

  function importTicket(event: FormEvent) {
    event.preventDefault();
    const ticket = parseTicketText(text.trim());
    setText('');
    if (!ticket.legs.length) {
      setError(new ApiError(400, 'TICKET_NOT_READ', 'We couldn’t find a flight code, route and departure date in that text. Try copying those lines together, or use Manual entry.'));
      return;
    }
    if (ticket.legs.length === 1) { choose(ticket.legs[0], ticket.displayName); return; }
    setParsed(ticket);
  }

  function choose(leg: ParsedTicket['legs'][number], name?: string) {
    setParsed(undefined);
    onImport({...leg, departureTime: leg.departureTime ?? null}, name);
  }

  if (parsed) return <div className="fa-entry-results">
    <h2>Which leg are you adding?</h2><p className="fa-muted">Add one flight at a time. Each leg has its own room.</p>
    <ul>{parsed.legs.map((leg, index) => <li key={index}><button type="button" className="fa-entry-leg" onClick={() => choose(leg, parsed.displayName)}><FileText size={20} aria-hidden="true" /><span><strong>{flightLabel({...leg, departureTime: leg.departureTime ?? null})} · {leg.departureAirport} → {leg.arrivalAirport}</strong><small>{formatDate(leg.departureDate)}{leg.departureTime ? ` · ${leg.departureTime} local` : ''}</small></span><ArrowRight size={16} aria-hidden="true" /></button></li>)}</ul>
    <button type="button" className="fa-text-button" onClick={() => setParsed(undefined)}>Paste a different ticket</button>
  </div>;

  return <form className="fa-form" onSubmit={importTicket}>
    <Notice icon={ShieldCheck}>This text stays on your device and is cleared after import. Only the flight details you confirm are sent. You can choose whether to use the first name on the ticket.</Notice>
    <Field label="Ticket text" hint="Paste a boarding pass barcode as text, or the flight, route and local departure date from your itinerary."><textarea rows={5} required maxLength={12_000} autoComplete="off" spellCheck={false} placeholder={exampleTicket} value={text} onChange={(event) => { setText(event.target.value); setError(undefined); }} /></Field>
    <ErrorMessage error={error} />
    <button className="fa-button fa-primary" type="submit"><ClipboardPaste size={17} aria-hidden="true" /> Import ticket</button>
  </form>;
}