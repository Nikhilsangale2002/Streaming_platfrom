# Real-Time Live Streaming & Group Voice Chat Platform — Backend

A mini backend for a live-streaming / group voice chat app, built for LVS Innovation Pvt. Ltd.'s Backend Developer technical assignment. It covers authentication, room management, real-time events over Socket.IO, Redis-backed presence and room state, and LiveKit integration for the actual audio/video.

This README explains what was built and why, in the order the assignment asks for. Read it top to bottom if you're new to the project — each section stands on its own if you just need one answer.

---

## 1. Project Overview

The idea: users register, log in, create or join "rooms" (a live audio/voice session), and talk to each other over LiveKit while the backend keeps everyone's room membership, presence, and chat events in sync in real time over Socket.IO.

The backend does three jobs:

1. **REST API** — accounts, rooms, and issuing LiveKit tokens.
2. **Socket.IO server** — tells everyone in a room who joined, who left, and relays chat messages, live.
3. **LiveKit integration** — hands out the access tokens that let a client actually connect to a LiveKit room and publish/subscribe audio (and video, for the host).

Two data stores back it: **MongoDB** for anything that needs to be remembered permanently (users, rooms, history), and **Redis** for anything that's only true "right now" (who's online, who's currently in a room). Section 8 explains exactly why that split exists — it's not just "because the brief said so," there's a real reason.

---

## 2. Architecture

```
                    ┌──────────────┐
                    │    Client    │
                    └──────┬───────┘
                           │
                  HTTPS / WSS
                           │
                    ┌──────▼───────┐
                    │    Nginx     │   (production only)
                    └──────┬───────┘
                           │
                    ┌──────▼───────────┐
                    │   Node Backend   │
                    │                  │
                    │  REST API        │
                    │  Socket.IO       │
                    │  Auth            │
                    │  Room Service    │
                    │  LiveKit         │
                    └──┬─────────┬─────┘
                       │         │
              durable  │         │  realtime
                       │         │
                ┌──────▼──┐   ┌──▼──────┐
                │ MongoDB │   │  Redis  │
                └─────────┘   └────┬────┘
                                   │
                            Socket.IO Adapter
                                   │
                            ┌──────▼──────┐
                            │   LiveKit   │
                            │  RTC/Media  │
                            └─────────────┘
```

**The one rule everything else follows:** MongoDB owns *durable* truth (what's permanently true — a user exists, a room was created). Redis owns *ephemeral* truth (what's true right now — who's online, who's currently sitting in a room). The API layer computes anything "live" (like `isOnline` or `participantCount`) from Redis at the moment someone asks for it, rather than storing it twice. This sounds like a small detail, but it's the thing that keeps the whole system honest — see Section 8 for why storing it twice would actually be a bug, not just untidy.

**Folder layout** — three separate top-level pieces, each buildable/deployable on its own:

```
backend/    Node.js + TypeScript API, Socket.IO, LiveKit integration
nginx/      Reverse proxy config for production
postman/    API collection for manual testing
```

Inside `backend/src/`:

```
config/       Environment loading (Zod-validated) and constants
db/           MongoDB and Redis connection setup
models/       Mongoose schemas — User, Room, ParticipantSession
modules/      One folder per feature: auth, rooms, presence, livekit
realtime/     Socket.IO server, auth middleware, event handlers
middleware/   Cross-cutting Express middleware (auth, validation, errors, rate limiting)
utils/        Small shared helpers (error type, response shape, logger)
```

Every feature module follows the same shape: `routes → controller → service → model`. A route says *what URL maps to what function*. A controller reads the request and shapes the response — nothing more. A service holds the actual logic, especially anything that touches Redis or coordinates Redis with MongoDB. A model is just the Mongoose schema. This means you can always answer "where does X happen" by asking "is X business logic (service), or just plumbing (controller)?"

---

## 3. Technologies Used

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict mode) | Catches whole categories of bugs before they run. No `any` anywhere in the codebase. |
| Web framework | Express 5 | Simple, well-understood, huge ecosystem. |
| Realtime | Socket.IO | WebSocket with automatic fallback, room support, and a Redis adapter for scaling to multiple server instances. |
| Database | MongoDB (Mongoose) | Document model fits a "user has rooms has sessions" shape naturally; flexible schema for a fast-moving project. |
| Cache / realtime state | Redis (ioredis) | Sub-millisecond reads/writes for things that change constantly (presence, room membership) — see Section 8. |
| Media / RTC | LiveKit | Handles the actual audio/video transport (WebRTC) so we don't have to build a media server ourselves. |
| Auth | JWT + bcryptjs | Stateless auth tokens; bcryptjs avoids needing a native compiler in the Docker image. |
| Validation | Zod | Every request body/params/query is validated against a schema before it reaches any business logic. |
| Testing | Jest + Supertest + a real `socket.io-client` | Integration tests hit a real Express app and real Socket.IO connections — no mocked HTTP layer. |
| Containers | Docker + Docker Compose | One command brings up the whole stack (backend + Mongo + Redis). |
| CI | GitHub Actions | Every push runs lint → typecheck → test → build → Docker build against real Mongo/Redis containers. |

---

## 4. Setup Instructions

### Fastest path — Docker Compose

```bash
git clone https://github.com/Nikhilsangale2002/Streaming_platfrom.git
cd Streaming_platfrom
cp backend/.env.example backend/.env
# open backend/.env and fill in JWT_SECRET and the LIVEKIT_* values — see Section 5
docker compose up --build
```

That's it — backend, MongoDB, and Redis all start together, health-checked so the backend waits for its databases before accepting traffic. Once it's up:

```bash
curl http://localhost:5000/health
# {"status":"ok","uptime":12.34}
```

### Running the backend directly (for local development)

```bash
cd backend
npm install
cp .env.example .env
# fill in .env — for local dev, point MONGO_URI/REDIS_URL at localhost instead of the container names
npm run dev
```

You'll need MongoDB and Redis running somewhere reachable — the easiest way is to start just those two from Docker Compose:

```bash
docker compose up -d mongo redis
```

Since the main compose file deliberately doesn't publish Mongo/Redis's ports to your host (a security choice — see Section 10), there's a second file for exactly this situation:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo redis
```

This publishes `27017` and `6379` to `localhost` so your locally-running `npm run dev` process can reach them.

### Running the tests

```bash
cd backend
npm test              # full suite
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run build          # compile to dist/
```

All four of these are exactly what CI runs on every push (Section 11).

---

## 5. Environment Variables

All of these are validated at startup with Zod — if one's missing or malformed, the server refuses to start with a clear error message rather than failing weirdly later.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no (default `development`) | `development` \| `test` \| `production` |
| `PORT` | no (default `5000`) | |
| `MONGO_URI` | **yes** | e.g. `mongodb://mongo:27017/lvs_streaming` inside Docker, `mongodb://localhost:27017/lvs_streaming` for local dev |
| `REDIS_URL` | **yes** | e.g. `redis://redis:6379` inside Docker, `redis://localhost:6379` for local dev |
| `JWT_SECRET` | **yes** | Must be at least 32 characters. Generate one with:<br>`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_EXPIRES_IN` | no (default `1h`) | How long an access token is valid |
| `REFRESH_TOKEN_TTL_DAYS` | no (default `30`) | How long a refresh token is valid before it must be replaced by logging in again |
| `LIVEKIT_API_KEY` | **yes** | From your LiveKit Cloud project (free tier works fine) |
| `LIVEKIT_API_SECRET` | **yes** | Same place |
| `LIVEKIT_URL` | **yes** | Your project's `wss://...livekit.cloud` URL |
| `CORS_ORIGINS` | no (default `http://localhost:3000`) | Comma-separated list of allowed origins |
| `LOG_LEVEL` | no (default `info`) | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` |

A filled-in template lives at `backend/.env.example` — copy it to `backend/.env` and fill in the real values. `.env` itself is never committed (that's the whole point of having an example file).

---

## 6. API Documentation

Every response shares one shape. On success:

```json
{ "success": true, "message": "Room created", "data": { ... } }
```

On failure:

```json
{ "success": false, "code": "ROOM_NOT_FOUND", "message": "Room not found", "errors": { ... } }
```

`code` is the thing your client code should actually check (`"IDENTITY_MISMATCH"`, `"ROOM_ENDED"`, etc.) — `message` is just prose for a human, it can change wording without breaking anything.

The one exception is `GET /health`, which returns a bare `{ "status": "ok", "uptime": 12.3 }` — that's what Docker's healthcheck and any load balancer expect, not a client-facing endpoint.

A full **Postman collection** is included at `postman/Streaming-Platform/` (Postman's newer v3 YAML collection format — one file per request, easy to diff and review) — import the folder, run "Register (Host)" and "Register (Guest)" first, and everything downstream (creating a room, joining, getting a LiveKit token) is pre-wired to use the tokens/IDs those return, so you can click through the whole flow without copy-pasting anything by hand.

### Auth

| Method | Path | Auth? | Body | Notes |
|---|---|---|---|---|
| POST | `/api/auth/register` | no | `{ name, email, password, profileImage? }` | `password` min 8 chars. Returns the new user + an access token + a refresh token. |
| POST | `/api/auth/login` | no | `{ email, password }` | Returns the user + an access token + a refresh token. |
| POST | `/api/auth/refresh` | no | `{ refreshToken }` | Exchanges a valid refresh token for a new access token *and* a new refresh token (see below). |
| POST | `/api/auth/logout` | no | `{ refreshToken }` | Revokes the refresh token. Idempotent — logging out twice, or with an unknown token, is still `200`. |
| GET | `/api/users/me` | yes | — | Re-reads the user from MongoDB every call — a deleted/changed account takes effect immediately, not at token expiry. |

All four auth routes are rate-limited (20 requests / 15 minutes, tracked in Redis so it's shared correctly across multiple backend instances, not just one).

**How the refresh token works — rotating, one-time-use tokens:**

The access token from Section 5 still expires after 1 hour, same as before. What's new is a second, longer-lived token (`REFRESH_TOKEN_TTL_DAYS`, default 30 days) that lets a client get a new access token without asking the user to log in again.

- It's a random 128-character string, not a JWT — only its SHA-256 hash is ever stored in MongoDB (`RefreshTokenModel`), the same principle as `passwordHash` for actual passwords. The raw value only ever exists on the client and in transit.
- **Every use rotates it.** Calling `/api/auth/refresh` doesn't just hand back a new access token — it revokes the refresh token you sent and issues a brand new one in its place. The old one can never be used again.
- **Reuse is treated as theft.** If a refresh token that's already been rotated away gets presented again (`REFRESH_TOKEN_REUSED`), that's a strong signal someone other than the legitimate user has a copy of it — so every other live refresh token for that account is revoked too, forcing a fresh login everywhere. This is the standard "rotating refresh token" pattern precisely because a stolen-but-unused token is otherwise undetectable.
- Expired documents are removed automatically by a MongoDB TTL index — there's no cleanup job to run.

### Rooms

All room routes require `Authorization: Bearer <token>`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/rooms` | `{ name }` (3–80 chars). Creator becomes host and is auto-joined in the same request. |
| GET | `/api/rooms` | Lists live rooms, newest first. `?page=1&limit=20`. Each room includes `participantCount` but not the full participant list (see below for why). |
| GET | `/api/rooms/:id` | Full detail, including the actual `participants: [{id, name}]` array. |
| POST | `/api/rooms/:id/join` | Idempotent — joining twice is a harmless no-op, not an error. |
| POST | `/api/rooms/:id/leave` | Also idempotent. If the host leaves, the room ends for everyone. |

**Why the list endpoint doesn't include the full participant array:** fetching every participant's name for every room in a paginated list would mean a lot of extra database lookups for data you're probably not going to look at. The detail endpoint (one room at a time) does the fuller lookup since you've asked for that specific room.

### LiveKit

| Method | Path | Notes |
|---|---|---|
| POST | `/api/livekit/token` | `{ userId, roomName, role? }` — see Section 9 for the important security detail here. |
| POST | `/api/livekit/webhook` | Called by LiveKit's servers, not by a client — see Section 9. |

---

## 7. Socket Events

Connect with `io("http://localhost:5000", { auth: { token: "<your JWT>" } })`. If the token is missing or invalid, the connection is rejected before any event handler runs — authentication happens once, at the handshake.

### Client → Server

| Event | Payload | What it does |
|---|---|---|
| `room:join` | `{ roomId }` (with an ack callback) | Joins a room. Ack is `{ ok: true }` or `{ ok: false, code, message }`. |
| `room:leave` | `{ roomId }` | Leaves a room. |
| `room:message` | `{ roomId, text }` | Broadcasts a chat message — only if you're actually a member of that room. |

### Server → Client

| Event | Payload | When |
|---|---|---|
| `user:online` / `user:offline` | `{ userId }` | Broadcast to **everyone**, not just a room — presence is a platform-wide fact ("is this person online at all"), not tied to any specific room. |
| `room:participant_joined` | `{ roomId, participant: { id, name } }` | Someone joined a room you're in |
| `room:participant_left` | `{ roomId, userId }` | Someone left |
| `room:participant_count` | `{ roomId, count }` | The count changed |
| `room:status` | `{ roomId, status: "ended" }` | The room ended (host left) |
| `room:message` | `{ roomId, userId, text, sentAt }` | A chat message |
| `error` | `{ code, message }` | Something you tried wasn't allowed (e.g. sending a message to a room you haven't joined) |

**Every one of these room-related events is sent only to sockets that are actually in that room** (`io.to("room:<id>").emit(...)`) — never a blind broadcast to everyone connected. I proved this with an actual test: two separate rooms, four separate users, one message sent in room A, and the test asserts the users in room B never receive it. That test lives at `backend/tests/integration/socket.isolation.test.ts` if you want to see it directly.

**One detail worth knowing if you're building a client**: a user only counts as "left" a room when their *last* open connection to it closes — if you have the app open in two browser tabs and close one, you're still considered present.

---

## 8. Redis Implementation

**What Redis is used for here:**
- **Online/offline presence** — who's currently connected, tracked per-socket so multiple tabs work correctly.
- **Live room membership** — who's currently in which room, and the count.
- **Socket.IO scaling** — the Redis adapter lets multiple backend instances share room broadcasts, so a message from a user connected to server A correctly reaches a user connected to server B.
- **Webhook deduplication** — LiveKit can deliver the same webhook event more than once; Redis remembers which event IDs have already been handled.
- **Rate limiting** — the auth rate limiter's counters live in Redis, shared across instances.

### Why Redis, and why MongoDB alone wasn't enough

This is the specific question the assignment asks, so here's the honest answer, not just "because it's fast":

1. **Write volume.** Presence and room-membership data changes constantly — every connect, disconnect, join, and leave is a write. If that went to MongoDB, you'd be hammering disk and indexes for data that's meaningless a few seconds later. Redis keeps it all in memory, where that churn costs nothing.

2. **The data has no future.** Nobody needs to query "who was online at 3pm yesterday." Presence is only ever interesting *right now*. Storing it in a durable database implies it's worth keeping — it isn't.

3. **Atomic, race-free counting.** Two people can try to join a room at the exact same moment, possibly hitting two different backend instances. Redis's `SADD`/`SREM` (add/remove from a set) are atomic — the database itself guarantees only one of two simultaneous "remove this user" calls actually succeeds, and the other one can see that and back off cleanly. Getting that same guarantee out of MongoDB would mean locks or transactions, which are slower and more complicated for something this simple.

4. **Pub/Sub for scaling — the big one.** Socket.IO needs a way for "server A" to tell "server B" about an event, if the two users in a room happen to be connected to different backend processes. That's a message-passing problem, not a storage problem, and Redis's Pub/Sub is built exactly for it. MongoDB has no equivalent that's fast enough or simple enough for this.

5. **Different data deserves different treatment.** MongoDB answers *"who was in this room, historically"* — durable, worth indexing and querying later. Redis answers *"who's in this room right now"* — cheap, disposable, and wrong the moment it's stale anyway.

**The design choice that follows from this:** `isOnline`, `participants`, and `participantCount` are **never stored as MongoDB fields**. They live only in Redis, and the API computes them into the response at the moment you ask. If they were stored in both places, the two copies would eventually disagree (a crashed process, a missed update) — and there'd be no way to know which one was right. Keeping exactly one source of truth for each fact is what makes the whole system trustworthy.

---

## 9. LiveKit Integration

### Getting a token

```
POST /api/livekit/token
Authorization: Bearer <your JWT>

{
  "userId": "your-own-user-id",
  "roomName": "the-room-id",
  "role": "participant"
}
```

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOi...",
    "serverUrl": "wss://your-project.livekit.cloud",
    "roomName": "the-room-id"
  }
}
```

Paste `token` and `serverUrl` into any LiveKit client (their own hosted "Meet" demo works fine for testing) and it'll connect you straight into the room.

### The one important security detail

The assignment's example request includes a `userId` field in the body. **That field is never trusted on its own** — the server checks it against the identity in your verified JWT, and rejects the request (`403 IDENTITY_MISMATCH`) if they don't match. Without this check, any logged-in user could request a token *pretending to be someone else*, which would be a real security hole (anyone could impersonate anyone in a LiveKit room). Same logic for `role`: it's accepted in the request for compatibility with the documented shape, but the server always figures out the real role itself — from whether you're the room's actual host in the database — never from what the request claims.

### What each role can do

| Role | Publish audio | Publish video | Subscribe | Room admin |
|---|:---:|:---:|:---:|:---:|
| Host (broadcaster) | ✅ | ✅ | ✅ | ✅ |
| Participant (voice chat) | ✅ | ❌ | ✅ | ❌ |

Both roles can talk; only the host can also stream video and has admin rights over the room (kick/mute others, etc. — whatever LiveKit's own admin grant unlocks).

### Webhooks (bonus feature, implemented)

`POST /api/livekit/webhook` is called by LiveKit's own servers whenever something happens in a room (a participant joins, leaves, the room starts/ends) — not by a client. Two things make this safe to expose on the internet:

- **Signature verification.** Every incoming webhook is a signed JWT; a request without a valid signature is rejected with 401 before anything else happens.
- **Reconcile, don't mutate.** LiveKit can and will deliver the same event more than once, and delivery isn't guaranteed to arrive in order. So instead of "increment a counter" (which breaks if the same event arrives twice), the handler figures out what the *correct current state* should be and converges to it — calling the exact same `leave()` logic the REST and Socket.IO paths use. A duplicate delivery is recognized and dropped before it does anything twice. A late, out-of-order `participant_left` for a session the user has already left and rejoined since is also detected and discarded, rather than incorrectly kicking someone who's legitimately back in the room.

---

## 10. Docker Instructions

```bash
docker compose up --build          # backend + MongoDB + Redis, foreground
docker compose up --build -d       # same, detached
docker compose down                # stop everything
docker compose logs -f backend     # tail the backend's logs
```

**A deliberate security choice:** Mongo and Redis's ports are **not** published to your host machine in the main `docker-compose.yml` — nothing outside the Docker network needs to reach them directly, and leaving a database port open on `localhost` with no password is exactly the kind of default that gets marked down in a security review. If you need to reach them from outside Docker (e.g. running the backend locally with `npm run dev` while the databases run in containers), there's a separate opt-in file:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo redis
```

**The backend's own Dockerfile** is a multi-stage build: dependencies get installed once, TypeScript gets compiled in a build stage, and the final image only contains the compiled output plus production dependencies — no dev tools, no source `.ts` files, a much smaller image. It also runs as a non-root user and uses `tini` as its entrypoint, which matters for one specific reason: `tini` properly forwards Docker's shutdown signal to the Node process, so the app gets a chance to close its database connections cleanly instead of just being killed.

---

## 11. CI/CD Details

Every push to `main` (and every pull request) runs through GitHub Actions:

```
Install dependencies → Lint → Typecheck → Test → Build → Build Docker image
```

The test step runs against **real** MongoDB and Redis containers spun up by GitHub Actions itself (not mocked) — this matters specifically because Redis's Pub/Sub behavior (used for scaling Socket.IO) can't be faithfully tested with a mock; it has to be a real Redis server actually publishing and subscribing.

The workflow file is at `.github/workflows/ci.yml` if you want to see the exact steps.

---

## 12. Deployment Instructions

This assignment wasn't deployed to a public server — everything above (`docker compose up`) is what a grader would actually run. Here's how it *would* be deployed on a real Ubuntu server, since the assignment asks for that knowledge to be demonstrated:

1. **Server setup.** A fresh Ubuntu server, Docker + Docker Compose installed, a non-root user with `sudo` and Docker group membership (never run this as root day-to-day).
2. **Environment variables.** `backend/.env` created directly on the server (never committed, never copied over an insecure channel) — a real, unique `JWT_SECRET`, real LiveKit credentials.
3. **Nginx as a reverse proxy** in front of the backend, terminating TLS and forwarding both regular HTTP requests and WebSocket upgrade requests (`Upgrade`/`Connection` headers) to the backend container — Socket.IO needs those headers passed through correctly, or the realtime connection silently falls back to slow long-polling instead of a real WebSocket.
4. **SSL/HTTPS** via Let's Encrypt (`certbot --nginx`), auto-renewing.
5. **Process supervision.** `docker compose up -d` with `restart: unless-stopped` (already set in `docker-compose.yml`) means the containers come back up automatically after a server reboot or crash.
6. **Logs.** The app logs structured JSON (via `pino`) to stdout, which Docker captures — `docker compose logs` or a log-shipping agent (e.g. to CloudWatch/Datadog/whatever the team already uses) picks it up from there. No custom log-file handling needed.
7. **Basic monitoring.** Docker's own `HEALTHCHECK` (already in the backend's Dockerfile, hitting `/health`) is enough to know if a container is alive; a simple external uptime check against the public HTTPS URL covers "is the whole thing reachable."

---

## 13. Scalability Approach

**The question: how would this go from 100 concurrent users to 10,000+?**

- **Backend:** run multiple copies of the same backend container behind a load balancer. Because the backend keeps no important state in its own memory (everything live is in Redis, everything durable is in MongoDB), any instance can handle any request — this is what makes horizontal scaling possible without a rewrite.

- **WebSocket / Socket.IO:** this is the one place scaling isn't automatic by default — a broadcast to "everyone in room X" only reaches sockets connected to *that* server unless something bridges the servers. That's exactly what's already wired up: the `@socket.io/redis-adapter`, backed by Redis Pub/Sub, means a broadcast from server A is republished through Redis and picked up by servers B, C, D, so every socket in the room gets it regardless of which server it's connected to. This is already built in, not a future change — it's why Redis was chosen for this in the first place.

- **Redis:** a single Redis instance handles a very large number of operations before it becomes the bottleneck (Redis is fast specifically because it's in-memory). Past that point, Redis Cluster shards the keyspace across multiple nodes, and a managed service (AWS ElastiCache, Redis Cloud) handles replication and failover without needing anyone to run that infrastructure by hand.

- **MongoDB:** replica sets first (for read scaling and failover), and if write volume genuinely outgrows a single primary, sharding by a sensible key (e.g. room ID) splits the data across multiple servers. The indexes already in place (on `status`+`createdAt` for room listings, on the participant-session lookups) matter more at this scale, not less — a missing index that's invisible at 100 users becomes very visible at 10,000.

- **LiveKit:** LiveKit Cloud already handles this — it's a managed, globally-distributed media network, so scaling the actual audio/video transport isn't something this backend needs to solve at all. For a self-hosted LiveKit deployment instead, you'd run multiple LiveKit server nodes behind their own load-balancing setup (LiveKit supports this natively).

- **Load balancing:** an Nginx or cloud load balancer (AWS ALB, etc.) in front of the backend instances, with **sticky sessions** — Socket.IO's long-polling fallback needs a client's requests to land on the same server for the duration of a connection (this only matters if a client can't establish a real WebSocket and falls back; a pure WebSocket connection doesn't need stickiness, but supporting the fallback gracefully does).

- **Server infrastructure:** containers behind an auto-scaling group (or Kubernetes, if the team already runs it) that adds/removes backend instances based on load, managed database services instead of self-run ones (so replication/backups/failover aren't a 3am problem), and a CDN in front of anything static.

The short version: nothing here needs re-architecting to scale — the separation between "durable" (MongoDB) and "ephemeral, shareable-across-instances" (Redis) data is exactly the design that makes horizontal scaling possible in the first place.

---

## 14. Known Limitations

Being upfront about what this does *not* do, and why some of these were deliberate:

- **No token blacklist for access tokens.** Access tokens are still short-lived (1 hour) stateless JWTs, so one can't be revoked mid-flight the way a refresh token can — it simply expires on its own. Logging out only guarantees the *refresh* token is dead; an already-issued access token remains valid for the rest of its hour. Given the 1-hour window, this was judged an acceptable tradeoff rather than adding a Redis-backed access-token blacklist.
- **No frontend UI included in the graded scope** beyond what's needed to demonstrate the API.
- **Capacity enforcement has a narrow race window.** If many new users try to join a room at the exact moment it hits its participant cap, a small number more than the cap could theoretically get through before the count catches up. This doesn't affect the correctness guarantees the assignment actually asks about (no double-counting, no lost leaves) — it's a soft ceiling under an unusual load pattern, not a data-integrity bug.
- **Presence uses Socket.IO's own dead-connection detection** (ping/pong) rather than an additional Redis expiry layer — this was a deliberate simplification found and fixed during review: an extra expiry timer on top of Socket.IO's own keepalive was actually causing users to incorrectly show as offline while still connected.
- **No automated coverage-percentage gate.** The test suite covers every behavior called out in the assignment (room isolation, idempotent join/leave, concurrent-leave safety, webhook deduplication, the LiveKit grant matrix, etc.) with real integration tests, but there's no enforced numeric coverage threshold in CI — coverage percentage as a target wasn't the goal, testing the actual required behaviors was.
- **Rate limiting is currently applied only to `/api/auth/*`** (register/login), matching what the assignment specifically calls for; other routes rely on authentication and validation rather than their own rate limits.

---

## Time Spent

Approximately **9 hours**, spread across architecture/design, implementation, review cycles, and documentation.

---

## Repository

- **GitHub:** https://github.com/Nikhilsangale2002/Streaming_platfrom
- **API Collection:** `postman/Streaming-Platform/` (Postman v3 YAML format)
- **Full design document:** `plan.md` (architecture decisions, data model, and the reasoning behind them, written before implementation started)
