'use client';

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

  return <ChatWindow path={path} result={result} label="Flight group messages" group heading={<header className="fa-thread-header fa-group-heading">
    <div className="fa-thread-title"><h2>Group chat</h2></div>
    <div className="fa-thread-meta"><span>{members} {members === 1 ? 'traveller' : 'travellers'}</span><ChatStatus connected={connected} refresh={() => reload(true)} /></div>
  </header>} />;
}