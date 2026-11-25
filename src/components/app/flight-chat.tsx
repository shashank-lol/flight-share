'use client';

import {Info, Users} from 'lucide-react';
import {useEffect} from 'react';
import {ChatStatus, ChatWindow, useChatHistory} from './messages';
import {useRealtime} from './realtime';

export function FlightChat({flightId, members}: {flightId: string; members: number}) {
  return <FlightChatRoom key={flightId} flightId={flightId} members={members} />;
}

function FlightChatRoom({flightId, members}: {flightId: string; members: number}) {
  const path = `flights/${flightId}/group-messages`;
  const result = useChatHistory(path);
  const {reload} = result;
  const connected = useRealtime({
    connect: () => reload(true),
    'group:updated': (event) => { if (event.flightId === flightId) reload(); },
    'flight:updated': (event) => { if (event.flightId === flightId) reload(true); },
    'conversations:updated': () => reload(true),
  }, flightId);

  useEffect(() => {
    // Recover missed delivery (including a gateway or Redis outage) and recheck the room's visibility.
    const refresh = () => { if (!document.hidden) reload(true); };
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 45_000);
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, [reload]);

  return <ChatWindow path={path} result={result} label="Flight group messages" group heading={<header className="fa-thread-header">
    <div className="fa-thread-heading-main">
      <span className="fa-avatar"><Users size={21} aria-hidden="true" /></span>
      <div className="fa-thread-title"><h2>Group chat</h2><div className="fa-thread-meta"><span>{members} {members === 1 ? 'traveller' : 'travellers'}</span><ChatStatus connected={connected} refresh={() => reload(true)} /></div></div>
      <details className="fa-thread-safety"><summary className="fa-icon-button" aria-label="About this group chat" title="About this group chat"><Info size={20} aria-hidden="true" /></summary><div className="fa-thread-safety-panel"><p>Everyone in this group can join the chat and see its history. Don’t share booking or payment details.</p></div></details>
    </div>
  </header>} />;
}