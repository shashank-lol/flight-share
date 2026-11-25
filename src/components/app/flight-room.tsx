'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowRight, Car, Luggage, LogOut, MessageCircle, MessagesSquare, Search, ShieldCheck, UserRound, Users} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {api, flightLabel, formatDate, transportationLabels, type Page, type Passenger, type Policy, type Room} from './api';
import {AppShell} from './app-shell';
import {BaggageMatches} from './baggage-matches';
import {Field} from './fields';
import {FlightChat} from './flight-chat';
import {useRealtime} from './realtime';
import {Dialog, SafetyActions} from './safety';
import {ConversationList, startConversation} from './messages';
import {RideDiscovery} from './ride-discovery';
import {Empty, ErrorMessage, Loading, Notice, Pager, StatusBadge} from './ui';
import {useResource} from './use-resource';

const sections = [
  {id: 'chat', label: 'Group chat', short: 'Chat', icon: MessagesSquare},
  {id: 'passengers', label: 'Passengers', short: 'People', icon: Users},
  {id: 'rides', label: 'Airport rides', short: 'Cabs', icon: Car},
  {id: 'matches', label: 'Baggage matches', short: 'Baggage', icon: Luggage},
  {id: 'policy', label: 'Airline policy', short: 'Policy', icon: ShieldCheck},
  {id: 'messages', label: 'Messages', short: 'DMs', icon: MessageCircle},
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

function LeaveRoom({flightId}: {flightId: string}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(undefined);
    void api(`flights/${flightId}/leave`, {method: 'DELETE'}).then(() => router.replace('/dashboard'), (issue: unknown) => { setError(issue); setBusy(false); });
  }
  return <>
    <button type="button" className="fa-icon-button" title="Leave flight" aria-label="Leave flight" onClick={() => { setError(undefined); setOpen(true); }}><LogOut size={18} aria-hidden="true" /></button>
    {open && <Dialog title="Leave this flight?" onClose={() => { if (!busy) setOpen(false); }}><form className="fa-form" onSubmit={submit}>
      <p className="fa-intro">You’ll lose access to this flight’s group chat, passenger list, baggage matches and cab listings. Private chats will stay available only if you still share another eligible travel connection.</p>
      <ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button type="submit" className="fa-button fa-danger" disabled={busy}>{busy ? 'Leaving…' : 'Leave flight'}</button></div>
    </form></Dialog>}
  </>;
}

export function FlightRoom({flightId, tab}: {flightId: string; tab?: string}) {
  const active = sections.find((section) => section.id === tab)?.id ?? 'chat';
  const room = useResource<Room>(`flights/${flightId}`);
  useRealtime({connect: room.reload, 'flight:updated': (event) => { if (event.flightId === flightId) room.reload(); }});
  const details = room.data;
  return <AppShell area="flight">
    <ErrorMessage error={room.error} retry={room.reload} />
    {!details && !room.error && <Loading label="Loading your flight room…" />}
    {details && <>
      <header className="fa-room-title"><div><div className="fa-room-route"><h1>{flightLabel(details)}</h1><span>{details.departureAirport}<ArrowRight size={14} aria-label="to" />{details.arrivalAirport}</span></div><p>{formatDate(details.departureDate)}{details.departureTime ? ` · ${details.departureTime} local` : ''}</p></div><div className="fa-room-membership"><StatusBadge status={details.membership.verificationStatus} /><LeaveRoom flightId={flightId} /></div></header>
      {active === 'passengers' && <Directory flightId={flightId} />}
      {active === 'rides' && <RideDiscovery key={flightId} room={details} reload={room.reload} />}
      {active === 'chat' && <FlightChat flightId={flightId} members={details.memberCount} />}
      {active === 'matches' && <BaggageMatches key={flightId} flightId={flightId} />}
      {active === 'policy' && <AirlinePolicy flightId={flightId} />}
      {active === 'messages' && <ConversationList flightId={flightId} />}
      <nav className="fa-room-nav" aria-label="Flight sections">{sections.map(({id, label, short, icon: Icon}) => <Link aria-label={label} aria-current={id === active ? 'page' : undefined} key={id} href={`/flights/${flightId}${id === 'chat' ? '' : `?tab=${id}`}`}><Icon size={19} aria-hidden="true" /><span aria-hidden="true">{short}</span></Link>)}</nav>
    </>}
  </AppShell>;
}