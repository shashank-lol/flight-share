import Redis from 'ioredis';
import {logger} from './log';

const shared = globalThis as typeof globalThis & { flightShareRedis?: Redis };

function createRedis() {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2500, commandTimeout: 3000,
  });
  client.on('error', () => logger.warn({component: 'redis'}, 'Redis connection error'));
  return client;
}

export const redis = shared.flightShareRedis ??= createRedis();