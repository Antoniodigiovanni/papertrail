FROM node:22.22.1-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts eslint.config.js index.html ./
COPY client ./client
COPY server ./server
COPY tests ./tests
COPY scripts ./scripts
COPY public ./public
RUN npm run verify && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production AUTH_MODE=access HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/client ./dist/client
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
