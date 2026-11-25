'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowDown, ArrowLeft, ChevronRight, MessageCircle, Send, ShieldCheck, UserRound} from 'lucide-react';
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {api, ApiError, type Page} from './api';
import {AppShell} from './app-shell';
import {Field} from './fields';
import {requestPresence, sendTyping, useRealtime} from './realtime';
import {Dialog} from './safety';
import {formatTime, type ChatMessage, type Conversation, type MessagePage, type RideCompletion} from './social-types';
import {Empty, ErrorMessage, Eyebrow, Loading, Pager} from './ui';
import {useResource} from './use-resource';
import './chat.css';

export function startConversation(flightId: string, passengerId: string) {
  return api<Conversation>(`flights/${flightId}/conversations`, {method: 'POST', body: {passengerId}});
}

export function ConversationList({flightId}: {flightId?: string}) {
  const [page, setPage] = useState(1);
  const result = useResource<Page<Conversation>>(`conversations?${new URLSearchParams({page: String(page), ...(flightId ? {flightId} : {})})}`);
  useRealtime({connect: result.reload, 'conversation:updated': result.reload, 'conversations:updated': result.reload, 'flight:updated': result.reload});
  return <section className="fa-section">
    <div className="fa-section-head"><div><Eyebrow>DIRECT MESSAGES</Eyebrow>{flightId ? <h2>Messages</h2> : <h1>Messages</h1>}<p className="fa-muted">One private chat per traveller, for flights, baggage or airport cabs.</p></div></div>
    <ErrorMessage error={result.error} retry={result.reload} />
    {!result.data && !result.error && <Loading label="Loading conversations…" />}
    {result.data?.items.length === 0 && <Empty icon={MessageCircle} title="No conversations yet"><p>Select Message next to a passenger to start a private conversation.</p><Link className="fa-link" href={flightId ? `/flights/${flightId}?tab=passengers` : '/dashboard'}>{flightId ? 'See passengers' : 'See my flights'} <ChevronRight size={15} aria-hidden="true" /></Link></Empty>}
    {!!result.data?.items.length && <ul className="fa-inbox">{result.data.items.map((conversation) => <li key={conversation.id}><Link href={`/dashboard/messages/${conversation.id}`}>
      <span className="fa-avatar"><UserRound size={20} aria-hidden="true" /></span><span className="fa-inbox-body"><strong>{conversation.participant.displayName}</strong><span>{conversation.lastMessage ? `${conversation.lastMessage.isOwn ? 'You: ' : ''}${conversation.lastMessage.content}` : 'No messages yet'}</span></span><span className="fa-inbox-meta">{conversation.lastMessage && <time dateTime={conversation.lastMessage.createdAt}>{formatTime(conversation.lastMessage.createdAt)}</time>}{conversation.unreadCount > 0 && <span className="fa-count" aria-label={`${conversation.unreadCount} unread`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>}</span><ChevronRight size={18} aria-hidden="true" />
    </Link></li>)}</ul>}
    {result.data && <Pager page={page} hasMore={result.data.hasMore} onChange={setPage} />}
  </section>;
}

export function MessagesPage() { return <AppShell area="messages"><ConversationList /></AppShell>; }

type History = {items: ChatMessage[]; nextCursor: string | null};
const order = (a: ChatMessage, b: ChatMessage) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, 'en');

function mergeMessages(older: ChatMessage[], newer: ChatMessage[]) {
  return [...new Map([...older, ...newer].map((message) => [message.id, message])).values()].sort(order);
}

export function useChatHistory(path: string) {
  const [history, setHistory] = useState<History>();
  const current = useRef<History>(undefined);
  const syncedLatest = useRef<ChatMessage>(undefined);
  const [error, setError] = useState<unknown>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [revision, setRevision] = useState(0);
  const older = useRef<AbortController>(null);
  const revalidateAll = useRef(false);
  const reload = useCallback((all = false) => {
    if (all) {
      revalidateAll.current = true;
      older.current?.abort();
      older.current = null;
      setLoadingOlder(false);
    }
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => () => older.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const full = revalidateAll.current;
    async function fetchLatest() {
      let batch = await api<MessagePage<ChatMessage>>(path, {signal: controller.signal});
      const items = [...batch.items];
      const snapshot = current.current;
      const boundary = full ? snapshot?.items.at(0) : syncedLatest.current;
      // After a reconnect we may be more than one page behind. Walk the cursor until
      // we overlap the retained history (or cover its full extent if visibility changed).
      while (boundary && batch.nextCursor && batch.items.length && order(batch.items.at(-1)!, boundary) > 0) {
        batch = await api<MessagePage<ChatMessage>>(`${path}?cursor=${encodeURIComponent(batch.nextCursor)}`, {signal: controller.signal});
        items.push(...batch.items);
      }
      if (controller.signal.aborted) return;
      const retained = current.current;
      const next = {
        items: mergeMessages(full ? [] : retained?.items ?? [], items),
        nextCursor: full || !retained?.items.length || !batch.nextCursor ? batch.nextCursor : retained.nextCursor,
      };
      current.current = next;
      syncedLatest.current = items[0];
      revalidateAll.current = false;
      setHistory(next);
      setError(undefined);
    }
    void fetchLatest().catch((issue: unknown) => {
      if (controller.signal.aborted) return;
      if (issue instanceof ApiError && [401, 403, 404].includes(issue.status)) {
        older.current?.abort();
        older.current = null;
        setLoadingOlder(false);
        current.current = undefined;
        syncedLatest.current = undefined;
        setHistory(undefined);
      }
      setError(issue);
    });
    return () => controller.abort();
  }, [path, revision]);

  async function loadOlder(beforeInsert: () => void) {
    const cursor = current.current?.nextCursor;
    if (!cursor || older.current || revalidateAll.current) return;
    const controller = new AbortController();
    older.current = controller;
    setLoadingOlder(true);
    try {
      const batch = await api<MessagePage<ChatMessage>>(`${path}?cursor=${encodeURIComponent(cursor)}`, {signal: controller.signal});
      if (controller.signal.aborted || !current.current) return;
      beforeInsert();
      const next = {items: mergeMessages(batch.items, current.current.items), nextCursor: batch.nextCursor};
      current.current = next;
      setHistory(next);
      setError(undefined);
    } catch (issue) {
      if (controller.signal.aborted) return;
      setError(issue);
      if (issue instanceof ApiError && [401, 403, 404].includes(issue.status)) reload(true);
    } finally {
      if (older.current === controller) { older.current = null; setLoadingOlder(false); }
    }
  }

  function append(message: ChatMessage) {
    if (!current.current) return;
    const next = {...current.current, items: mergeMessages(current.current.items, [message])};
    current.current = next;
    setHistory(next);
  }

  const markRead = useCallback((id: string) => {
    const snapshot = current.current;
    const through = snapshot?.items.find((message) => message.id === id);
    if (!snapshot || !through) return;
    const readAt = new Date().toISOString();
    const next = {...snapshot, items: snapshot.items.map((message) => !message.isOwn && !message.readAt && order(message, through) <= 0 ? {...message, readAt} : message)};
    current.current = next;
    setHistory(next);
  }, []);

  return {history, error, reload, loadOlder, loadingOlder, append, markRead};
}

export function ChatWindow({path, result, heading, label, group = false, peer, typing, onDraft, onStopTyping, onSent}: {
  path: string; result: ReturnType<typeof useChatHistory>; heading: ReactNode; label: string; group?: boolean; peer?: string; typing?: string;
  onDraft?: (value: string) => void; onStopTyping?: () => void; onSent?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>();
  const [jump, setJump] = useState(false);
  const pending = useRef<{clientId: string; content: string}>(null);
  const windowRef = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const atEnd = useRef(true);
  const anchor = useRef<{row: HTMLElement; top: number} | null>(null);
  const {history, error, reload, loadOlder, loadingOlder, append} = result;
  const messages = history?.items;

  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    if (anchor.current) {
      const {row, top} = anchor.current;
      if (row.isConnected) el.scrollTop += row.getBoundingClientRect().top - top;
      anchor.current = null;
    } else if (atEnd.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const el = windowRef.current;
    if (!viewport || !el) return;
    const update = () => {
      el.style.setProperty('--chat-viewport', `${viewport.height}px`);
      if (document.activeElement === composer.current && viewport.height < window.innerHeight - 80) {
        // Embedded flight chat may sit below the flight header and tabs.
        composer.current?.scrollIntoView({block: 'nearest'});
      }
      if (atEnd.current && log.current) log.current.scrollTop = log.current.scrollHeight;
    };
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);

  function scrollToEnd() {
    atEnd.current = true;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    setJump(false);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (busy || !content || !history) return;
    onStopTyping?.();
    setBusy(true);
    setSendError(undefined);
    // Retry the exact same draft with the same client id if the acknowledgement was lost.
    const request = pending.current?.content === content ? pending.current : {clientId: crypto.randomUUID(), content};
    pending.current = request;
    try {
      const message = await api<ChatMessage>(path, {method: 'POST', body: request});
      setDraft('');
      pending.current = null;
      scrollToEnd();
      append(message);
      onSent?.();
      reload();
    } catch (issue) {
      setSendError(issue);
      if (issue instanceof ApiError && [401, 403, 404].includes(issue.status)) reload(true);
    } finally {
      setBusy(false);
    }
  }

  return <section ref={windowRef} className={`fa-thread ${group ? 'fa-thread-group' : 'fa-thread-private'}`} aria-label={label}>
    {heading}
    <div className="fa-thread-body">
      <div className="fa-thread-scroll" ref={log} tabIndex={0} aria-label={label} onScroll={(event) => {
        const el = event.currentTarget;
        atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        setJump(!atEnd.current);
      }}>
        <ErrorMessage error={error} retry={() => reload(true)} />
        {!messages && !error && <Loading label="Loading messages…" />}
        {history?.nextCursor && <div className="fa-thread-history"><button type="button" className="fa-button fa-secondary fa-compact" disabled={loadingOlder} onClick={() => void loadOlder(() => {
          const view = log.current;
          const row = view && Array.from(view.querySelectorAll<HTMLElement>('.fa-thread-message')).find((item) => item.getBoundingClientRect().bottom > view.getBoundingClientRect().top);
          if (row) anchor.current = {row, top: row.getBoundingClientRect().top};
        })}>{loadingOlder ? 'Loading…' : 'Load older messages'}</button></div>}
        {messages?.length === 0 && <Empty icon={MessageCircle} title={group ? 'No group messages yet' : 'Start the conversation'}><p>{group ? 'Say hello to the travellers on your flight.' : 'Say hello and let your fellow traveller know why you’re reaching out.'}</p></Empty>}
        <div role="log" aria-label={label} aria-live="polite"><ol className="fa-thread-log">{messages?.map((message) => <li key={message.id} className={`fa-thread-message${message.isOwn ? ' is-own' : ''}`}>
          {group && !message.isOwn ? <strong>{message.displayName}</strong> : <span className="fa-sr-only">{message.isOwn ? 'You' : peer}: </span>}
          <p>{message.content}</p><time dateTime={message.createdAt}>{formatTime(message.createdAt)}{message.isOwn && message.readAt && ' · Read'}</time>
        </li>)}</ol></div>
      </div>
      {jump && !!messages?.length && <button type="button" className="fa-button fa-secondary fa-compact fa-thread-jump" onClick={scrollToEnd}><ArrowDown size={15} aria-hidden="true" /> Latest messages</button>}
    </div>
    <form className="fa-thread-composer" onSubmit={(event) => void send(event)}>
      <ErrorMessage error={sendError} />
      {typing && <div className="fa-thread-typing" role="status">{typing}</div>}
      <div className="fa-thread-compose-row">
        <textarea ref={composer} aria-label="Your message" rows={1} maxLength={2000} required value={draft} placeholder={group ? 'Message your flight…' : 'Write a message…'} readOnly={busy} disabled={!history} onBlur={onStopTyping} onChange={(event) => { setDraft(event.target.value); onDraft?.(event.target.value); }} />
        <button type="submit" className="fa-button fa-primary fa-thread-send" aria-label="Send message" disabled={!history || busy || !draft.trim()}><span>{busy ? 'Sending…' : 'Send'}</span><Send size={18} aria-hidden="true" /></button>
      </div>
    </form>
  </section>;
}

function Thread({conversation, refresh}: {conversation: Conversation; refresh: () => void}) {
  const router = useRouter();
  const {id} = conversation;
  const [visible, setVisible] = useState(true);
  const [peerOnline, setPeerOnline] = useState<boolean>();
  const [peerTyping, setPeerTyping] = useState(false);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const localTyping = useRef(0);
  const path = `conversations/${id}/messages`;
  const result = useChatHistory(path);
  const {reload, markRead} = result;
  const connected = useRealtime({connect: () => reload(), 'conversation:updated': (event) => { if (event.conversationId === id) reload(); }, 'conversations:updated': () => reload(true), 'flight:updated': (event) => {
    if (conversation.contexts.some(({flightId, peerFlightId}) => event.flightId === flightId || event.flightId === peerFlightId)) reload(true);
  }, 'conversation:typing': (event) => {
    if (event.conversationId !== id) return;
    clearTimeout(peerTypingTimer.current);
    setPeerTyping(event.typing);
    if (event.typing) peerTypingTimer.current = setTimeout(() => setPeerTyping(false), 5200);
  }});

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const poll = () => { if (!document.hidden) requestPresence(id, (value) => { if (!cancelled) setPeerOnline(value); }); };
    poll();
    const interval = setInterval(poll, 20_000);
    document.addEventListener('visibilitychange', poll);
    return () => { cancelled = true; clearInterval(interval); document.removeEventListener('visibilitychange', poll); };
  }, [id, connected]);
  useEffect(() => () => {
    clearTimeout(peerTypingTimer.current);
    if (localTyping.current) sendTyping(id, false);
  }, [id]);

  function stopTyping() {
    if (!localTyping.current) return;
    localTyping.current = 0;
    sendTyping(id, false);
  }

  function edit(value: string) {
    if (!value.trim()) { stopTyping(); return; }
    if (connected && Date.now() - localTyping.current >= 4000) {
      localTyping.current = Date.now();
      sendTyping(id, true);
    }
  }

  const latestUnread = result.history?.items.reduce<string | undefined>((latest, message) => !message.isOwn && !message.readAt ? message.id : latest, undefined);
  useEffect(() => {
    const onVisibility = () => { setVisible(!document.hidden); if (!document.hidden) { reload(true); refresh(); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [reload, refresh]);
  useEffect(() => {
    const poll = setInterval(() => { if (!document.hidden) { reload(true); refresh(); } }, 45_000);
    return () => clearInterval(poll);
  }, [reload, refresh]);
  useEffect(() => {
    if (!latestUnread || !visible || document.hidden) return;
    const controller = new AbortController();
    void api(`conversations/${id}/read`, {method: 'PATCH', body: {messageId: latestUnread}, signal: controller.signal}).then(() => {
      if (controller.signal.aborted) return;
      markRead(latestUnread);
      if (!connected) refresh();
    }, () => {});
    return () => controller.abort();
  }, [id, latestUnread, visible, connected, markRead, refresh]);
  const blocked = () => router.replace('/dashboard/messages');
  const heading = <header className="fa-thread-header">
    <div className="fa-thread-heading-main">
      <Link href="/dashboard/messages" className="fa-icon-button fa-thread-back" aria-label="All messages" title="All messages"><ArrowLeft size={20} aria-hidden="true" /></Link>
      <span className="fa-avatar"><UserRound size={21} aria-hidden="true" /></span>
      <div className="fa-thread-title"><span>PRIVATE CHAT</span><h1>{conversation.participant.displayName}</h1>
        <ChatStatus connected={connected} text={peerOnline ? 'Traveller online' : peerOnline === false ? 'Traveller offline · Live updates on' : undefined} refresh={() => { reload(true); refresh(); }} />
      </div>
      <details className="fa-thread-safety"><summary className="fa-icon-button" aria-label="Safety options" title="Safety options"><ShieldCheck size={20} aria-hidden="true" /></summary><div className="fa-thread-safety-panel">
        <p>Keep booking references, identity documents and payment details out of chat. If you meet, choose a public place at the airport.</p>
        <Link className="fa-link" href={`/flights/${conversation.flightId}?tab=messages`}>Back to flight room <ChevronRight size={14} aria-hidden="true" /></Link>
        <ThreadSafety conversation={conversation} onBlocked={blocked} />
      </div></details>
    </div>
    {conversation.rideFlightId && <RideConfirmation id={id} />}
  </header>;
  return <ChatWindow path={path} result={result} heading={heading} label="Conversation messages" peer={conversation.participant.displayName} typing={connected && peerTyping ? `${conversation.participant.displayName} is typing…` : undefined} onDraft={edit} onStopTyping={stopTyping} onSent={refresh} />;
}

export function ChatStatus({connected, text, refresh}: {connected: boolean; text?: string; refresh: () => void}) {
  return <div className="fa-thread-status"><span className={connected ? 'is-live' : undefined} aria-hidden="true" />{connected ? text ?? 'Live updates on' : <>Live updates unavailable <button type="button" className="fa-text-button" onClick={refresh}>Refresh</button></>}</div>;
}

function RideConfirmation({id}: {id: string}) {
  const path = `conversations/${id}/ride-completion`;
  const result = useResource<RideCompletion>(path);
  const [response, setResponse] = useState<RideCompletion>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  useRealtime({connect: result.reload, 'conversation:updated': ({conversationId}) => { if (conversationId === id) result.reload(); }});
  const data = result.data?.confirmedByBoth ? result.data : response ?? result.data;
  if (!data?.available && !data?.confirmedByMe && !data?.confirmedByBoth) return null;
  return <div className="fa-thread-confirm">
    {data.confirmedByBoth ? <span role="status">Both travellers confirmed the ride.</span> : data.confirmedByMe ? <span role="status">Ride confirmed by you.</span> : <button type="button" className="fa-text-button" disabled={busy} onClick={() => {
      setError(undefined); setBusy(true);
      void api<RideCompletion>(path, {method: 'POST', body: {}}).then((value) => { setResponse(value); result.reload(); }, setError).finally(() => setBusy(false));
    }}>{busy ? 'Confirming…' : 'Confirm ride completed'}</button>}
    <ErrorMessage error={error} />
  </div>;
}

function ThreadSafety({conversation, onBlocked}: {conversation: Conversation; onBlocked: () => void}) {
  const [action, setAction] = useState<'report' | 'block'>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [reported, setReported] = useState(false);
  return <>
    <div className="fa-actions"><button type="button" className="fa-text-button" onClick={() => { setReason(''); setError(undefined); setAction('report'); }}>Report</button><button type="button" className="fa-text-button" onClick={() => { setError(undefined); setAction('block'); }}>Block</button>{reported && <span className="fa-badge" role="status">Report submitted</span>}</div>
    {action && <Dialog title={action === 'block' ? 'Block this traveller?' : 'Report this traveller'} onClose={() => { if (!busy) setAction(undefined); }}>
      <form className="fa-form" onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError(undefined);
        void api(`conversations/${conversation.id}/${action}`, {method: 'POST', body: action === 'block' ? {} : {reason}}).then(() => {
          setAction(undefined);
          if (action === 'block') onBlocked(); else setReported(true);
        }, setError).finally(() => setBusy(false));
      }}>
        {action === 'block' ? <p>You and this traveller will no longer see each other in flight rooms or be able to message one another.</p> : <Field label="Reason"><select required value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select a reason</option>{['Harassment or threats', 'Spam or scam', 'Inappropriate behaviour', 'Other'].map((item) => <option key={item}>{item}</option>)}</select></Field>}
        <ErrorMessage error={error} />
        <div className="fa-actions"><button type="button" className="fa-button fa-secondary" disabled={busy} onClick={() => setAction(undefined)}>Cancel</button><button type="submit" className={`fa-button ${action === 'block' ? 'fa-danger' : 'fa-primary'}`} disabled={busy}>{action === 'block' ? 'Block traveller' : 'Submit report'}</button></div>
      </form>
    </Dialog>}
  </>;
}

export function ConversationPage({id}: {id: string}) {
  const result = useResource<Conversation>(`conversations/${id}`);
  useRealtime({connect: result.reload, 'conversation:updated': (event) => { if (event.conversationId === id) result.reload(); }, 'conversations:updated': result.reload, 'flight:updated': ({flightId}) => { if (result.data?.contexts.some((context) => flightId === context.flightId || flightId === context.peerFlightId)) result.reload(); }});
  const conversation = result.data;
  return <AppShell area="messages">
    {!conversation && <Link href="/dashboard/messages" className="fa-link"><ArrowLeft size={16} aria-hidden="true" /> All messages</Link>}
    <ErrorMessage error={result.error} retry={result.reload} />
    {!conversation && !result.error && <Loading label="Opening conversation…" />}
    {conversation && <Thread key={id} conversation={conversation} refresh={result.reload} />}
  </AppShell>;
}