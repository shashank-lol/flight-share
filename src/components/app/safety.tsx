'use client';

import {Ban, Flag, X} from 'lucide-react';
import {useEffect, useId, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {api} from './api';
import {Field} from './fields';
import {ErrorMessage, Notice} from './ui';

export function Dialog({title, children, onClose}: {title: string; children: ReactNode; onClose: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="fa-dialog" ref={ref} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="fa-section-head"><h2 id={id}>{title}</h2><button type="button" className="fa-icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
    {children}
  </dialog>;
}

export type SafetyTarget = {id: string; displayName: string};
const reasons = ['Harassment or threats', 'Spam or scam', 'Unsafe baggage request', 'Inappropriate behaviour', 'Other'];

export function SafetyActions({flightId, target, onBlocked, onReported}: {flightId: string; target: SafetyTarget; onBlocked?: () => void; onReported?: () => void}) {
  const [action, setAction] = useState<'block' | 'report'>();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [reported, setReported] = useState(false);

  function open(next: 'block' | 'report') { setError(undefined); setReason(''); setDescription(''); setAction(next); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !action) return;
    setError(undefined);
    setBusy(true);
    try {
      await api(`flights/${flightId}/${action}`, {method: 'POST', body: {passengerId: target.id, ...(action === 'report' ? {reason, ...(description.trim() ? {description: description.trim()} : {})} : {})}});
      setAction(undefined);
      if (action === 'block') onBlocked?.();
      else { setReported(true); onReported?.(); }
    } catch (issue) { setError(issue); } finally { setBusy(false); }
  }

  return <>
    <div className="fa-actions fa-safety-actions"><button type="button" className="fa-text-button" onClick={() => open('report')}><Flag size={15} aria-hidden="true" /> Report</button><button type="button" className="fa-text-button" onClick={() => open('block')}><Ban size={15} aria-hidden="true" /> Block</button>{reported && <span className="fa-badge" role="status">Report submitted</span>}</div>
    {action && <Dialog title={action === 'report' ? 'Report this traveller' : 'Block this traveller?'} onClose={() => { if (!busy) setAction(undefined); }}>
      <p className="fa-intro">{action === 'block' ? <>You and <strong>{target.displayName}</strong> will no longer see each other in flight rooms or be able to message one another. You can undo this in Settings.</> : <>Tell us what happened with <strong>{target.displayName}</strong>. Don’t include sensitive travel or payment details.</>}</p>
      <form className="fa-form" onSubmit={submit}>
        {action === 'report' && <><Field label="Reason"><select required value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select a reason</option>{reasons.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="What happened? (optional)"><textarea maxLength={1000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Notice>If you’re in immediate danger, contact airport security or local emergency services.</Notice></>}
        <ErrorMessage error={error} />
        <div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={() => setAction(undefined)}>Cancel</button><button type="submit" className={`fa-button ${action === 'block' ? 'fa-danger' : 'fa-primary'}`} disabled={busy}>{busy ? 'Submitting…' : action === 'block' ? 'Block traveller' : 'Submit report'}</button></div>
      </form>
    </Dialog>}
  </>;
}