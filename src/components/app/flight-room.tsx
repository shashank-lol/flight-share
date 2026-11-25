'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowRight, Bell, Car, Info, Luggage, LogOut, MessageCircle, MessagesSquare, Search, ShieldCheck, UserRound, Users} from 'lucide-react';
import {useRef, useState, type FormEvent} from 'react';
import {api, flightLabel, formatDate, transportationLabels, type Page, type Passenger, type Policy, type Room} from './api';
import {AppShell, useNotificationUnread} from './app-shell';
import {BaggageMatches} from './baggage-matches';
import {Field} from './fields';
import {FlightChat} from './flight-chat';
import {useRealtime} from './realtime';
import {Dialog, SafetyActions} from './safety';
import {startConversation} from './messages';
import {MoreActions} from './more-actions';
import {RideDiscovery} from './ride-discovery';
import {Empty, ErrorMessage, Loading, Notice, Pager, StatusBadge} from './ui';
import {useResource} from './use-resource';
import './flight-room.css';

const sections = [
  {id: 'chat', label: 'Chat', icon: MessagesSquare},
  {id: 'passengers', label: 'People', icon: Users},
  {id: 'rides', label: 'Cabs', icon: Car},
  {id: 'matches', label: 'Baggage', icon: Luggage},
] as const;
const filters = [{id: 'all', label: 'Everyone'}, {id: 'companions', label: 'Companionship'}];

function PassengerCard({flightId, passenger, reload}: {flightId: string; passenger: Passenger; reload: () => void}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [showSafety, setShowSafety] = useState(false);
  const {transportation, companionship, partySize} = passenger;
  const hasPreferences = (transportation && transportation !== 'NONE') || (partySize !== null && partySize > 1) || companionship;
  return <article className="fa-passenger">
    <div className="fa-passenger-person"><span className="fa-avatar"><UserRound size={21} aria-hidden="true" /></span><div><h3>{passenger.displayName}{passenger.isSelf && ' (you)'}</h3>{passenger.isAnonymous && <p>{passenger.alias}</p>}<StatusBadge status={passenger.verificationStatus} /></div></div>
    {hasPreferences && <div className="fa-passenger-details">
      {transportation && transportation !== 'NONE' && <div><Car size={17} aria-hidden="true" /><span>{transportationLabels[transportation]}</span></div>}
      {partySize !== null && partySize > 1 && <div><Users size={17} aria-hidden="true" /><span>Travelling in a party of {partySize}</span></div>}
      {companionship && <div><Users size={17} aria-hidden="true" /><span>Open to travel companionship</span></div>}
    </div>}
    {!passenger.isSelf && <div className="fa-passenger-actions"><button type="button" className="fa-button fa-secondary fa-compact" disabled={busy} onClick={() => { setBusy(true); setError(undefined); void startConversation(flightId, passenger.id).then((conversation) => router.push(`/dashboard/messages/${conversation.id}`), (issue: unknown) => { setError(issue); setBusy(false); }); }}><MessageCircle size={16} aria-hidden="true" /> {busy ? 'Opening…' : 'Message'}</button><button type="button" className="fa-text-button" aria-expanded={showSafety} onClick={() => setShowSafety(!showSafety)}><ShieldCheck size={17} aria-hidden="true" /> Safety options</button></div>}
    {showSafety && <SafetyActions flightId={flightId} target={passenger} onBlocked={reload} />}
    <ErrorMessage error={error} />
  </article>;
}

function Directory({flightId}: {flightId: string}) {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const result = useResource<Page<Passenger>>(`flights/${flightId}/passengers?${new URLSearchParams({filter, sort, q: query, page: String(page)})}`);
  useRealtime({connect: result.reload, 'flight:updated': (event) => { if (event.flightId === flightId) result.reload(); }, 'conversations:updated': result.reload});
  return <section className="fa-section">
    <div className="fa-section-head"><h2>Passengers</h2></div>
    <div className="fa-filterbar"><form role="search" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(draft.trim()); }}><Field label="Search passengers"><input type="search" maxLength={48} placeholder="Name or alias" value={draft} onChange={(event) => { setDraft(event.target.value); if (!event.target.value) { setQuery(''); setPage(1); } }} /></Field><button className="fa-icon-button" type="submit" aria-label="Search passengers"><Search size={19} aria-hidden="true" /></button></form><Field label="Sort by"><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="recent">Recently joined</option><option value="name">Name</option></select></Field></div>
    <div className="fa-chips" aria-label="Filter passengers">{filters.map(({id, label}) => <button key={id} type="button" aria-pressed={id === filter} onClick={() => { setFilter(id); setPage(1); }}>{label}</button>)}</div>
    <ErrorMessage error={result.error} retry={result.reload} />
    {!result.data && !result.error && <Loading label="Loading passengers…" />}
    {result.data?.items.length === 0 && <Empty icon={Users} title="No passengers found"><p>Try a different search or filter, or check back later.</p></Empty>}
    {!!result.data?.items.length && <div className="fa-passenger-grid">{result.data.items.map((passenger) => <PassengerCard key={passenger.id} flightId={flightId} passenger={passenger} reload={result.reload} />)}</div>}
    {result.data && <Pager page={page} hasMore={result.data.hasMore} onChange={setPage} />}
  </section>;
}

function AirlinePolicy({flightId}: {flightId: string}) {
  const result = useResource<Policy>(`flights/${flightId}/policy`);
  return <section className="fa-section"><h2>Airline policy</h2>
    <ErrorMessage error={result.error} retry={result.reload} />
    {!result.data && !result.error && <Loading label="Loading airline policy…" />}
    {result.data && <article className="fa-panel fa-stack"><div className="fa-passenger-person"><span className="fa-icon-box"><ShieldCheck size={25} aria-hidden="true" /></span><div><span className="fa-badge">{result.data.status === 'UNKNOWN' ? 'Policy not confirmed' : result.data.status}</span><h3>Baggage rules</h3></div></div><p>{result.data.summary}</p>{!!result.data.restrictions.length && <ul className="fa-rule-list">{result.data.restrictions.map((restriction, index) => <li key={index}>{restriction}</li>)}</ul>}</article>}
    <Notice icon={ShieldCheck}>Flight Share does not change your baggage allowance. Confirm weight limits, pooling rules, and fees with your airline before making arrangements. Never accept unknown items.</Notice>
  </section>;
}

function LeaveRoom({flightId, onClose}: {flightId: string; onClose: () => void}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(undefined);
    void api(`flights/${flightId}/leave`, {method: 'DELETE'}).then(() => router.replace('/dashboard'), (issue: unknown) => { setError(issue); setBusy(false); });
  }
  return <Dialog title="Leave this flight?" onClose={() => { if (!busy) onClose(); }}><form className="fa-form" onSubmit={submit}>
    <p className="fa-intro">You’ll lose access to this flight’s group chat, passenger list, baggage matches and cab listings. Private chats will stay available only if you still share another eligible travel connection.</p>
    <ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="fa-button fa-danger" disabled={busy}>{busy ? 'Leaving…' : 'Leave flight'}</button></div>
  </form></Dialog>;
}

function RoomNavigation({flightId, active}: {flightId: string; active: typeof sections[number]['id'] | 'policy'}) {
  const [dialog, setDialog] = useState<'about' | 'leave'>();
  const nav = useRef<HTMLElement>(null);
  const unread = useNotificationUnread();
  const close = () => {
    setDialog(undefined);
    requestAnimationFrame(() => nav.current?.querySelector<HTMLButtonElement>('.fa-more-trigger')?.focus());
  };
  const roomHref = `/flights/${flightId}`;
  return <>
    <nav ref={nav} className="fa-room-nav" aria-label="Flight sections">
      {sections.map(({id, label, icon: Icon}) => <Link aria-current={id === active ? 'page' : undefined} key={id} href={id === 'chat' ? roomHref : `${roomHref}?tab=${id}`}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>)}
      <MoreActions label={unread > 0 ? `More, ${unread} unread notifications` : 'More'} unread={unread} className={`fa-room-more${active === 'policy' ? ' fa-room-more-current' : ''}`}>
        <Link className="fa-more-item" href={`${roomHref}?tab=policy`} aria-current={active === 'policy' ? 'page' : undefined}><ShieldCheck size={18} aria-hidden="true" /> Airline policy</Link>
        <Link className="fa-more-item" href="/dashboard/notifications"><Bell size={18} aria-hidden="true" /> Notifications{unread > 0 && <span className="fa-count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</Link>
        <Link className="fa-more-item" href="/dashboard/messages"><MessageCircle size={18} aria-hidden="true" /> Messages</Link>
        <button type="button" className="fa-more-item" onClick={() => setDialog('about')}><Info size={18} aria-hidden="true" /> About this group chat</button>
        <button type="button" className="fa-more-item" onClick={() => setDialog('leave')}><LogOut size={18} aria-hidden="true" /> Leave flight</button>
      </MoreActions>
    </nav>
    {dialog === 'about' && <Dialog title="About this group chat" onClose={close}><p className="fa-intro">Travellers in this flight room can see and join the group chat. Don’t share booking or payment details.</p></Dialog>}
    {dialog === 'leave' && <LeaveRoom flightId={flightId} onClose={close} />}
  </>;
}

export function FlightRoom({flightId, tab}: {flightId: string; tab?: string}) {
  const active = tab === 'policy' ? 'policy' : (sections.find((section) => section.id === tab)?.id ?? 'chat');
  const room = useResource<Room>(`flights/${flightId}`);
  useRealtime({connect: room.reload, 'flight:updated': (event) => { if (event.flightId === flightId) room.reload(); }});
  const details = room.data;
  return <AppShell area="flight">
    <ErrorMessage error={room.error} retry={room.reload} />
    {!details && !room.error && <Loading label="Loading your flight room…" />}
    {details && <>
      <header className="fa-room-heading"><div>
        <h1><span>{flightLabel(details)}</span>{' '}<span className="fa-room-route">{details.departureAirport}<ArrowRight size={14} aria-hidden="true" /><span className="fa-sr-only"> to </span>{details.arrivalAirport}</span></h1>
        <p>{formatDate(details.departureDate)}{details.departureTime ? ` · ${details.departureTime} local` : ''}</p>
      </div><StatusBadge status={details.membership.verificationStatus} /></header>
      {active === 'passengers' && <Directory flightId={flightId} />}
      {active === 'rides' && <RideDiscovery key={flightId} room={details} reload={room.reload} />}
      {active === 'chat' && <FlightChat flightId={flightId} members={details.memberCount} />}
      {active === 'matches' && <BaggageMatches key={flightId} flightId={flightId} />}
      {active === 'policy' && <AirlinePolicy flightId={flightId} />}
      <RoomNavigation key={flightId} flightId={flightId} active={active} />
    </>}
  </AppShell>;
}