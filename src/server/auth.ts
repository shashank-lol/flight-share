import {createHash, randomBytes} from 'node:crypto';
import {secureCookies} from './config';
import {prisma} from './db';
import {audit} from './log';

export const SESSION_COOKIE = 'flight_share_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function startGuestSession() {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  const user = await prisma.user.create({data: {sessions: {create: {id: hash(raw), expiresAt}}}, select: {id: true}});
  audit('guest_started', user.id);
  return {user, cookie: sessionCookie(raw, SESSION_SECONDS)};
}

export function sessionCookie(value = '', maxAge = 0) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies() ? '; Secure' : ''}`;
}

export async function getSession(cookieHeader: string | null | undefined) {
  const cookie = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return null;
  const sessionId = hash(cookie);
  const session = await prisma.session.findUnique({where: {id: sessionId}, select: {expiresAt: true, userId: true}});
  return session && session.expiresAt.getTime() > Date.now() ? {id: session.userId, sessionId} : null;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function revokeSession(user: SessionUser) {
  await prisma.session.deleteMany({where: {id: user.sessionId}});
  audit('signed_out', user.id);
}