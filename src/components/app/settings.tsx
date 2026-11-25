'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowUpRight, Ban, ShieldCheck, Trash2, UserRound} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {api, type Preferences, type Profile} from './api';
import {AppShell} from './app-shell';
import {Field, PreferenceFields} from './fields';
import {useRealtime} from './realtime';
import {Dialog} from './safety';
import {formatTime, type Block} from './social-types';
import {ErrorMessage, Eyebrow, Loading, Notice} from './ui';
import {useResource} from './use-resource';

function ProfileForm({profile}: {profile: Preferences}) {
  const [value, setValue] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<unknown>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(undefined); setStatus('');
    try {
      const updated = await api<Preferences>('profile', {method: 'PATCH', body: value});
      setValue(updated); setStatus('Profile saved');
    } catch (issue) { setError(issue); } finally { setBusy(false); }
  }

  return <form className="fa-form" onSubmit={(event) => void save(event)}>
    <PreferenceFields value={value} onChange={(next) => { setValue(next); setStatus(''); }} />
    <ErrorMessage error={error} /><div className="fa-actions"><button type="submit" className="fa-button fa-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>{status && <span className="fa-badge" role="status">{status}</span>}</div>
  </form>;
}

function BlockList() {
  const result = useResource<{items: Block[]}>('blocks');
  const [target, setTarget] = useState<Block>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<unknown>();
  useRealtime({connect: result.reload, 'conversations:updated': result.reload});

  async function unblock(event: FormEvent) {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true); setError(undefined);
    try { await api(`blocks/${target.id}`, {method: 'DELETE'}); setStatus('Traveller unblocked'); setTarget(undefined); result.reload(); }
    catch (issue) { setError(issue); } finally { setBusy(false); }
  }

  return <section className="fa-panel fa-stack"><div className="fa-panel-head"><span className="fa-icon-box"><Ban size={23} aria-hidden="true" /></span><div><h2>Blocked travellers</h2><p>People you’ve blocked won’t be visible to you in shared flight rooms.</p></div></div>
    <ErrorMessage error={result.error} retry={result.reload} />
    {!result.data && !result.error && <Loading label="Loading blocked travellers…" />}
    {result.data?.items.length === 0 && <p className="fa-muted">You haven’t blocked anyone.</p>}
    {!!result.data?.items.length && <ul className="fa-blocks">{result.data.items.map((item) => <li key={item.id}><div><strong>{item.displayName}</strong><small>Blocked {formatTime(item.createdAt)}</small></div><button type="button" className="fa-button fa-secondary fa-compact" onClick={() => { setError(undefined); setStatus(''); setTarget(item); }}>Unblock</button></li>)}</ul>}
    {status && <span className="fa-badge" role="status">{status}</span>}
    {target && <Dialog title="Unblock this traveller?" onClose={() => { if (!busy) setTarget(undefined); }}><form className="fa-form" onSubmit={(event) => void unblock(event)}><p className="fa-intro"><strong>{target.displayName}</strong> may see your shared flight room profile and message you again.</p><ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={() => setTarget(undefined)}>Cancel</button><button type="submit" className="fa-button fa-primary" disabled={busy}>{busy ? 'Unblocking…' : 'Unblock traveller'}</button></div></form></Dialog>}
  </section>;
}

function AccountActions() {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function removeAccount() {
    if (busy || confirmation !== 'DELETE') return;
    setBusy(true); setError(undefined);
    try { await api('profile', {method: 'DELETE'}); router.replace('/'); }
    catch (issue) { setError(issue); setBusy(false); }
  }

  return <section className="fa-panel fa-stack"><div className="fa-panel-head"><span className="fa-icon-box"><ShieldCheck size={23} aria-hidden="true" /></span><div><h2>Guest access and safety</h2><p>Guest access is tied to this browser and cannot be recovered after the session expires or you clear your cookies.</p></div></div>
    <Link className="fa-link" href="/legal/community">Community guidelines <ArrowUpRight size={15} aria-hidden="true" /></Link>
    {!deleting && <ErrorMessage error={error} />}
    <div className="fa-actions"><button type="button" className="fa-button fa-danger" disabled={busy} onClick={() => { setConfirmation(''); setError(undefined); setDeleting(true); }}><Trash2 size={17} aria-hidden="true" /> Delete account</button></div>
    {deleting && <Dialog title="Delete your account?" onClose={() => { if (!busy) setDeleting(false); }}><form className="fa-form" onSubmit={(event) => { event.preventDefault(); void removeAccount(); }}><Notice>This permanently deletes your account and removes access to your flight rooms and messages.</Notice><Field label="Type DELETE to confirm"><input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></Field><ErrorMessage error={error} /><div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button><button type="submit" className="fa-button fa-danger" disabled={busy || confirmation !== 'DELETE'}>{busy ? 'Deleting…' : 'Permanently delete account'}</button></div></form></Dialog>}
  </section>;
}

export function SettingsPage() {
  const result = useResource<Profile>('profile');
  return <AppShell area="settings"><section className="fa-section">
    <div className="fa-section-head"><div><Eyebrow>YOUR ACCOUNT</Eyebrow><h1>Profile and safety</h1><p className="fa-muted">Choose what other travellers see and manage your safety controls.</p></div></div>
    <ErrorMessage error={result.error} retry={result.reload} />
    {!result.data && !result.error && <Loading label="Loading your profile…" />}
    {result.data && <div className="fa-settings-grid">
      <section className="fa-panel fa-stack"><div className="fa-panel-head"><span className="fa-icon-box"><UserRound size={23} aria-hidden="true" /></span><div><h2>Profile and preferences</h2><p>These choices apply to all your flights. Edit baggage on each flight’s Baggage tab.</p></div></div>
      {result.data.profile ? <ProfileForm profile={result.data.profile} /> : <><p className="fa-muted">Join your first flight to set up your traveller profile.</p><Link className="fa-button fa-primary" href="/onboarding?add=1">Find your flight</Link></>}</section>
      <div className="fa-stack"><BlockList /><AccountActions /></div>
    </div>}
  </section></AppShell>;
}