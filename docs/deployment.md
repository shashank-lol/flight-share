# Deploy Flight Share

The Dockerfile builds the app with Node.js 24 and runs the custom Next.js/Socket.IO server as a non-root user. The production image does not require Next.js standalone output. `compose.yaml` is a **local development/demo stack**, not a production configuration.

## Production topology

```text
Browser ── HTTPS / WebSocket ── nginx ── private HTTP ── Next.js + Socket.IO
                                                  ├── PostgreSQL
                                                  ├── Redis
                                                  └── AeroDataBox (optional HTTPS)
```

Start with one app instance, PostgreSQL and Redis on private networks, and TLS certificates for the app origin. Never publish the database, Redis, or the app upstream directly to the internet. Guest access requires no email service.

### Configuration

Use [.env.production.example](../.env.production.example) as a reference; supply real values through your secret manager or a private env file. Do not commit the latter or copy it into an image.

| Variable | Production value |
| --- | --- |
| `APP_ORIGIN` | The public HTTPS origin, e.g. `https://flight-share.example.com`; use this same hostname at the proxy. |
| `PORT`, `BIND_HOST` | Private app listener (defaults to `0.0.0.0:3000` in Docker; use `127.0.0.1` for host-only development). |
| `DATABASE_URL` | PostgreSQL connection URL with production credentials and TLS settings appropriate to your provider. |
| `REDIS_URL` | Authenticated Redis endpoint; use `rediss://` for TLS. |
| `FLIGHT_PROVIDER` | `manual`. Disables the mock booking flow. |
| `AERODATABOX_RAPIDAPI_KEY` or `AERODATABOX_API_KEY` | Optional server-only key for RapidAPI or AeroDataBox Direct. RapidAPI takes precedence. Enables schedule search, not PNR lookup or delay tracking. Validate quotas, coverage, and caching permissions. |
| `ALLOW_INSECURE_HTTP`, `ALLOW_DEMO_SEED` | Unset or `false`. Insecure HTTP and demo seeding are local-only. |
| `TRUST_PROXY` | `true` only behind a single trusted ingress that overwrites forwarding headers and is the only caller able to reach the upstream. |

### Deploy on a VPS with Docker Compose

Provision managed PostgreSQL and Redis with private endpoints reachable from the VPS; allow network access only from the app's host or private network. Configure the providers' TLS and CA requirements, authentication, backups and restore procedures. PostgreSQL must let the migration command create and alter the app schema. Redis serves throttling, temporary flight confirmation tokens, caching and Socket.IO coordination; avoid eviction of active rate-limit keys. Use separate instances and secrets for staging and production.

On the VPS, supply `/etc/flight-share/app.env` (or set `FLIGHT_SHARE_ENV_FILE` to its private path), build the release image, and use the [production Compose file](../compose.production.yaml) explicitly:

```sh
export FLIGHT_SHARE_IMAGE=flight-share:release
export FLIGHT_SHARE_MIGRATION_IMAGE=flight-share-migration:release
docker build -t "$FLIGHT_SHARE_IMAGE" .
docker build --target migration -t "$FLIGHT_SHARE_MIGRATION_IMAGE" .
docker compose -f compose.production.yaml run --rm migrate
docker compose -f compose.production.yaml up -d app
```

Run the migration once per release from the matching migration image before routing traffic to the new version; stop if migration fails. Back up the database before significant schema changes and plan incompatible changes in stages so the old app can run during migration. The app image does not run migrations at startup. Do not run `db:seed` in production. The Compose file fixes the private app port to `3000`; if changing it, update the mappings and nginx upstream together.

Install the [nginx reference configuration](../deploy/nginx/flight-share.conf), replace its example hostname and certificate paths, and adjust the upstream if nginx is hosted separately. Check with `nginx -t` before reloading nginx. Keep the app's `/socket.io/` path behind the same HTTPS origin and forward WebSocket upgrades. If scaling beyond a single upstream, verify transport/session affinity and Redis behavior in staging; the reference config does not configure a cluster.

### Health and operations

| Probe | Purpose |
| --- | --- |
| `GET /api/health` | Liveness: the app can respond without probing downstream services. |
| `GET /api/health?ready=1` | Readiness: PostgreSQL and Redis are reachable; treat non-2xx responses as not ready. |

Probe readiness after rollout and monitor app, data stores, and any schedule provider separately. Smoke-test joining as a guest over HTTPS, flight-room and private-chat permissions, and live delivery to a connected browser. Monitor logs and rates without recording credentials, session material or private messages. Restrict access to backups and test restoration periodically.

### CI and releases

[CI](../.github/workflows/ci.yml) runs against independent PostgreSQL and Redis services using local-only auth and mock settings. Keep deploy credentials out of pull request jobs. After CI passes on the release revision, publish a GitHub Release tagged `vX.Y.Z`. The [release workflow](../.github/workflows/release.yml) publishes matching application and migration images to GitHub Container Registry. On the VPS, set `FLIGHT_SHARE_IMAGE` and `FLIGHT_SHARE_MIGRATION_IMAGE` to the release tags or digests. Pull both images (`docker compose -f compose.production.yaml --profile release pull`), migrate and start as above, then check readiness and sign-in. The workflow does not auto-deploy to a public host. Retain both previous images and check migration compatibility before rolling back application code.

### Before public launch

- Replace the draft privacy notice, terms and community guidelines in `src/components/landing/policies.ts` with reviewed policies. Include the operator and real support and data-rights contacts, actual providers, and the service's session, reporting, retention and moderation practices.
- Assign someone to review reports and handle support and deletion requests. A report in the application is not a substitute for an operational moderation process.
- Verify that flight participation is clearly self-reported, even when the schedule comes from the provider. Ensure no mock data or credentials are exposed in production.
- Set retention for expired guest sessions and abandoned accounts, and review whether guest-only access is appropriate beyond a small pilot. Guests cannot recover access, and IP limits do not establish identity or stop all abuse.