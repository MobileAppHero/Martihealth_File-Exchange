# Marti FX (secure file exchange) — single container serving the API and the built SPA
# (same shape as the Marti Event app image). Build for linux/amd64.
FROM node:22-bookworm-slim AS builder

RUN npm install -g pnpm@10
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile

RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build
RUN cd artifacts/file-exchange && BASE_PATH=/ PORT=3000 pnpm run build

# Self-contained production node_modules for the API (esbuild externalizes
# @aws-sdk/*, so runtime deps must exist on disk).
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /out

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CLIENT_DIST_DIR=/app/public \
    PORT=8080

WORKDIR /app
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /repo/artifacts/api-server/dist ./dist
COPY --from=builder /repo/artifacts/file-exchange/dist/public ./public

EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
