import {prisma} from '@/server/db';
import {redis} from '@/server/redis';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = {'Cache-Control': 'no-store'};
  if (!new URL(request.url).searchParams.has('ready')) return Response.json({status: 'ok'}, {headers});
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1 FROM "Flight" LIMIT 1`, redis.ping()]);
    return Response.json({status: 'ready'}, {headers});
  } catch {
    return Response.json({status: 'not_ready'}, {headers, status: 503});
  }
}