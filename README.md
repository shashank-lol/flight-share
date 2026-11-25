# Flight Share

Flight Share lets travellers offer or request cab seats **to** their departure airport, or explore potential baggage allowance matches on their **exact flight**. Cab listings use an adjustable window around scheduled departures; a host must accept a seat request. Baggage matches have a separate flight-room section and require both travellers to agree. Each flight also has a members-only group chat. Flight Share does not book flights or rides or verify boarding passes.

## Run locally with Docker

Requires Docker with the Compose v2 plugin and a running Docker engine.

```sh
docker compose up --build -d
docker compose ps
```

Open [http://localhost:3000](http://localhost:3000). The one-shot `migrate` service applies database migrations before the app starts; its exit status should be `0`. The app is ready once its Compose health check is healthy, or when [the readiness endpoint](http://localhost:3000/api/health?ready=1) returns HTTP 200. Watch startup with `docker compose logs -f migrate app`.

Choose **Find My Flight** to go directly to search, paste-ticket import, or manual entry. No email or code is required. Submitting a search or itinerary starts a browser-bound guest session. The session lasts up to seven days; it is not recoverable after expiration, clearing cookies, or switching browsers. Only members can view a flight room; membership itself is self-reported.

### Enable live flight search with RapidAPI

1. Subscribe to AeroDataBox on RapidAPI and create a key for your application. If a key was shared publicly or in chat, rotate it first.
2. Copy `.env.example` to `.env`. In your private `.env`, set `AERODATABOX_RAPIDAPI_KEY` to the new key. Set `FLIGHT_PROVIDER=manual` to hide mock booking during live testing. Never commit `.env` or put a key in `NEXT_PUBLIC_*` configuration.
3. Apply the environment with `docker compose up -d --force-recreate app`. In **Find My Flight**, search a flight code and a known departure date (local to the departure airport). A successful live result is labelled **Published schedule**. If unavailable, confirm the subscription covers the dated flight endpoint and try manual entry.

The server calls the documented [AeroDataBox RapidAPI endpoint](https://doc.aerodatabox.com/rapidapi.html), `GET /flights/number/{flightCode}/{departureDate}`, with `dateLocalRole=Departure`. It sends no passenger information. Lookups cache successful results for one hour and empty results for five minutes. Confirm these cache durations are suitable for your plan before public operation. No PNR verification, background delay tracking, or cancellation alerts are included.

### Try the fictional India demo

Optional: populate the local database with fictional travel data. The seed is not run on startup.

```sh
docker compose --profile demo run --rm seed
```

With `FLIGHT_PROVIDER=mock` locally, enter reference **`DEMO12`** and surname **`Sharma`** to try demo booking verification. It suggests **Aanya** as the display name and returns fictional **6E203, Delhi (DEL) → Mumbai (BOM), 08:25** local time, seven days ahead by default. Searching for `6E203` on that date also offers a demo result unless a schedule or community result takes precedence. Do not enter real booking references. Manual flight details are labelled **Self-reported**; the mock result is labelled **Demo booking**, not airline-verified.

The seed adds passengers with sample baggage estimates on 6E203 and cab listings from Dwarka and Connaught Place in Delhi. The latter is on fictional **AI505, Delhi (DEL) → Bengaluru (BLR), 08:45** local time on the same date. Neither demo itinerary represents a published schedule. The cab search defaults to 20 minutes either side of your scheduled departure and can be adjusted from 0 to 60 minutes. This filters flight times, not pickup times.

To try a seat request without seeded data, join the two fictional itineraries above for the same date using separate browser profiles (or one regular and one private window). In **Share a cab**, have one traveller post seats and the other send a request. The host accepts in **Received requests**, then both can use the private chat to agree on a public pickup point, luggage space and airport arrival buffer. To try baggage matching, join the **same** flight in both browsers and enter complementary estimates in **Baggage matches**, then send and accept a request there.

Ticket import parses supported boarding-pass or itinerary text locally in the browser and can suggest a given name and multiple legs for review. It does not upload a pass, verify a booking, extract details from a photo or PDF, or send a raw PNR or surname.

Stop the services with `docker compose down`. Database and Redis data are stored in named volumes and persist across restarts. `docker compose --profile demo down --volumes` permanently removes this stack's local data.

## Develop on the host

Requires Node.js **24**, npm, PostgreSQL, and Redis. Start only the data services with `docker compose up -d db redis`, or use your own local instances. Copy `.env.example` to `.env` and update the connection URLs if needed.

```sh
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

`npm run dev` starts the custom HTTP server for Next.js and Socket.IO. Open the exact `APP_ORIGIN` you configured; `localhost` and `127.0.0.1` are different origins to a browser. If ports are taken, change `PORT` and `APP_ORIGIN` together for host development. For Compose, set `APP_PORT`, `POSTGRES_PORT`, or `REDIS_PORT` before starting, as needed, and update host-side URLs if running outside Compose.

To check the production build on the host, stop the development server, run `npm run build`, then `npm run start`. For a public deployment, follow the [deployment guide](docs/deployment.md) instead of reusing local configuration or credentials.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

Run integration and browser tests against **disposable** PostgreSQL and Redis instances. Apply migrations and start the app with `FLIGHT_PROVIDER=mock` and no live key before running `test:integration` or `test:e2e`. Both suites use `BASE_URL`, falling back to `APP_ORIGIN` or `http://localhost:3000`. GitHub Actions starts the production build against fresh service containers. Do not run these tests against a public deployment or a valuable database.

## How it fits together

- **Next.js App Router, React, and TypeScript** implement pages and JSON APIs. The custom Node.js server hosts **Socket.IO** on the same origin as the web app.
- **PostgreSQL and Prisma** persist accounts, flight rooms, membership, preferences, messages and safety actions. **Redis** supports short-lived state and realtime coordination.
- **Guest sessions** use secure session cookies on HTTPS. PostgreSQL stores only the token digest; no email is collected from guests. Sessions cannot be recovered across devices.
- **Flight lookup** checks existing room schedules and optionally queries AeroDataBox via RapidAPI. Coverage depends on the provider; lookup does not verify who booked the flight. Manual entry works without credentials. **My flights → More → Past flights** holds completed trips without removing room or chat access. Trips move there three hours after a recorded landing, or after the best available arrival estimate plus three hours. Without arrival data, a conservative departure-date cutoff is used instead. Automatic arrival checks reuse the schedule cache and are limited to a small shared daily budget.
- **Flyer points** are in-app activity, not airline miles or a trust score: 100 per distinct non-demo flight added, plus 50 per mutually self-confirmed ride (one bonus per flight). You can turn off display on cab listings you publish in Settings.
- **Baggage matching** shows a potential weight fit, not permission to combine allowances. Check the airline's policy and never accept luggage or items from strangers.
- **Health**: `GET /api/health` checks liveness; `GET /api/health?ready=1` checks database and Redis readiness.

See the [deployment guide](docs/deployment.md) for VPS/managed services, [API reference](docs/api.md) for integration contracts, and [security and privacy notes](docs/security.md) for data handling and launch limitations.