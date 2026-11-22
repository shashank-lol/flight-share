FROM node:24-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run db:generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS migration
COPY --from=deps --chown=node:node /app/package*.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src/domain ./src/domain
RUN npm run db:generate
USER node
ENTRYPOINT ["tini", "-g", "--"]
CMD ["npm", "run", "db:deploy"]

FROM build AS runtime-deps
RUN npm prune --omit=dev --omit=peer --no-audit --no-fund --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    BIND_HOST=0.0.0.0 \
    PORT=3000
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json /app/next.config.ts /app/server.ts ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health', {signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["tini", "-g", "--"]
CMD ["npm", "run", "start"]