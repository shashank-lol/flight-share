'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, ArrowRight, Check, ChevronRight, Plane, ShieldCheck, Users} from 'lucide-react';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {api, ApiError, defaultPreferences, type FlightDetails, type Preferences, type Profile, type VerificationStatus} from './api';
import {BaggageFields, baggagePayload, defaultRide, emptyBaggage, Field, PreferenceFields, RideFields, ridePayload} from './fields';
import {FlightSearch, TicketImport, type SearchResults} from './flight-entry';
import {AppBrand, ErrorMessage, Eyebrow, FlightTicket, Loading, Notice} from './ui';

type Step = 'loading' | 'flight' | 'profile';
type Verification = {token: string; flight: FlightDetails; verificationStatus: VerificationStatus; suggestedDisplayName?: string};
type EntryMethod = 'search' | 'paste' | 'manual' | 'pnr';
const entryMethods: {id: EntryMethod; label: string}[] = [{id: 'search', label: 'Search'}, {id: 'paste', label: 'Paste ticket'}, {id: 'manual', label: 'Manual entry'}, {id: 'pnr', label: 'Demo booking'}];
const stages = ['Your flight', 'Your preferences'];
const emptyBooking = {pnr: '', surname: '', departureDate: ''};
const codePattern = /^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4}[A-Z]?)$/;
const manualDraft = (flight: FlightDetails) => ({...flight, departureTime: flight.departureTime ?? ''});

function firstName(input?: string) {
  const name = input?.trim().split(/\s+/)[0];
  return name && /^[\p{L}\p{M}][\p{L}\p{M}’'\-]{0,46}$/u.test(name) ? name : undefined;
}

async function withGuest<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (issue) {
    if (!(issue instanceof ApiError) || issue.status !== 401) throw issue;
    await api('auth/guest', {method: 'POST', body: {}});
    return action();
  }
}

export function Onboarding({addFlight}: {addFlight: boolean}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [account, setAccount] = useState<Profile>();
  const [allowDemo, setAllowDemo] = useState(false);
  const [method, setMethod] = useState<EntryMethod>('search');
  const [search, setSearch] = useState({code: '', date: ''});
  const [searchResults, setSearchResults] = useState<SearchResults>();
  const [importedName, setImportedName] = useState<string>();
  const [importedFlight, setImportedFlight] = useState(false);
  const [verification, setVerification] = useState<Verification>();
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [baggage, setBaggage] = useState(emptyBaggage);
  const [ride, setRide] = useState(defaultRide);
  const [manual, setManual] = useState({airline: '', flightNumber: '', departureAirport: '', arrivalAirport: '', departureDate: '', departureTime: ''});
  const [booking, setBooking] = useState(emptyBooking);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const title = heading.current;
    if (!title) return;
    title.focus({preventScroll: true});
    title.scrollIntoView({block: 'nearest'});
  }, [step]);

  useEffect(() => {
    const controller = new AbortController();
    api<Profile>('profile', {signal: controller.signal}).then((current) => {
      if (controller.signal.aborted) return;
      if (current.flights.length && !addFlight) { router.replace('/dashboard'); return; }
      setAccount(current);
      setPreferences(current.profile ?? defaultPreferences);
      setStep('flight');
    }, () => { if (!controller.signal.aborted) setStep('flight'); });
    return () => controller.abort();
  }, [addFlight, router]);

  const canSelectFlight = step === 'flight' || step === 'profile';
  useEffect(() => {
    if (!canSelectFlight) return;
    const controller = new AbortController();
    api<{mockBookingEnabled: boolean}>('flights/options', {signal: controller.signal}).then(({mockBookingEnabled}) => {
      if (!controller.signal.aborted) setAllowDemo(mockBookingEnabled);
    }, () => {});
    return () => controller.abort();
  }, [canSelectFlight]);

  const stage = step === 'profile' ? 1 : 0;
  const changeStep = (next: Step) => { setError(undefined); setStep(next); };

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setError(undefined);
    setBusy(true);
    try { await action(); } catch (issue) { setError(issue); } finally { setBusy(false); }
  }

  function chooseMethod(next: EntryMethod) {
    if (method === next) return;
    setBooking(emptyBooking);
    setImportedName(undefined);
    setImportedFlight(false);
    setError(undefined);
    setMethod(next);
    if (next === 'manual' && method === 'search') {
      const identity = codePattern.exec(search.code.replace(/\s/g, ''));
      setManual((previous) => {
        const keepRoute = identity && previous.airline === identity[1] && previous.flightNumber === identity[2] && previous.departureDate === search.date;
        return {...previous, ...(identity ? {airline: identity[1], flightNumber: identity[2]} : {}), ...(search.date ? {departureDate: search.date} : {}),
          ...(!keepRoute && (identity || search.date) ? {departureAirport: '', arrivalAirport: '', departureTime: ''} : {})};
      });
    }
  }

  function lookup() {
    void perform(async () => {
      setSearchResults(undefined);
      const query = new URLSearchParams({code: search.code.replace(/\s/g, ''), date: search.date});
      setSearchResults(await withGuest(() => api<SearchResults>(`flights/search?${query}`)));
    });
  }

  async function verify(body: object) {
    const result = await withGuest(() => api<Verification>('flights/verify', {method: 'POST', body}));
    setBooking(emptyBooking);
    setVerification(result);
    setStep('profile');
  }

  function confirmDetails({airline, flightNumber, departureAirport, arrivalAirport, departureDate, departureTime}: FlightDetails) {
    return verify({method: 'manual', airline, flightNumber, departureAirport, arrivalAirport, departureDate, ...(departureTime ? {departureTime} : {})});
  }

  function findFlight(event: FormEvent) {
    event.preventDefault();
    void perform(() => {
      if (method === 'manual') return confirmDetails(manual);
      const {departureDate, ...credentials} = booking;
      return verify({method: 'pnr', ...credentials, ...(departureDate ? {departureDate} : {})});
    });
  }

  function join(event: FormEvent) {
    event.preventDefault();
    if (!verification) return;
    void perform(async () => {
      try {
        const weights = baggage.allowance !== '' && baggage.expected !== '' ? baggagePayload(baggage) : {};
        const {id} = await api<{id: string}>('flights/join', {method: 'POST', body: {token: verification.token, ...preferences, ...weights, ...ridePayload(ride)}});
        router.replace(`/flights/${id}`);
      } catch (issue) {
        if (issue instanceof ApiError && (issue.status === 401 || issue.code === 'VERIFICATION_EXPIRED')) {
          setStep('flight');
          setVerification(undefined);
          if (issue.status === 401) throw new ApiError(409, 'GUEST_EXPIRED', 'Your guest session expired. Confirm your flight details again to continue.');
        }
        throw issue;
      }
    });
  }

  return <div className="fa-app fa-onboarding">
    <header className="fa-app-header"><div className="fa-wrap fa-header-inner"><AppBrand /><Link className="fa-link" href={account ? '/dashboard' : '/'}><ArrowLeft size={16} aria-hidden="true" />{account ? 'Dashboard' : 'Back to home'}</Link></div></header>
    <main className="fa-wrap fa-onboard-grid">
      <aside className="fa-journey" aria-label="Onboarding progress">
        <div className="fa-journey-copy"><Eyebrow>YOUR NEXT JOURNEY</Eyebrow><h2>Good company.<br />Better travel.</h2><p>Find your flight and connect with people heading the same way.</p></div>
        <ol className="fa-step-list">{stages.map((label, index) => <li key={label} aria-current={stage === index ? 'step' : undefined}><span>{stage > index ? <Check size={14} aria-label="Completed" /> : String(index + 1).padStart(2, '0')}</span>{label}{stage === index && <ChevronRight size={16} aria-hidden="true" />}</li>)}</ol>
        <div className="fa-journey-bottom"><ShieldCheck size={17} aria-hidden="true" /> No email needed. Ride sharing is opt-in.</div>
      </aside>
      <section className="fa-onboard-panel">
        {step === 'loading' ? <Loading label="Checking your session…" /> : <>
          <Eyebrow>STEP {stage + 1} OF {stages.length}</Eyebrow>
          {step === 'flight' && <>
            <span className="fa-icon-box"><Plane size={24} aria-hidden="true" /></span><h1 ref={heading} tabIndex={-1}>Find your flight.</h1>
            <p className="fa-intro">Search by flight code and departure date, paste ticket text, or enter the details yourself. No email needed.</p>
            <div className="fa-segments" role="group" aria-label="Flight entry method">
              {entryMethods.filter(({id}) => id !== 'pnr' || allowDemo).map(({id, label}) => <button key={id} type="button" aria-pressed={method === id} disabled={busy} onClick={() => chooseMethod(id)}>{label}</button>)}
            </div>
            {method === 'search' && <>
              <FlightSearch code={search.code} date={search.date} results={searchResults} busy={busy}
                onCode={(next) => { setSearch({...search, code: next}); setSearchResults(undefined); setError(undefined); }}
                onDate={(next) => { setSearch({...search, date: next}); setSearchResults(undefined); setError(undefined); }}
                onSearch={lookup} onManual={() => chooseMethod('manual')}
                onSelect={(flight, source) => {
                  if (source === 'DEMO') {
                    void perform(() => verify({method: 'pnr', pnr: 'DEMO12', surname: 'Traveller', departureDate: flight.departureDate}));
                    return;
                  }
                  setManual(manualDraft(flight));
                  void perform(() => confirmDetails(flight));
                }} />
              {error != null && <div className="fa-entry-results"><ErrorMessage error={error} /></div>}
            </>}
            {method === 'paste' && <TicketImport onImport={(flight, name) => { setManual(manualDraft(flight)); setImportedName(firstName(name)); setImportedFlight(true); setMethod('manual'); }} />}
            {(method === 'manual' || method === 'pnr') && <form className="fa-form" onSubmit={findFlight}>
              {method === 'manual' ? <>
                {importedFlight && <Notice icon={Check}>Ticket text cleared. Review the imported flight and correct anything that doesn’t match your itinerary.</Notice>}
                <div className="fa-fields-two">
                  <Field label="Airline code" hint="2–3 characters"><input className="fa-uppercase" required maxLength={3} pattern="[A-Za-z0-9]{2,3}" placeholder="e.g. BA" value={manual.airline} onChange={(event) => setManual({...manual, airline: event.target.value.toUpperCase()})} /></Field>
                  <Field label="Flight number" hint="As printed on your itinerary"><input className="fa-uppercase" required maxLength={12} placeholder="e.g. 117" value={manual.flightNumber} onChange={(event) => setManual({...manual, flightNumber: event.target.value.toUpperCase()})} /></Field>
                </div><div className="fa-fields-two">
                  <Field label="Departure airport"><input className="fa-uppercase" required maxLength={3} pattern="[A-Za-z]{3}" placeholder="e.g. LHR" value={manual.departureAirport} onChange={(event) => setManual({...manual, departureAirport: event.target.value.toUpperCase()})} /></Field>
                  <Field label="Arrival airport"><input className="fa-uppercase" required maxLength={3} pattern="[A-Za-z]{3}" placeholder="e.g. JFK" value={manual.arrivalAirport} onChange={(event) => setManual({...manual, arrivalAirport: event.target.value.toUpperCase()})} /></Field>
                </div><div className="fa-fields-two">
                  <Field label="Departure date"><input type="date" required value={manual.departureDate} onChange={(event) => setManual({...manual, departureDate: event.target.value})} /></Field>
                  <Field label="Departure time" hint="Optional · local time"><input type="time" value={manual.departureTime} onChange={(event) => setManual({...manual, departureTime: event.target.value})} /></Field>
                </div><Notice icon={ShieldCheck}>Manual entries are marked <strong>self-reported</strong>. They do not verify your booking with the airline.</Notice>
              </> : <>
                <Notice>Demo only. Use <strong>DEMO12</strong> and <strong>Traveller</strong>. Do not enter real booking details.</Notice>
                <div className="fa-fields-two">
                  <Field label="Demo booking reference"><input autoComplete="off" required maxLength={8} pattern="[A-Za-z0-9]{5,8}" placeholder="DEMO12" value={booking.pnr} onChange={(event) => setBooking({...booking, pnr: event.target.value.toUpperCase()})} /></Field>
                  <Field label="Demo surname"><input autoComplete="off" required maxLength={100} placeholder="Traveller" value={booking.surname} onChange={(event) => setBooking({...booking, surname: event.target.value})} /></Field>
                </div>
                <Field label="Demo departure date (optional)"><input type="date" value={booking.departureDate} onChange={(event) => setBooking({...booking, departureDate: event.target.value})} /></Field>
              </>}
              <ErrorMessage error={error} />
              <button className="fa-button fa-primary" type="submit" disabled={busy}>{busy ? 'Checking details…' : 'Find my flight'} <ArrowRight size={17} aria-hidden="true" /></button>
            </form>}
            <p className="fa-footnote">Your guest session lasts up to seven days in this browser. By continuing you agree to our <Link href="/legal/terms">Terms</Link> and <Link href="/legal/privacy">Privacy Policy</Link>.</p>
          </>}
          {step === 'profile' && verification && <>
            <span className="fa-icon-box"><Users size={24} aria-hidden="true" /></span><h1 ref={heading} tabIndex={-1}>Make the room yours.</h1>
            <p className="fa-intro">Check your route and choose what you’d like to share. You can update these choices later.</p>
            <FlightTicket flight={verification.flight} status={verification.verificationStatus} />
            <form className="fa-form" onSubmit={join}>
              <fieldset className="fa-fieldset"><legend>Your profile</legend><PreferenceFields compact value={preferences} onChange={setPreferences} suggestedName={importedName ?? firstName(verification.suggestedDisplayName)} /></fieldset>
              <fieldset className="fa-fieldset"><legend>Your party and airport ride</legend><RideFields value={ride} onChange={setRide} />{ride.rideOptIn && !verification.flight.departureTime && <p className="fa-entry-caption">Add the local departure time in the room to see ride matches.</p>}</fieldset>
              <fieldset className="fa-fieldset fa-stack"><legend>Your checked baggage (optional)</legend><p className="fa-entry-caption">Add only your own checked baggage, not your party’s combined allowances. Confirm rules with your airline. Never carry unknown items for someone else.</p><BaggageFields optional value={baggage} onChange={setBaggage} /></fieldset>
              <ErrorMessage error={error} />
              <div className="fa-actions"><button className="fa-button fa-secondary" type="button" disabled={busy} onClick={() => changeStep('flight')}><ArrowLeft size={16} aria-hidden="true" /> Edit flight</button><button className="fa-button fa-primary" type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join flight room'} <ArrowRight size={17} aria-hidden="true" /></button></div>
            </form>
          </>}
        </>}
      </section>
    </main>
  </div>;
}