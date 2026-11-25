import {z} from 'zod';
import {getSession, revokeSession, sessionCookie, startGuestSession} from '@/server/auth';
import {getOwnBaggage, matches} from '@/server/baggage';
import {canUseDevDelivery} from '@/server/config';
import * as flights from '@/server/flights';
import {rideCompletion} from '@/server/flyer';
import {HttpError, ok, rateLimit, readJson, requestIp, requireSameOrigin, requireSession, respond} from '@/server/http';
import {routeSocial} from '@/server/social/routes';
import {scheduleQuery, searchFlights} from '@/server/providers/schedule';
import {cabListingInput, cabRequestAction, cabRequestDirection, cabRequestInput, cabWindowQuery, changeCabRequest, closeCab, editCab, listCabRequests, listRides, publishCab, requestCab} from '@/server/rides';
import {publishUser} from '@/server/social/events';
import {baggageSchema, directorySchema, editProfileSchema, idSchema, joinFlightSchema, verifyFlightSchema} from '@/server/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request, context: {params: Promise<{path: string[]}>}) {
  return respond(async () => {
    const {path} = await context.params;
    const endpoint = path.join('/');
    const method = request.method;
    const write = method !== 'GET';
    if (write) requireSameOrigin(request);
    if (method === 'POST' && endpoint === 'auth/guest') {
      const current = await getSession(request.headers.get('cookie'));
      if (current) return ok({id: current.id});
      await rateLimit('guest_create_ip', requestIp(request), 30, 900);
      await readJson(request, z.strictObject({}));
      const result = await startGuestSession();
      return ok(result.user, {'Set-Cookie': result.cookie});
    }
    if (endpoint === 'flights/options' && method === 'GET') return ok({mockBookingEnabled: canUseDevDelivery() && process.env.FLIGHT_PROVIDER === 'mock'});

    const user = await requireSession(request);
    await rateLimit(write ? 'api_mutation' : 'api_read', user.id, write ? 100 : 300, 60);
    if (endpoint === 'auth/logout' && method === 'POST') {
      await revokeSession(user);
      await Promise.allSettled([publishUser(user.id, 'session:revoked', {sessionId: user.sessionId})]);
      return ok({signedOut: true}, {'Set-Cookie': sessionCookie()});
    }
    if (endpoint === 'profile') {
      if (method === 'GET') return ok(await flights.getProfile(user.id, new URL(request.url).searchParams.get('refresh') === 'arrivals'));
      if (method === 'PATCH') return ok(await flights.updateProfile(user.id, await readJson(request, editProfileSchema)));
      if (method === 'DELETE') {
        const result = await flights.deleteAccount(user.id);
        await Promise.allSettled([publishUser(user.id, 'session:revoked', {})]);
        return ok(result, {'Set-Cookie': sessionCookie()});
      }
    }
    if (endpoint === 'profile/baggage' && method === 'PATCH') return ok(await flights.updateBaggage(user.id, await readJson(request, baggageSchema)));
    if (endpoint === 'profile/baggage' && method === 'GET') return ok(await getOwnBaggage(idSchema.parse(new URL(request.url).searchParams.get('flightId')), user.id));
    if (endpoint === 'flights/search' && method === 'GET') {
      await rateLimit('flight_lookup', user.id, 12, 60);
      await rateLimit('flight_lookup_ip', requestIp(request), 30, 60);
      return ok(await searchFlights(scheduleQuery.parse(Object.fromEntries(new URL(request.url).searchParams))));
    }
    if (path.length === 3 && path[0] === 'conversations' && path[2] === 'ride-completion' && (method === 'GET' || method === 'POST')) {
      const contextId = idSchema.optional().parse(new URL(request.url).searchParams.get('contextId') ?? undefined);
      return ok(await rideCompletion(user.id, idSchema.parse(path[1]), method === 'POST', contextId));
    }
    if (endpoint === 'flights/verify' && method === 'POST') {
      await rateLimit('verify_flight', user.id, 20, 600);
      return ok(await flights.verifyFlight(user.id, await readJson(request, verifyFlightSchema)));
    }
    if (endpoint === 'flights/join' && method === 'POST') {
      await rateLimit('join_flight', user.id, 12, 600);
      return ok(await flights.joinFlight(user.id, await readJson(request, joinFlightSchema)));
    }
    if (path[0] === 'flights' && path[1] && idSchema.safeParse(path[1]).success) {
      const [, flightId, action] = path;
      if (path.length === 2 && method === 'GET') return ok(await flights.flightRoom(flightId, user.id));
      if (action === 'rides') {
        if (path.length === 3 && method === 'POST') return ok(await publishCab(user.id, flightId, await readJson(request, cabListingInput)));
        if (path.length === 4 && method === 'PATCH') return ok(await editCab(user.id, flightId, idSchema.parse(path[3]), await readJson(request, cabListingInput)));
        if (path.length === 4 && method === 'DELETE') return ok(await closeCab(user.id, flightId, idSchema.parse(path[3])));
        if (path.length === 5 && path[4] === 'requests' && method === 'POST') {
          await rateLimit('cab_request', user.id, 24, 60);
          return ok(await requestCab(user.id, flightId, idSchema.parse(path[3]), await readJson(request, cabRequestInput)));
        }
      }
      if (action === 'ride-requests' && path.length === 4 && method === 'PATCH') {
        const {action: decision} = await readJson(request, cabRequestAction);
        return ok(await changeCabRequest(user.id, flightId, idSchema.parse(path[3]), decision));
      }
      if (path.length === 3) {
        if (action === 'leave' && method === 'DELETE') return ok(await flights.leaveFlight(flightId, user.id));
        if (method === 'GET') {
          const query = Object.fromEntries(new URL(request.url).searchParams);
          if (action === 'passengers') return ok(await flights.listPassengers(flightId, user.id, directorySchema.parse(query)));
          if (action === 'rides' || action === 'ride-requests') {
            const page = z.coerce.number().int().min(1).max(1000).default(1).parse(query.page);
            return ok(action === 'rides' ? await listRides(user.id, flightId, page, cabWindowQuery.parse(query.window))
              : await listCabRequests(user.id, flightId, cabRequestDirection.parse(query.direction), page));
          }
          if (action === 'policy') return ok(await flights.policy(flightId, user.id));
          if (action === 'matches') return ok(await matches(flightId, user.id, z.coerce.number().int().min(1).max(1000).default(1).parse(query.page)));
        }
      }
    }
    const social = await routeSocial(method, path, request, user);
    if (social !== undefined) return ok(social);
    throw new HttpError(404, 'NOT_FOUND', 'This endpoint does not exist.');
  });
}

export {handle as GET, handle as POST, handle as PATCH, handle as DELETE};