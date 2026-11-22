'use client';

import {Users} from 'lucide-react';
import {useEffect} from 'react';
import {ChatStatus, ChatWindow, useChatHistory} from './messages';
import {useRealtime} from './realtime';

export function FlightChat({flightId}: {flightId: string}) {
  return <FlightChatRoom key={flightId} flightId={flightId} />;
}

function FlightChatRoom({flightId}: {flightId: string}) {
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
      <div className="fa-thread-title"><span>FLIGHT ROOM</span><h2>Group chat</h2><ChatStatus connected={connected} refresh={() => reload(true)} /></div>
    </div>
    <p className="fa-thread-audience">Everyone in this flight room can join the chat and see its history. Don’t share booking or payment details.</p>
  </header>} />;
}