'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowUpRight, Car, Cloud, Luggage, LogOut, MessageCircle, MessagesSquare, Search, ShieldCheck, SlidersHorizontal, UserRound, Users} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {api, flightLabel, formatKg, transportationLabels, type Page, type Passenger, type Policy, type Room, type WeightMatch} from './api';
import {AppShell} from './app-shell';
import {baggageDraft, BaggageFields, baggagePayload, emptyBaggage, Field} from './fields';
import {FlightChat} from './flight-chat';
import {useRealtime} from './realtime';
import {Dialog, SafetyActions} from './safety';
import {ConversationList, startConversation} from './messages';
import {RideDiscovery} from './ride-discovery';
import {Empty, ErrorMessage, Eyebrow, FlightTicket, Loading, Notice, Pager, StatusBadge} from './ui';
import {useResource} from './use-resource';

const sections = [
  {id: 'passengers', label: 'Passengers', icon: Users},
  {id: 'rides', label: 'Airport rides', icon: Car},
  {id: 'chat', label: 'Group chat', icon: MessagesSquare},
  {id: 'matches', label: 'Baggage matches', icon: Luggage},
  {id: 'policy', label: 'Airline policy', icon: ShieldCheck},
  {id: 'messages', label: 'Messages', icon: MessageCircle},
] as const;
const filters = [{id: 'all', label: 'Everyone'}, {id: 'excess', label: 'Excess baggage'}, {id: 'available', label: 'Available baggage'}, {id: 'cab', label: 'Cab sharing'}, {id: 'companions', label: 'Companionship'}];

function PassengerCard({flightId, passenger, reload}: {flightId: string; passenger: Passenger; reload: () => void}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [showSafety, setShowSafety] = useState(false);
  const {remainingWeight, transportation, companionship, baggageAllowance, expectedBaggageWeight} = passenger;
  return <article className="fa-passenger">
    <div className="fa-passenger-person"><span className="fa-avatar"><UserRound size={21} aria-hidden="true" /></span><div><h3>{passenger.displayName}{passenger.isSelf && ' (you)'}</h3>{passenger.isAnonymous && <p>{passenger.alias}</p>}<StatusBadge status={passenger.verificationStatus} /></div></div>
    <div className="fa-passenger-details">
      {remainingWeight !== null ? <div><Luggage size={17} aria-hidden="true" /><span><strong className={remainingWeight > 0 ? 'fa-weight-available' : remainingWeight < 0 ? 'fa-weight-excess' : undefined}>{remainingWeight === 0 ? 'At allowance' : `${formatKg(Math.abs(remainingWeight))} ${remainingWeight > 0 ? 'available' : 'excess'}`}</strong>{baggageAllowance !== null && expectedBaggageWeight !== null && <small>{formatKg(expectedBaggageWeight)} expected · {formatKg(baggageAllowance)} allowance</small>}</span></div> : <div><Luggage size={17} aria-hidden="true" /><span>Baggage details not shared</span></div>}
      {transportation && transportation !== 'NONE' && <div><Car size={17} aria-hidden="true" /><span>{transportationLabels[transportation]}</span></div>}
      {passenger.partySize !== null && passenger.partySize > 1 && <div><Users size={17} aria-hidden="true" /><span>Travelling in a party of {passenger.partySize}</span></div>}
      {companionship && <div><Users size={17} aria-hidden="true" /><span>Open to travel companionship</span></div>}
    </div>
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
    <div className="fa-section-head"><div><Eyebrow>THE FLIGHT ROOM</Eyebrow><h2>Passengers</h2><p className="fa-muted">Find travellers with similar plans. Only shared details are shown here.</p></div></div>
    <div className="fa-filterbar"><form role="search" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(draft.trim()); }}><Field label="Search passengers"><input type="search" maxLength={48} placeholder="Name or alias" value={draft} onChange={(event) => { setDraft(event.target.value); if (!event.target.value) { setQuery(''); setPage(1); } }} /></Field><button className="fa-icon-button" type="submit" aria-label="Search passengers"><Search size={19} aria-hidden="true" /></button></form><Field label="Sort by"><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="recent">Recently joined</option><option value="name">Name</option><option value="baggage">Available baggage</option></select></Field></div>
    <div className="fa-chips" aria-label="Filter passengers">{filters.map(({id, label}) => <button key={id} type="button" aria-pressed={id === filter} onClick={() => { setFilter(id); setPage(1); }}>{label}</button>)}</div>
    <ErrorMessage error={result.error} retry={result.reload} />
    {!result.data && !result.error && <Loading label="Loading passengers…" />}
    {result.data?.items.length === 0 && <Empty icon={Users} title="No passengers found"><p>Try a different search or filter, or check back later.</p></Empty>}
    {!!result.data?.items.length && <div className="fa-passenger-grid">{result.data.items.map((passenger) => <PassengerCard key={passenger.id} flightId={flightId} passenger={passenger} reload={result.reload} />)}</div>}
    {result.data && <Pager page={page} hasMore={result.data.hasMore} onChange={setPage} />}
  </section>;
}

function MatchList({flightId}: {flightId: string}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>();
  const result = useResource<Page<WeightMatch> & {disclaimer: string}>(`flights/${flightId}/matches?page=${page}`);
  useRealtime({connect: result.reload, 'flight:updated': (event) => { if (event.flightId === flightId) result.reload(); }, 'conversations:updated': result.reload});
  return <section className="fa-section">
    <div className="fa-section-head"><div><Eyebrow>WEIGHT ESTIMATES</Eyebrow><h2>Baggage matches</h2><p className="fa-muted">Compare declared weights before making any arrangements.</p></div></div>
    <Notice icon={ShieldCheck}>{result.data?.disclaimer ?? 'Confirm baggage rules directly with your airline.'} These are estimates, not approvals or transfers. Never carry unknown baggage or items for anyone.</Notice>
    <ErrorMessage error={result.error} retry={result.reload} /><ErrorMessage error={error} />
    {!result.data && !result.error && <Loading label="Checking baggage matches…" />}
    {result.data?.items.length === 0 && <Empty icon={Luggage} title="No potential matches right now"><p>Matches need visible baggage details and a traveller with a complementary weight balance. Check your privacy and baggage settings or try again later.</p><Link className="fa-link" href="/dashboard/settings">Privacy settings <ArrowUpRight size={16} aria-hidden="true" /></Link></Empty>}
    {!!result.data?.items.length && <div className="fa-passenger-grid">{result.data.items.map((match) => <article className="fa-passenger" key={match.passengerId}><div className="fa-passenger-person"><span className="fa-icon-box"><Luggage size={21} aria-hidden="true" /></span><div><h3>{match.displayName}</h3><span className="fa-badge fa-badge-accent">Potential match</span></div></div><p className="fa-match-weight">{formatKg(match.potentialWeight)}<span>potential weight match</span></p><dl className="fa-match-metrics"><div><dt>Excess</dt><dd>{formatKg(match.excess)}</dd></div><div><dt>Available</dt><dd>{formatKg(match.available)}</dd></div><div><dt>Uncovered excess</dt><dd>{formatKg(match.remainingExcess)}</dd></div></dl><button type="button" className="fa-button fa-secondary fa-compact" disabled={!!busy} onClick={() => { setBusy(match.passengerId); setError(undefined); void startConversation(flightId, match.passengerId).then((conversation) => router.push(`/dashboard/messages/${conversation.id}`), (issue: unknown) => { setBusy(''); setError(issue); }); }}><MessageCircle size={16} aria-hidden="true" /> {busy === match.passengerId ? 'Opening…' : 'Message traveller'}</button></article>)}</div>}
    {result.data && <Pager page={page} hasMore={result.data.hasMore} onChange={setPage} />}
  </section>;
}

function AirlinePolicy({flightId}: {flightId: string}) {
  const result = useResource<Policy>(`flights/${flightId}/policy`);
  return <section className="fa-section"><div className="fa-section-head"><div><Eyebrow>CHECK WITH YOUR CARRIER</Eyebrow><h2>Airline policy</h2></div></div>
    <ErrorMessage error={result.error} retry={result.reload} />
    {!result.data && !result.error && <Loading label="Loading airline policy…" />}
    {result.data && <article className="fa-panel fa-stack"><div className="fa-passenger-person"><span className="fa-icon-box"><ShieldCheck size={25} aria-hidden="true" /></span><div><span className="fa-badge">{result.data.status === 'UNKNOWN' ? 'Policy not confirmed' : result.data.status}</span><h3>Baggage rules</h3></div></div><p>{result.data.summary}</p>{!!result.data.restrictions.length && <ul className="fa-rule-list">{result.data.restrictions.map((restriction, index) => <li key={index}>{restriction}</li>)}</ul>}</article>}
    <Notice icon={ShieldCheck}>Flight Share does not change your baggage allowance. Confirm weight limits, pooling rules, and fees with your airline before making arrangements. Never accept unknown items.</Notice>
  </section>;
}

function ManageRoom({room, reload}: {room: Room; reload: () => void}) {
  const router = useRouter();
  const [mode, setMode] = useState<'baggage' | 'leave'>();
  const [draft, setDraft] = useState(() => room.membership.baggageReported ? baggageDraft(room.membership) : emptyBaggage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode || busy) return;
    setBusy(true); setError(undefined);
    if (mode === 'leave') {
      void api(`flights/${room.id}/leave`, {method: 'DELETE'}).then(() => router.replace('/dashboard'), (issue: unknown) => { setError(issue); setBusy(false); });
    } else {
      void api('profile/baggage', {method: 'PATCH', body: {flightId: room.id, ...baggagePayload(draft)}}).then(() => { setMode(undefined); setBusy(false); setSaved(true); reload(); }, (issue: unknown) => { setError(issue); setBusy(false); });
    }
  }
  return <>
    <div className="fa-room-settings"><div><Luggage size={19} aria-hidden="true" /><span><strong>Your baggage</strong><small>{room.membership.baggageReported ? `${formatKg(room.membership.expectedBaggageWeight)} expected · ${formatKg(room.membership.baggageAllowance)} allowance` : 'Not added'}</small></span></div><div className="fa-actions"><button type="button" className="fa-text-button" onClick={() => { setDraft(room.membership.baggageReported ? baggageDraft(room.membership) : emptyBaggage); setError(undefined); setSaved(false); setMode('baggage'); }}><SlidersHorizontal size={16} aria-hidden="true" /> {room.membership.baggageReported ? 'Edit baggage' : 'Add baggage'}</button><button type="button" className="fa-text-button" onClick={() => { setError(undefined); setMode('leave'); }}><LogOut size={16} aria-hidden="true" /> Leave room</button></div>{saved && <span className="fa-badge" role="status">Baggage updated</span>}</div>
    {mode && <Dialog title={mode === 'baggage' ? 'Edit your baggage' : 'Leave this flight room?'} onClose={() => { if (!busy) setMode(undefined); }}><form className="fa-form" onSubmit={submit}>
      {mode === 'baggage' ? <><p className="fa-entry-caption">Add only your own baggage, not combined weights for your party.</p><BaggageFields value={draft} onChange={setDraft} /></> : <p className="fa-intro">You’ll lose access to the passenger list, matches and conversations for this flight room.</p>}
      <ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" onClick={() => setMode(undefined)} disabled={busy}>Cancel</button><button type="submit" className={`fa-button ${mode === 'baggage' ? 'fa-primary' : 'fa-danger'}`} disabled={busy}>{busy ? 'Working…' : mode === 'baggage' ? 'Save baggage' : 'Leave flight room'}</button></div>
    </form></Dialog>}
  </>;
}

export function FlightRoom({flightId, tab}: {flightId: string; tab?: string}) {
  const active = sections.find((section) => section.id === tab)?.id ?? 'passengers';
  const room = useResource<Room>(`flights/${flightId}`);
  useRealtime({connect: room.reload, 'flight:updated': (event) => { if (event.flightId === flightId) room.reload(); }});
  const details = room.data;
  return <AppShell area="flight" breadcrumb={details ? flightLabel(details) : 'Flight room'}>
    <ErrorMessage error={room.error} retry={room.reload} />
    {!details && !room.error && <Loading label="Loading your flight room…" />}
    {details && <>
      <div className="fa-section-head fa-room-title"><div><Eyebrow>YOUR FLIGHT ROOM</Eyebrow><h1>{flightLabel(details)} flight room</h1><p className="fa-muted">Connect with passengers on this flight.</p></div><span className="fa-badge"><Cloud size={16} aria-hidden="true" /> Flight room</span></div>
      <FlightTicket flight={details} members={details.memberCount} status={details.membership.verificationStatus} prominent />
      <ManageRoom room={details} reload={room.reload} />
      <nav className="fa-room-nav" aria-label="Flight room sections">{sections.map(({id, label, icon: Icon}) => <Link scroll={false} aria-current={id === active ? 'page' : undefined} key={id} href={`/flights/${flightId}${id === 'passengers' ? '' : `?tab=${id}`}`}><Icon size={18} aria-hidden="true" /> {label}</Link>)}</nav>
      {active === 'passengers' && <Directory flightId={flightId} />}
      {active === 'rides' && <RideDiscovery key={flightId} room={details} reload={room.reload} />}
      {active === 'chat' && <div className="fa-section"><FlightChat flightId={flightId} /></div>}
      {active === 'matches' && <MatchList flightId={flightId} />}
      {active === 'policy' && <AirlinePolicy flightId={flightId} />}
      {active === 'messages' && <ConversationList flightId={flightId} />}
    </>}
  </AppShell>;
}