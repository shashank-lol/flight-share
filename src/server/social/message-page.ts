import {z} from 'zod';
import {HttpError} from '../errors';

export const MESSAGE_PAGE_SIZE = 30;
const cursorValue = z.tuple([z.iso.datetime({precision: 3}), z.uuid()]);

export function decodeMessageCursor(value: string | null) {
  if (value === null) return undefined;
  if (value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
  try {
    const [createdAt, id] = cursorValue.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return {createdAt: new Date(createdAt), id};
  } catch {
    throw invalidCursor();
  }
}

const invalidCursor = () => new HttpError(400, 'INVALID_MESSAGE_CURSOR', 'This message cursor is not valid.');
export type MessageCursor = ReturnType<typeof decodeMessageCursor>;
export const recentFirst = [{createdAt: 'desc'}, {id: 'desc'}] as const;

export function before(cursor: NonNullable<MessageCursor>) {
  return [{createdAt: {lt: cursor.createdAt}}, {createdAt: cursor.createdAt, id: {lt: cursor.id}}];
}

export function messagePage<T extends {id: string; createdAt: Date}>(rows: T[], page: number) {
  const items = rows.slice(0, MESSAGE_PAGE_SIZE);
  const last = items.at(-1);
  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null;
  return {items, page, hasMore, nextCursor};
}