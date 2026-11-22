import pino from 'pino';

export const logger = pino({level: process.env.LOG_LEVEL ?? 'info'});

export function audit(action: string, userId?: string) {
  logger.info({event: 'audit', action, userId}, 'Security audit event');
}