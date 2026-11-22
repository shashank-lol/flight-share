import {z} from 'zod';
import {logger} from '../log';
import {redis} from '../redis';

export const EVENT_CHANNEL = 'fs:social:events:v1';
const id = z.uuid();
const user = {userId: id};
export const userEventSchema = z.discriminatedUnion('event', [
  z.object({...user, event: z.literal('conversation:updated'), payload: z.object({conversationId: id})}),
  z.object({...user, event: z.literal('conversation:typing'), payload: z.object({conversationId: id, typing: z.boolean()})}),
  z.object({...user, event: z.literal('conversations:updated'), payload: z.object({})}),
  z.object({...user, event: z.literal('notification:new'), payload: z.object({})}),
  z.object({...user, event: z.literal('flight:updated'), payload: z.object({flightId: id})}),
  z.object({...user, event: z.literal('session:revoked'), payload: z.object({sessionId: z.string().regex(/^[a-f0-9]{64}$/).optional()})}),
]);
export type UserEvent = z.output<typeof userEventSchema>;

export const groupEventSchema = z.object({event: z.literal('group:updated'), flightId: id, senderId: id});

export async function publishGroupMessage(flightId: string, senderId: string) {
  try {
    const record = groupEventSchema.parse({event: 'group:updated', flightId, senderId});
    await redis.publish(EVENT_CHANNEL, JSON.stringify(record));
  } catch {
    logger.warn('Real-time group update delivery incomplete');
  }
}

export async function publishUser(userId: string, event: string, payload: unknown) {
  // Boundary whitelist also strips any extra payload fields before publishing.
  const record = userEventSchema.parse({userId, event, payload});
  await redis.publish(EVENT_CHANNEL, JSON.stringify(record));
}

type Delivery = {userId: string; event: string; payload: unknown};
export async function publishUpdates(deliveries: Delivery[]) {
  // The database write has already committed. Delivery errors never make it look rolled back.
  const results = await Promise.allSettled(deliveries.map(({userId, event, payload}) => publishUser(userId, event, payload)));
  if (results.some((result) => result.status === 'rejected')) logger.warn('Real-time update delivery incomplete');
}