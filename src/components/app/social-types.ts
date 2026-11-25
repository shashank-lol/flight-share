import type {Page} from './api';

export type ChatMessage = {id: string; clientId?: string; content: string; isOwn: boolean; createdAt: string; readAt?: string | null; displayName?: string};
export type Message = ChatMessage & {conversationId: string; clientId: string; readAt: string | null};
export type FlightGroupMessage = ChatMessage & {flightId: string; displayName: string};
export type MessagePage<T extends ChatMessage> = Page<T> & {nextCursor: string | null};
export type Conversation = {id: string; flightId: string; rideFlightId: string | null; contexts: {id: string; flightId: string; peerFlightId: string; ride: boolean}[]; participant: {id: string; displayName: string; isAnonymous: boolean}; lastMessage: Message | null; unreadCount: number; createdAt: string};
export type RideCompletion = {confirmedByMe: boolean; confirmedByBoth: boolean; available: boolean};
export type Notification = {id: string; type: 'NEW_MESSAGE' | 'NEW_PASSENGER' | 'BAGGAGE_MATCH' | string; payload: {flightId?: string; conversationId?: string}; createdAt: string; readAt: string | null};
export type Notifications = Page<Notification> & {unreadCount: number};
export type Block = {id: string; displayName: string; createdAt: string};

export function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(date);
}