import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {getSession} from './auth';
import {appOrigin} from './config';
import {HttpError} from './errors';
import {logger} from './log';
import {redis} from './redis';

export {HttpError};

export async function requireSession(request: Request) {
  const user = await getSession(request.headers.get('cookie'));
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'A guest session is required.');
  return user;
}

export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== appOrigin()) {
    throw new HttpError(403, 'ORIGIN_MISMATCH', 'This request must originate from Flight Share.');
  }
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Send a JSON request.');
  }
  const max = 16_384;
  if (Number(request.headers.get('content-length')) > max) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON request.');
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > max) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
  catch { throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON request.'); }
  return schema.parse(value);
}

export const rateKey = (scope: string, value: string) => `fs:rate:${scope}:${createHash('sha256').update(value).digest('hex')}`;
export const requestIp = (request: Request) => request.headers.get('x-flight-share-client-ip') ?? 'unknown';

export async function rateLimit(scope: string, value: string, max: number, seconds: number) {
  const count = await redis.eval(`local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n;`, 1, rateKey(scope, value), seconds);
  if (Number(count) > max) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
}

const noStore = {'Cache-Control': 'no-store'};
export function ok(data: unknown, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', noStore['Cache-Control']);
  return Response.json({data}, {headers: responseHeaders});
}

export async function respond(handler: () => Promise<Response>) {
  try { return await handler(); }
  catch (error) {
    if (error instanceof HttpError) return Response.json({error: {code: error.code, message: error.message}}, {status: error.status, headers: noStore});
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      // Only our declared field paths are reflected. Do not return input or custom issue details.
      const field = typeof issue?.path[0] === 'string' && /^[a-zA-Z]+$/.test(issue.path[0]) ? issue.path[0] : null;
      return Response.json({error: {code: 'INVALID_INPUT', message: field ? `Check the ${field} field and try again.` : 'Check your entries and try again.'}}, {status: 400, headers: noStore});
    }
    const requestId = randomUUID();
    logger.error({requestId, type: error instanceof Error ? error.name : 'unknown'}, 'Request failed');
    return Response.json({error: {code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId}}, {status: 500, headers: noStore});
  }
}