'use client';

import {useEffect, useEffectEvent, useState} from 'react';
import {io, type Socket} from 'socket.io-client';

type Events = {
  connect: () => void;
  disconnect: (reason: Socket.DisconnectReason) => void;
  connect_error: () => void;
  'flight:updated': (event: {flightId: string}) => void;
  'group:updated': (event: {flightId: string}) => void;
  'conversation:updated': (event: {conversationId: string}) => void;
  'conversations:updated': () => void;
  'notification:new': () => void;
  'session:revoked': () => void;
  'conversation:typing': (event: {conversationId: string; typing: boolean}) => void;
};
type ClientEvents = {
  'flight:join': (event: {flightId: string}, ack: (response: {ok: boolean}) => void) => void;
  'flight:leave': (event: {flightId: string}, ack: (response: {ok: boolean}) => void) => void;
  'conversation:presence': (event: {conversationId: string}, ack: (response: {ok: boolean; online?: boolean}) => void) => void;
  'conversation:typing': (event: {conversationId: string; typing: boolean}, ack: (response: {ok: boolean}) => void) => void;
};
let socket: Socket<Events, ClientEvents> | undefined;
let subscribers = 0;

function acquire() {
  socket ??= io({transports: ['websocket'], autoConnect: false});
  subscribers += 1;
  return socket;
}

export function requestPresence(conversationId: string, setOnline: (online: boolean | undefined) => void) {
  if (!socket?.connected) return;
  socket.timeout(5000).emit('conversation:presence', {conversationId}, (error, response) => {
    setOnline(!error && response?.ok ? response.online : undefined);
  });
}

export function sendTyping(conversationId: string, typing: boolean) {
  if (socket?.connected) socket.volatile.emit('conversation:typing', {conversationId, typing}, () => {});
}

export function useRealtime(handlers: Partial<Events>, flightId?: string) {
  const [connected, setConnected] = useState(false);
  const connect = useEffectEvent(() => handlers.connect?.());
  const flight = useEffectEvent((event: {flightId: string}) => handlers['flight:updated']?.(event));
  const group = useEffectEvent((event: {flightId: string}) => handlers['group:updated']?.(event));
  const conversation = useEffectEvent((event: {conversationId: string}) => handlers['conversation:updated']?.(event));
  const conversations = useEffectEvent(() => handlers['conversations:updated']?.());
  const notification = useEffectEvent(() => handlers['notification:new']?.());
  const revoked = useEffectEvent(() => handlers['session:revoked']?.());
  const typing = useEffectEvent((event: {conversationId: string; typing: boolean}) => handlers['conversation:typing']?.(event));
  useEffect(() => {
    const connection = acquire();
    let active = true;
    const onConnect = () => {
      if (!active) return;
      if (!flightId) { setConnected(true); connect(); return; }
      const connectedAs = connection.id;
      connection.timeout(5000).emit('flight:join', {flightId}, (error, response) => {
        if (!active || !connection.connected || connection.id !== connectedAs) return;
        setConnected(!error && !!response?.ok);
        // Recover anything sent before the join acknowledgement via REST.
        connect();
      });
    };
    const onConnectionError = () => { setConnected(false); };
    const onDisconnect = (reason: Socket.DisconnectReason) => { setConnected(false); if (reason === 'io server disconnect') revoked(); };
    connection.on('connect', onConnect).on('disconnect', onDisconnect).on('connect_error', onConnectionError)
      .on('flight:updated', flight).on('group:updated', group).on('conversation:updated', conversation).on('conversations:updated', conversations)
      .on('notification:new', notification).on('session:revoked', revoked).on('conversation:typing', typing);
    if (connection.connected) queueMicrotask(onConnect);
    else connection.connect();
    return () => {
      active = false;
      if (flightId && connection.connected) connection.emit('flight:leave', {flightId}, () => {});
      connection.off('connect', onConnect).off('disconnect', onDisconnect).off('connect_error', onConnectionError)
        .off('flight:updated', flight).off('group:updated', group).off('conversation:updated', conversation).off('conversations:updated', conversations)
        .off('notification:new', notification).off('session:revoked', revoked).off('conversation:typing', typing);
      subscribers -= 1;
      if (!subscribers) { connection.disconnect(); socket = undefined; }
    };
  }, [flightId]);
  return connected;
}