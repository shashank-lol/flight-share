'use client';

import Link from 'next/link';
import {Luggage, MessageCircle, ShieldCheck} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {api, formatKg, type Baggage, type Page} from './api';
import {baggageDraft, BaggageFields, baggagePayload, emptyBaggage} from './fields';
import {useRealtime} from './realtime';
import {Dialog} from './safety';
import {Empty, ErrorMessage, Loading, Notice, Pager} from './ui';
import {useResource} from './use-resource';

type OwnBaggage = Baggage & {baggageReported: boolean};
type Candidate = {passengerId: string; displayName: string; excess: number; available: number; potentialWeight: number; remainingExcess: number};
type BaggageRequest = {id: string; displayName: string; direction: 'INCOMING' | 'OUTGOING'; status: 'PENDING' | 'ACCEPTED'; conversationId: string | null};
type MatchPage = Page<Candidate> & {requests: BaggageRequest[]; baggage: OwnBaggage; disclaimer: string; eligibility: 'READY' | 'MISSING_BAGGAGE' | 'PRIVATE' | 'BALANCED' | 'MATCHED'};
type Action = 'accept' | 'decline' | 'withdraw' | 'end';

function OwnBaggageCard({flightId, baggage, reload}: {flightId: string; baggage: OwnBaggage; reload: () => void}) {
  const [draft, setDraft] = useState(emptyBaggage);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const balance = Math.round((baggage.baggageAllowance - baggage.expectedBaggageWeight) * 100) / 100;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      await api('profile/baggage', {method: 'PATCH', body: {flightId, ...baggagePayload(draft)}});
      setEditing(false); setSaved(true); reload();
    } catch (issue) { setError(issue); } finally { setBusy(false); }
  }

  return <>
    <div className="fa-room-settings"><div><Luggage size={21} aria-hidden="true" /><div><h3>Your baggage</h3><small>{baggage.baggageReported ? `${formatKg(baggage.expectedBaggageWeight)} expected · ${formatKg(baggage.baggageAllowance)} allowance` : 'No details added for this flight'}</small>{baggage.baggageReported && <><small><strong>{balance === 0 ? 'At your allowance' : `${formatKg(Math.abs(balance))} ${balance > 0 ? 'available' : 'over allowance'}`}</strong></small>{baggage.cabinBaggage && <small>Cabin baggage: {baggage.cabinBaggage}</small>}</>}</div></div>
      <div className="fa-actions"><button type="button" className="fa-button fa-secondary fa-compact" onClick={() => { setDraft(baggage.baggageReported ? baggageDraft(baggage) : emptyBaggage); setError(undefined); setSaved(false); setEditing(true); }}>{baggage.baggageReported ? 'Edit baggage' : 'Add baggage'}</button>{saved && <span className="fa-badge" role="status">Baggage updated</span>}</div>
    </div>
    {editing && <Dialog title={baggage.baggageReported ? 'Edit your baggage' : 'Add your baggage'} onClose={() => { if (!busy) setEditing(false); }}><form className="fa-form" onSubmit={(event) => void save(event)}>
      <p className="fa-muted">Use your own allowance and expected weight, not your party’s combined baggage.</p>
      <BaggageFields value={draft} onChange={setDraft} />
      <ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="fa-button fa-primary" disabled={busy}>{busy ? 'Saving…' : 'Save baggage'}</button></div>
    </form></Dialog>}
  </>;
}

export function BaggageMatches({flightId}: {flightId: string}) {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState('');
  const [ending, setEnding] = useState<BaggageRequest>();
  const {data, error: requestError, reload} = useResource<MatchPage>(`flights/${flightId}/matches?page=${page}`);
  useRealtime({connect: reload, 'flight:updated': (event) => { if (event.flightId === flightId) reload(); }, 'conversations:updated': reload, 'notification:new': reload});
  useEffect(() => {
    const refresh = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 45_000);
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, [reload]);

  async function mutate(value: {passengerId: string} | {requestId: string; action: Action}) {
    if (busy) return;
    setBusy(true); setError(undefined); setStatus('');
    try {
      const path = `flights/${flightId}/baggage-requests`;
      if ('passengerId' in value) {
        const result = await api<{status?: string}>(path, {method: 'POST', body: value});
        setStatus(result?.status === 'ACCEPTED' ? 'Baggage match confirmed.' : 'Baggage request sent.');
      } else {
        await api(`${path}/${value.requestId}`, {method: 'PATCH', body: {action: value.action}});
        setStatus({accept: 'Baggage match confirmed.', decline: 'Baggage request declined.', withdraw: 'Baggage request withdrawn.', end: 'Baggage match ended.'}[value.action]);
        setEnding(undefined);
      }
      setPage(1);
    } catch (issue) { setError(issue); } finally { setBusy(false); reload(); }
  }

  return <section className="fa-section" aria-labelledby="baggage-matches-title">
    <div className="fa-section-head"><div><h2 id="baggage-matches-title">Baggage matches</h2><p className="fa-muted">A match is confirmed only when both travellers agree.</p></div></div>
    <ErrorMessage error={requestError} retry={reload} />
    <ErrorMessage error={error} />
    {status && <span className="fa-badge" role="status">{status}</span>}
    {!data && !requestError && <Loading label="Loading baggage…" />}
    {data && <>
      <OwnBaggageCard flightId={flightId} baggage={data.baggage} reload={reload} />
      <Notice icon={ShieldCheck}>{data.disclaimer} Check with your airline before making arrangements. Never carry unknown items for someone else.</Notice>
      {data.requests.length > 0 && <section className="fa-baggage-group" aria-label="Your baggage requests"><h3>Your requests</h3><div className="fa-passenger-grid">{data.requests.map((request) => <article className="fa-passenger" key={request.id}>
        <div className="fa-passenger-person"><span className="fa-icon-box"><Luggage size={19} aria-hidden="true" /></span><div><h3>{request.displayName}</h3><span className="fa-badge fa-badge-accent">{request.status === 'ACCEPTED' ? 'Confirmed match' : request.direction === 'INCOMING' ? 'Incoming request' : 'Request sent'}</span></div></div>
        {request.status === 'ACCEPTED' ? <><p className="fa-muted">Only you and this traveller can see this match.</p><div className="fa-actions">{request.conversationId && <Link href={`/dashboard/messages/${request.conversationId}`} className="fa-button fa-primary fa-compact"><MessageCircle size={16} aria-hidden="true" /> Open chat</Link>}<button className="fa-text-button" type="button" disabled={busy} onClick={() => { setError(undefined); setEnding(request); }}>End match</button></div></> : <div className="fa-actions">
          {request.direction === 'INCOMING' ? <><button className="fa-button fa-primary fa-compact" type="button" disabled={busy} onClick={() => void mutate({requestId: request.id, action: 'accept'})}>Accept</button><button className="fa-button fa-secondary fa-compact" type="button" disabled={busy} onClick={() => void mutate({requestId: request.id, action: 'decline'})}>Decline</button></> : <button className="fa-button fa-secondary fa-compact" type="button" disabled={busy} onClick={() => void mutate({requestId: request.id, action: 'withdraw'})}>Withdraw request</button>}
        </div>}
      </article>)}</div></section>}
      {data.eligibility === 'MISSING_BAGGAGE' && <p className="fa-muted">Add your baggage above to find potential matches.</p>}
      {data.eligibility === 'PRIVATE' && <p className="fa-muted">Baggage matching is off while your baggage details are private. <Link className="fa-link" href="/dashboard/settings">Privacy settings</Link></p>}
      {data.eligibility === 'BALANCED' && <p className="fa-muted">Your expected weight is exactly at your allowance, so there’s nothing to match.</p>}
      {data.eligibility === 'MATCHED' && <p className="fa-muted">Your listing is hidden while you have a confirmed match.</p>}
      {data.eligibility === 'READY' && <section className="fa-baggage-group" aria-label="Potential baggage matches"><h3>Potential matches</h3>
        {data.items.length ? <div className="fa-passenger-grid">{data.items.map((candidate) => <article className="fa-passenger" key={candidate.passengerId}>
          <div className="fa-passenger-person"><span className="fa-icon-box"><Luggage size={19} aria-hidden="true" /></span><h3>{candidate.displayName}</h3></div>
          <p className="fa-match-weight">{formatKg(candidate.potentialWeight)}<span>potential weight match</span></p>
          <dl className="fa-match-metrics"><div><dt>Excess</dt><dd>{formatKg(candidate.excess)}</dd></div><div><dt>Available</dt><dd>{formatKg(candidate.available)}</dd></div><div><dt>Uncovered excess</dt><dd>{formatKg(candidate.remainingExcess)}</dd></div></dl>
          <button className="fa-button fa-secondary fa-compact" type="button" disabled={busy} onClick={() => void mutate({passengerId: candidate.passengerId})}>Send request</button>
        </article>)}</div> : <Empty icon={Luggage} title="No potential matches right now"><p>Check back for other travellers with a complementary baggage balance.</p></Empty>}
        <Pager page={page} hasMore={data.hasMore} onChange={setPage} />
      </section>}
    </>}
    {ending && <Dialog title="End this baggage match?" onClose={() => { if (!busy) setEnding(undefined); }}><div className="fa-form"><p>Your private chat will stay. You and {ending.displayName} can appear in potential matches again if your details are still shared.</p><ErrorMessage error={error} /><div className="fa-actions"><button className="fa-button fa-secondary" type="button" disabled={busy} onClick={() => setEnding(undefined)}>Cancel</button><button className="fa-button fa-danger" type="button" disabled={busy} onClick={() => void mutate({requestId: ending.id, action: 'end'})}>End match</button></div></div></Dialog>}
  </section>;
}