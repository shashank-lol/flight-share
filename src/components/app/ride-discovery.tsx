'use client';

import {useRouter} from 'next/navigation';
import {CalendarDays, Car, Clock3, MapPin, MessageCircle, ShieldCheck, SlidersHorizontal, Users} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {api, formatDate, type RideMatch, type RideResults, type Room} from './api';
import {Field, RideFields, ridePayload, type RideDraft} from './fields';
import {FlyerBadge} from './flyer';
import {useRealtime} from './realtime';
import {Dialog} from './safety';
import {Empty, ErrorMessage, Eyebrow, Loading, Notice, Pager} from './ui';
import {useResource} from './use-resource';

function RideCard({flightId, match}: {flightId: string; match: RideMatch}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function startChat() {
    if (busy) return;
    setError(undefined);
    setBusy(true);
    try {
      const {id} = await api<{id: string}>(`flights/${flightId}/ride-conversations`, {method: 'POST', body: {passengerId: match.id}});
      router.push(`/dashboard/messages/${id}`);
    } catch (issue) { setError(issue); setBusy(false); }
  }

  return <article className="fa-passenger fa-ride-card">
    <div className="fa-passenger-person"><span className="fa-avatar"><Car size={21} aria-hidden="true" /></span><div><h3>{match.displayName}</h3><p>{match.flightLabel} · {match.minutesApart === 0 ? 'Same departure time' : `${match.minutesApart} min apart`}</p></div></div>
    <div className="fa-passenger-details">
      <div><CalendarDays size={17} aria-hidden="true" /><span>{formatDate(match.departureDate)} · {match.departureTime} local</span></div>
      <div><Users size={17} aria-hidden="true" /><span>{match.partySize === 1 ? '1 traveller' : `${match.partySize} travellers`}</span></div>
      <div><MapPin size={17} aria-hidden="true" /><span>{match.pickupArea ?? 'No pickup area shared'}</span></div>
    </div>
    {match.flyer && <div className="fa-ride-flyer"><FlyerBadge flyer={match.flyer} /><small>{match.flyer.flightsAdded} {match.flyer.flightsAdded === 1 ? 'flight' : 'flights'} added · {match.flyer.ridesConfirmed} {match.flyer.ridesConfirmed === 1 ? 'ride' : 'rides'} confirmed</small></div>}
    <button type="button" className="fa-button fa-secondary fa-compact" disabled={busy} onClick={() => void startChat()}><MessageCircle size={17} aria-hidden="true" /> {busy ? 'Opening…' : 'Open private ride chat'}</button>
    <ErrorMessage error={error} />
  </article>;
}

function RideEditor({room, requireTime, onClose, onSaved}: {room: Room; requireTime: boolean; onClose: () => void; onSaved: () => void}) {
  const [value, setValue] = useState<RideDraft>(() => ({partySize: room.membership.partySize, rideOptIn: room.membership.rideOptIn, pickupArea: room.membership.pickupArea ?? ''}));
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`flights/${room.id}/ride-settings`, {method: 'PATCH', body: {...ridePayload(value), ...(!room.departureTime && value.rideOptIn && time ? {departureTime: time} : {})}});
      onSaved();
    } catch (issue) { setError(issue); setBusy(false); }
  }

  return <Dialog title="Airport ride settings" onClose={() => { if (!busy) onClose(); }}>
    <p className="fa-intro">These choices only apply to this flight.</p>
    <form className="fa-form" onSubmit={(event) => void save(event)}>
      <RideFields value={value} onChange={setValue} />
      {value.rideOptIn && !room.departureTime && <Field label="Local departure time" hint="Check the scheduled takeoff time on your itinerary. This also fills the missing time in your flight room."><input type="time" required={requireTime} value={time} onChange={(event) => setTime(event.target.value)} /></Field>}
      <ErrorMessage error={error} />
      <div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="fa-button fa-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save ride settings'}</button></div>
    </form>
  </Dialog>;
}

function RideList({flightId, edit}: {flightId: string; edit: (requireTime?: boolean) => void}) {
  const [page, setPage] = useState(1);
  const result = useResource<RideResults>(`flights/${flightId}/rides?page=${page}`);
  const reload = result.reload;
  const state = result.data?.eligibility;
  useRealtime({connect: reload, 'flight:updated': (event) => { if (event.flightId === flightId) reload(); }, 'conversations:updated': reload});
  useEffect(() => {
    // Several matches may belong to rooms outside this flight's live updates.
    const refresh = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 45_000);
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, [reload]);

  return <>
    <ErrorMessage error={result.error} retry={reload} />
    {!result.data && !result.error && <Loading label="Looking for ride matches…" />}
    {state === 'OPT_IN_REQUIRED' && <Empty icon={Car} title="Opt in to see ride matches"><p>Share your flight and party size with other opted-in travellers whose flights leave around the same time.</p><button type="button" className="fa-button fa-primary" onClick={() => edit()}>Set up ride sharing</button></Empty>}
    {state === 'MISSING_TIME' && <Empty icon={Clock3} title="Add your departure time"><p>We need the local scheduled takeoff time to find travellers leaving within 20 minutes of your flight.</p><button type="button" className="fa-button fa-primary" onClick={() => edit(true)}>Add departure time</button></Empty>}
    {state === 'EXPIRED' && <Empty icon={CalendarDays} title="Ride discovery has closed"><p>Discovery is only available around your departure date. If you already arranged a ride, check your messages.</p></Empty>}
    {state === 'READY' && result.data && <>
      {result.data.items.length ? <div className="fa-passenger-grid">{result.data.items.map((match) => <RideCard key={match.id} flightId={flightId} match={match} />)}</div> : <Empty icon={Car} title="No ride matches yet"><p>Other travellers need to opt in before they appear here. Check back later.</p><button type="button" className="fa-button fa-secondary" onClick={reload}>Check for matches</button></Empty>}
      <Pager page={page} hasMore={result.data.hasMore} onChange={setPage} />
    </>}
  </>;
}

export function RideDiscovery({room, reload}: {room: Room; reload: () => void}) {
  const [editing, setEditing] = useState<{requireTime: boolean}>();
  const [revision, setRevision] = useState(0);

  return <section className="fa-section" aria-labelledby="ride-discovery">
    <div className="fa-section-head"><div><Eyebrow>TO THE AIRPORT</Eyebrow><h2 id="ride-discovery">Airport rides</h2><p className="fa-muted">Find travellers leaving from {room.departureAirport} within 20 minutes of your flight, even if they’re flying somewhere else.</p></div><button type="button" className="fa-button fa-secondary fa-compact" onClick={() => setEditing({requireTime: false})}><SlidersHorizontal size={16} aria-hidden="true" /> Ride settings</button></div>
    <div className="fa-actions" aria-label="Your current ride settings"><span className="fa-badge"><Users size={14} aria-hidden="true" /> Your party: {room.membership.partySize}</span><span className="fa-badge">Ride discovery {room.membership.rideOptIn ? 'on' : 'off'}</span>{room.membership.rideOptIn && room.membership.pickupArea && <span className="fa-badge"><MapPin size={14} aria-hidden="true" /> {room.membership.pickupArea}</span>}</div>
    {revision > 0 && <span className="fa-badge" role="status">Ride settings saved</span>}
    <RideList key={revision} flightId={room.id} edit={(requireTime = false) => setEditing({requireTime})} />
    <Notice icon={ShieldCheck}>Flight Share doesn’t book rides or handle payments. Agree on timing, terminal and costs with your ride partner. Keep addresses and contact details out of public areas.</Notice>
    {editing && <RideEditor room={room} requireTime={editing.requireTime} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRevision((value) => value + 1); reload(); }} />}
  </section>;
}