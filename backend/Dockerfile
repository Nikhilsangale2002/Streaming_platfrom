# syntax=docker/dockerfile:1

# ---------- dependencies (with dev, for the build) ----------
FROM node:20.19-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- compile TypeScript ----------
FROM node:20.19-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- production dependencies only ----------
FROM node:20.19-alpine AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- runtime ----------
FROM node:20.19-alpine AS runtime
# tini reaps zombies and forwards SIGTERM so graceful shutdown actually runs;
# curl backs the HEALTHCHECK below.
RUN apk add --no-cache tini curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

COPY --chown=node:node --from=proddeps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY package.json ./

# The node image ships an unprivileged `node` user. Never run as root.
USER node

EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:5000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
