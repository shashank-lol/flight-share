'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowUpRight, Bell, Check, Luggage, MessageCircle, Users} from 'lucide-react';
import {useState} from 'react';
import {api} from './api';
import {AppShell} from './app-shell';
import {useRealtime} from './realtime';
import {formatTime, type Notification, type Notifications} from './social-types';
import {Empty, ErrorMessage, Eyebrow, Loading, Pager} from './ui';
import {useResource} from './use-resource';

function notificationDetails({type, payload}: Notification) {
  const room = payload.flightId ? `/flights/${encodeURIComponent(payload.flightId)}` : null;
  if (type === 'NEW_MESSAGE') return {title: 'New message', text: 'A traveller sent you a message.', icon: MessageCircle, href: payload.conversationId ? `/dashboard/messages/${encodeURIComponent(payload.conversationId)}` : '/dashboard/messages'};
  if (type === 'NEW_PASSENGER') return {title: 'New traveller in your flight room', text: 'Someone joined one of your flights.', icon: Users, href: room};
  if (type === 'BAGGAGE_MATCH') return {title: 'Potential baggage match', text: 'There may be a compatible weight estimate for your flight.', icon: Luggage, href: room ? `${room}?tab=matches` : null};
  return {title: 'Flight Share update', text: 'There’s an update for your account.', icon: Bell, href: null};
}

export function NotificationsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>();
  const result = useResource<Notifications>(`notifications?page=${page}`);
  useRealtime({connect: result.reload, 'notification:new': result.reload, 'conversations:updated': result.reload, 'flight:updated': result.reload});

  async function mark(id?: string, href?: string) {
    if (busy) return;
    setBusy(id ?? 'all'); setError(undefined);
    try {
      await api(id ? `notifications/${id}/read` : 'notifications/read', {method: 'PATCH', body: {}});
      result.reload();
      window.dispatchEvent(new Event('flightshare:notifications'));
      if (href) router.push(href);
    } catch (issue) { setError(issue); } finally { setBusy(''); }
  }

  return <AppShell area="notifications"><section className="fa-section">
    <div className="fa-section-head"><div><Eyebrow>STAY UP TO DATE</Eyebrow><h1>Notifications</h1><p className="fa-muted">Messages, new travellers and potential matches from your flight rooms.</p></div>{!!result.data?.unreadCount && <button type="button" className="fa-button fa-secondary fa-compact" disabled={!!busy} onClick={() => void mark()}><Check size={17} aria-hidden="true" /> Mark all as read</button>}</div>
    <ErrorMessage error={result.error} retry={result.reload} /><ErrorMessage error={error} />
    {!result.data && !result.error && <Loading label="Loading notifications…" />}
    {result.data?.items.length === 0 && <Empty icon={Bell} title="You’re all caught up"><p>Updates will appear here as activity happens in your flight rooms.</p></Empty>}
    {!!result.data?.items.length && <ul className="fa-notifications">{result.data.items.map((item) => {
      const {title, text, href, icon: Icon} = notificationDetails(item);
      return <li key={item.id} className={!item.readAt ? 'fa-unread' : undefined}><span className="fa-icon-box"><Icon size={22} aria-hidden="true" /></span><div><h2>{title}{!item.readAt && <span className="fa-badge fa-badge-accent">Unread</span>}</h2><p>{text}</p><time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time><div className="fa-actions">{href && <Link className="fa-link" href={href} onNavigate={item.readAt ? undefined : (event) => { event.preventDefault(); void mark(item.id, href); }}>Open <ArrowUpRight size={14} aria-hidden="true" /></Link>}{!item.readAt && <button className="fa-text-button" type="button" disabled={!!busy} onClick={() => void mark(item.id)}>Mark as read</button>}</div></div></li>;
    })}</ul>}
    {result.data && <Pager page={page} hasMore={result.data.hasMore} onChange={setPage} />}
  </section></AppShell>;
}