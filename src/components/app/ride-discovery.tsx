'use client';

import Link from 'next/link';
import {CalendarDays, Car, Clock3, MapPin, MessageCircle, Plus, ShieldCheck, Users} from 'lucide-react';
import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {api, formatDate, type CabListing, type CabRequest, type CabRequestAction, type CabRequestDirection, type CabRequestStatus, type CabSearch, type CabSearchItem, type Page, type Room} from './api';
import {Field} from './fields';
import {FlyerBadge} from './flyer';
import {useRealtime} from './realtime';
import {Dialog} from './safety';
import {Empty, ErrorMessage, Eyebrow, Loading, Notice, Pager} from './ui';
import {useResource} from './use-resource';

const statusLabels: Record<CabRequestStatus, string> = {PENDING: 'Pending', ACCEPTED: 'Accepted', DECLINED: 'Declined', WITHDRAWN: 'Withdrawn', CLOSED: 'Listing closed'};
const seatLabel = (seats: number) => `${seats} ${seats === 1 ? 'seat' : 'seats'}`;

function ListingEditor({path, listing, onClose, onSaved}: {path: string; listing?: CabListing; onClose: () => void; onSaved: (message: string) => void}) {
  const [pickupArea, setPickupArea] = useState(listing?.pickupArea ?? '');
  const [freeSeats, setFreeSeats] = useState(String(listing?.freeSeats ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(listing ? `${path}/rides/${listing.id}` : `${path}/rides`, {method: listing ? 'PATCH' : 'POST', body: {pickupArea, freeSeats: Number(freeSeats)}});
      onSaved(listing ? 'Cab listing updated.' : 'Cab listing published.');
    } catch (issue) { setError(issue); setBusy(false); }
  }

  return <Dialog title={listing ? 'Edit cab listing' : 'Post a cab listing'} onClose={() => { if (!busy) onClose(); }}>
    <p className="fa-intro">Travellers flying from the same airport can see this listing when their departure is near yours.</p>
    <form className="fa-form" onSubmit={(event) => void save(event)}>
      <Field label="Pickup area" hint="Use a neighbourhood and city. No house number, exact address, or phone number."><input required minLength={2} maxLength={60} value={pickupArea} onChange={(event) => setPickupArea(event.target.value)} placeholder="e.g. Andheri East, Mumbai" /></Field>
      <Field label="Free seats to offer" hint={listing?.acceptedSeats ? `${seatLabel(listing.acceptedSeats)} already accepted. Include those seats in your total.` : 'Only count seats available to other travellers.'}><input required type="number" step={1} min={Math.max(1, listing?.acceptedSeats ?? 0)} max={12} value={freeSeats} onChange={(event) => setFreeSeats(event.target.value)} /></Field>
      <ErrorMessage error={error} />
      <div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="fa-button fa-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : listing ? 'Save changes' : 'Publish listing'}</button></div>
    </form>
  </Dialog>;
}

function ConfirmClose({path, listing, onClose, onSaved}: {path: string; listing: CabListing; onClose: () => void; onSaved: (message: string) => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function close(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`${path}/rides/${listing.id}`, {method: 'DELETE'});
      onSaved('Cab listing closed.');
    } catch (issue) { setError(issue); setBusy(false); }
  }
  return <Dialog title="Close cab listing?" onClose={() => { if (!busy) onClose(); }}>
    <p className="fa-intro">Your listing will disappear from search and pending requests will close. Accepted riders can still chat with you.</p>
    <form className="fa-form" onSubmit={(event) => void close(event)}><ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={onClose}>Keep listing</button><button className="fa-button fa-danger" type="submit" disabled={busy}>{busy ? 'Closing…' : 'Close listing'}</button></div></form>
  </Dialog>;
}

function RequestEditor({path, listing, partySize, window, onClose, onSaved}: {path: string; listing: CabSearchItem; partySize: number; window: number; onClose: () => void; onSaved: (message: string) => void}) {
  const [seats, setSeats] = useState(String(Math.min(partySize, listing.availableSeats)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`${path}/rides/${listing.id}/requests`, {method: 'POST', body: {seats: Number(seats), window}});
      onSaved('Request sent. Check Sent requests for updates.');
    } catch (issue) { setError(issue); setBusy(false); }
  }
  return <Dialog title="Request cab seats" onClose={() => { if (!busy) onClose(); }}>
    <p className="fa-intro">{listing.displayName} is offering {seatLabel(listing.availableSeats)} from {listing.pickupArea}. Seats aren’t reserved until the host accepts.</p>
    <form className="fa-form" onSubmit={(event) => void send(event)}>
      <Field label="How many seats?" hint={`Your flight party: ${partySize}. You can choose a different number.`}><input required type="number" min={1} max={listing.availableSeats} step={1} value={seats} onChange={(event) => setSeats(event.target.value)} /></Field>
      <ErrorMessage error={error} />
      <div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="fa-button fa-primary" disabled={busy}>{busy ? 'Sending…' : 'Send seat request'}</button></div>
    </form>
  </Dialog>;
}

function SearchCard({listing, request}: {listing: CabSearchItem; request: () => void}) {
  return <article className="fa-passenger fa-ride-card">
    <div className="fa-passenger-person"><span className="fa-avatar"><Car size={21} aria-hidden="true" /></span><div><h3>{listing.pickupArea}</h3><p>Hosted by {listing.displayName}</p></div></div>
    <div className="fa-passenger-details">
      <div><CalendarDays size={17} aria-hidden="true" /><span>{listing.flightLabel} · {formatDate(listing.departureDate)} · {listing.departureTime} local</span></div>
      <div><Clock3 size={17} aria-hidden="true" /><span>{listing.minutesApart === 0 ? 'Same scheduled departure time' : `${listing.minutesApart} min between departures`}</span></div>
      <div><Users size={17} aria-hidden="true" /><span>{listing.availableSeats > 0 ? `${seatLabel(listing.availableSeats)} available` : 'No seats available'}</span></div>
    </div>
    {listing.flyer && <div className="fa-ride-flyer"><FlyerBadge flyer={listing.flyer} /><small>{listing.flyer.flightsAdded} {listing.flyer.flightsAdded === 1 ? 'flight' : 'flights'} added · {listing.flyer.ridesConfirmed} {listing.flyer.ridesConfirmed === 1 ? 'ride' : 'rides'} confirmed</small></div>}
    <div className="fa-actions"><button type="button" className="fa-button fa-secondary fa-compact" onClick={request}>Request seats</button></div>
  </article>;
}

function RequestCard({item, direction, path, onSaved}: {item: CabRequest; direction: CabRequestDirection; path: string; onSaved: (message: string) => void}) {
  const [busy, setBusy] = useState<CabRequestAction>();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<unknown>();
  async function decide(action: CabRequestAction) {
    if (busy) return;
    setBusy(action);
    setError(undefined);
    try {
      await api(`${path}/ride-requests/${item.id}`, {method: 'PATCH', body: {action}});
      onSaved(action === 'accept' ? 'Seat request accepted. Your chat is ready.' : action === 'decline' ? 'Seat request declined.' : 'Seat request withdrawn.');
      setConfirmWithdraw(false);
    } catch (issue) { setError(issue); }
    finally { setBusy(undefined); }
  }
  return <article className="fa-passenger fa-ride-card">
    <div className="fa-passenger-person"><span className="fa-avatar"><Users size={20} aria-hidden="true" /></span><div><h3>{item.displayName}</h3><p>{item.flightLabel} · {item.pickupArea}</p></div></div>
    <div className="fa-actions"><span className="fa-badge">{seatLabel(item.seats)}</span><span className={`fa-badge${item.status === 'ACCEPTED' ? ' fa-badge-accent' : ''}`}>{statusLabels[item.status]}</span>{item.listingClosed && item.status !== 'CLOSED' && <span className="fa-badge">Listing closed</span>}</div>
    <div className="fa-actions">
      {item.status === 'PENDING' && direction === 'received' && <><button type="button" className="fa-button fa-primary fa-compact" disabled={!!busy} onClick={() => void decide('accept')}>{busy === 'accept' ? 'Accepting…' : 'Accept'}</button><button type="button" className="fa-button fa-secondary fa-compact" disabled={!!busy} onClick={() => void decide('decline')}>{busy === 'decline' ? 'Declining…' : 'Decline'}</button></>}
      {(item.status === 'PENDING' || item.status === 'ACCEPTED') && direction === 'sent' && <button type="button" className="fa-button fa-secondary fa-compact" disabled={!!busy} onClick={() => { setError(undefined); setConfirmWithdraw(true); }}>Withdraw request</button>}
      {item.conversationId && <Link className="fa-button fa-secondary fa-compact" href={`/dashboard/messages/${item.conversationId}`}><MessageCircle size={16} aria-hidden="true" /> Open chat</Link>}
    </div>
    {!confirmWithdraw && <ErrorMessage error={error} />}
    {confirmWithdraw && <Dialog title="Withdraw seat request?" onClose={() => { if (!busy) setConfirmWithdraw(false); }}><p className="fa-intro">{item.status === 'ACCEPTED' ? 'Your seats will be released. You can still message the host.' : 'The host will no longer be able to accept this request.'}</p><ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={!!busy} onClick={() => setConfirmWithdraw(false)}>Keep request</button><button type="button" className="fa-button fa-danger" disabled={!!busy} onClick={() => void decide('withdraw')}>{busy ? 'Withdrawing…' : 'Withdraw request'}</button></div></Dialog>}
  </article>;
}

type View = 'browse' | CabRequestDirection;
type Modal = {type: 'publish'} | {type: 'edit' | 'close'; listing: CabListing} | {type: 'request'; listing: CabSearchItem};

export function RideDiscovery({room}: {room: Room; reload: () => void}) {
  const path = `flights/${room.id}`;
  const [view, setView] = useState<View>('browse');
  const [window, setWindow] = useState(20);
  const [windowInput, setWindowInput] = useState('20');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Modal>();
  const [message, setMessage] = useState('');
  const search = useResource<CabSearch>(`${path}/rides?window=${window}&page=${view === 'browse' ? page : 1}`);
  const requests = useResource<Page<CabRequest>>(view === 'browse' ? null : `${path}/ride-requests?direction=${view}&page=${page}`);
  const reloadSearch = search.reload;
  const reloadRequests = requests.reload;
  const reload = useCallback(() => { reloadSearch(); reloadRequests(); }, [reloadSearch, reloadRequests]);
  useRealtime({connect: reload, 'flight:updated': (event) => { if (event.flightId === room.id) reload(); }, 'conversations:updated': reload});
  useEffect(() => {
    // Cross-flight listings without requests are not subscribed to this room's events.
    const refresh = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 45_000);
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, [reload]);

  function saved(text: string) { setModal(undefined); setMessage(text); reload(); }
  function applyWindow(value: number) { setWindowInput(String(value)); setWindow(value); setPage(1); }
  const listing = search.data?.ownListing;
  return <section className="fa-section" aria-labelledby="ride-discovery">
    <div className="fa-section-head"><div><Eyebrow>TO THE AIRPORT</Eyebrow><h2 id="ride-discovery">Share a cab</h2><p className="fa-muted">Find an available seat to {room.departureAirport} or offer seats in your own cab. The filter uses scheduled flight departures, not cab pickup times.</p></div>
      {search.data?.eligibility === 'READY' && !listing && <button type="button" className="fa-button fa-primary fa-compact" onClick={() => setModal({type: 'publish'})}><Plus size={16} aria-hidden="true" /> Post cab listing</button>}
    </div>
    {message && <p className="fa-badge fa-badge-accent" role="status">{message}</p>}
    {listing && <article className="fa-passenger fa-ride-card">
      <div className="fa-passenger-person"><span className="fa-avatar"><MapPin size={20} aria-hidden="true" /></span><div><h3>Your listing: {listing.pickupArea}</h3><p>{seatLabel(listing.availableSeats)} available · {seatLabel(listing.acceptedSeats)} accepted</p></div></div>
      <div className="fa-actions"><button type="button" className="fa-button fa-secondary fa-compact" onClick={() => setModal({type: 'edit', listing})}>Edit listing</button><button type="button" className="fa-button fa-secondary fa-compact" onClick={() => setModal({type: 'close', listing})}>Close listing</button></div>
    </article>}
    <div className="fa-actions" aria-label="Cab listings and requests">{([['browse', 'Browse listings'], ['received', 'Received requests'], ['sent', 'Sent requests']] as const).map(([key, text]) => <button key={key} className={`fa-button fa-compact ${view === key ? 'fa-primary' : 'fa-secondary'}`} type="button" aria-pressed={view === key} onClick={() => { setPage(1); setView(key); }}>{text}</button>)}</div>
    {view === 'browse' ? <>
      <form className="fa-form" onSubmit={(event) => { event.preventDefault(); applyWindow(Number(windowInput)); }}>
        <Field label="Departure window (minutes)" hint="Before or after your flight, from 0 to 60 minutes."><input type="number" min={0} max={60} step={1} required value={windowInput} onChange={(event) => setWindowInput(event.target.value)} /></Field>
        <div className="fa-actions">
          <button type="button" className="fa-icon-button" aria-label="Decrease departure window by 5 minutes" disabled={window === 0} onClick={() => applyWindow(Math.max(0, window - 5))}>−</button>
          <button type="button" className="fa-icon-button" aria-label="Increase departure window by 5 minutes" disabled={window === 60} onClick={() => applyWindow(Math.min(60, window + 5))}>+</button>
          <button type="submit" className="fa-button fa-secondary fa-compact">Apply window</button>
        </div>
      </form>
      <ErrorMessage error={search.error} retry={reload} />
      {!search.data && !search.error && <Loading label="Looking for cab listings…" />}
      {search.data?.eligibility === 'MISSING_TIME' && <Empty icon={Clock3} title="Scheduled departure time needed"><p>This flight has no scheduled time. Check your itinerary and add the flight with its departure time to browse or publish listings.</p></Empty>}
      {search.data?.eligibility === 'EXPIRED' && <Empty icon={CalendarDays} title="Cab discovery has closed for this flight"><p>You can still see your requests and check your messages.</p></Empty>}
      {search.data?.eligibility === 'READY' && <>
        <p className="fa-muted" aria-live="polite">{window === 0 ? 'Showing flights at the same scheduled departure time.' : `Showing flights within ±${window} min of your scheduled departure.`}</p>
        {search.data.items.length ? <div className="fa-passenger-grid">{search.data.items.map((item) => <SearchCard key={item.id} listing={item} request={() => setModal({type: 'request', listing: item})} />)}</div> : <Empty icon={Car} title="No cab listings in this window"><p>Try a wider departure window or check back later.</p><button type="button" className="fa-button fa-secondary fa-compact" onClick={reload}>Refresh listings</button></Empty>}
        <Pager page={page} hasMore={search.data.hasMore} onChange={setPage} />
      </>}
    </> : <>
      <ErrorMessage error={requests.error} retry={reload} />
      {!requests.data && !requests.error && <Loading label="Loading seat requests…" />}
      {requests.data && <>
        {requests.data.items.length ? <div className="fa-passenger-grid">{requests.data.items.map((item) => <RequestCard key={item.id} item={item} direction={view} path={path} onSaved={saved} />)}</div> : <Empty icon={Users} title={`No ${view} seat requests yet`}><p>{view === 'received' ? 'Requests to join your cab will appear here.' : 'Request seats on a cab listing to see your status here.'}</p></Empty>}
        <Pager page={page} hasMore={requests.data.hasMore} onChange={setPage} />
      </>}
    </>}
    <Notice icon={ShieldCheck}>Flight Share doesn’t book rides or collect payments. Confirm pickup time, terminal, and costs in chat after acceptance. Keep your exact address and contact details off the listing.</Notice>
    {(modal?.type === 'publish' || modal?.type === 'edit') && <ListingEditor path={path} listing={modal.type === 'edit' ? modal.listing : undefined} onClose={() => setModal(undefined)} onSaved={saved} />}
    {modal?.type === 'close' && <ConfirmClose path={path} listing={modal.listing} onClose={() => setModal(undefined)} onSaved={saved} />}
    {modal?.type === 'request' && <RequestEditor path={path} listing={modal.listing} partySize={room.membership.partySize} window={window} onClose={() => setModal(undefined)} onSaved={saved} />}
  </section>;
}