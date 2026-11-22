import {createServer} from 'node:http';
import {loadEnvConfig} from '@next/env';
import next from 'next';

async function start() {
  const dev = process.env.NODE_ENV !== 'production';
  loadEnvConfig(process.cwd(), dev);
  const {validateRuntimeConfig, secureCookies} = await import('./src/server/config');
  validateRuntimeConfig();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid PORT');
  const hostname = process.env.BIND_HOST || '0.0.0.0';
  const [{prisma}, {redis}, {logger}, {startGateway, clientIp, CLIENT_IP_HEADER}] = await Promise.all([
    import('./src/server/db'), import('./src/server/redis'), import('./src/server/log'), import('./src/server/social/gateway'),
  ]);
  const app = next({dev, port, hostname});
  const handle = app.getRequestHandler();
  const http = createServer({headersTimeout: 15_000, requestTimeout: 30_000, keepAliveTimeout: 65_000}, (req, res) => {
    req.headers[CLIENT_IP_HEADER] = clientIp(req);
    if (secureCookies()) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    void handle(req, res).catch(() => {
      logger.error('Next.js request handler failed');
      if (res.headersSent) return res.destroy();
      res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}).end('An unexpected error occurred.');
    });
  });

  let stopGateway: (() => Promise<void>) | undefined;
  let stopping = false;
  async function shutdown(exitCode: number) {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 10_000).unref();
    try {
      if (stopGateway) await stopGateway(); // Socket.IO closes the shared HTTP listener and active sockets.
      else if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
      await app.close();
      await prisma.$disconnect();
    } catch {
      exitCode = 1;
      logger.error('Server did not shut down cleanly');
    } finally {
      redis.disconnect();
      clearTimeout(timer);
    }
    process.exit(exitCode);
  }

  try {
    await app.prepare();
    stopGateway = await startGateway(http);
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, hostname, () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    logger.error({type: error instanceof Error ? error.name : 'unknown'}, 'Server startup failed');
    await shutdown(1);
    return;
  }

  http.on('error', () => { logger.error('HTTP server failed'); void shutdown(1); });
  process.on('SIGINT', () => { void shutdown(0); });
  process.on('SIGTERM', () => { void shutdown(0); });
  logger.info({bindHost: hostname, port}, 'Flight Share ready');
}

void start().catch((error: unknown) => {
  // Explicit configuration errors have no secret values; other bootstrap errors are not serialized.
  console.error('Flight Share could not start:', error instanceof Error ? error.name : 'Unknown error');
  process.exitCode = 1;
});