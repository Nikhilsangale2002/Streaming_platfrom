# Implementation Plan — Real-Time Live Streaming & Group Voice Chat Platform

**Assignment:** LVS Innovation Pvt. Ltd. — Backend Developer Technical Assignment
**Candidate:** Nikhil Sangale
**Repository:** https://github.com/Nikhilsangale2002/Streaming_platfrom
**Status:** Planning complete, revised after architecture review — implementation not started

---

## 1. The rubric is the specification

Effort is allocated against weight, not against interest.

| Area | Weight | Where it is earned |
|---|---:|---|
| Backend Architecture & Code Quality | 15% | Layered modules, typed boundaries, no god files |
| WebSocket / Socket.IO | 15% | JWT-authed sockets, room-scoped broadcast, Redis adapter |
| LiveKit / RTC Integration | 15% | Token API with real host/participant grants, webhooks |
| Node.js / TypeScript | 10% | `strict: true`, zero `any`, typed event contracts |
| REST API & Security | 10% | Zod validation, helmet, rate limiting, correct status codes |
| MongoDB | 10% | Schema design, validation, **indexes**, error handling |
| Redis | 10% | Presence + room state + pub/sub, and the written justification |
| Docker / Server Deployment | 5% | Dockerfile, compose, nginx, Ubuntu/SSL guide |
| CI/CD | 5% | install → lint → build → test → docker build |
| Documentation | 5% | All 14 required README sections |

Three observations drive everything below.

**Socket.IO and LiveKit together outweigh architecture.** 30% of the grade sits in two features that are easy to fake and obvious when faked. Neither may be a stub.

**The Redis section is a graded essay.** §5 asks in bold: *why was MongoDB alone not sufficient?* The strongest answer is not prose — it is a schema where Redis genuinely owns something MongoDB cannot.

**No frontend is graded, but recording item #8 is "LiveKit Room Connection."** That cannot be shown from Postman. The client exists to make the 30% in Socket.IO and LiveKit observable rather than described.

---

## 2. Architecture

```
                           CLIENT
                              │
                     HTTPS / WebSocket
                              │
                              ▼
                       ┌─────────────┐
                       │    Nginx    │
                       └──────┬──────┘
                              │
                  ┌───────────▼───────────┐
                  │ Node.js / TypeScript  │
                  │                       │
                  │ ┌───────────────────┐ │
                  │ │ Auth              │ │
                  │ │ Users             │ │
                  │ │ Rooms             │ │
                  │ │ Presence          │ │
                  │ │ LiveKit           │ │
                  │ └───────────────────┘ │
                  │                       │
                  │ Socket.IO             │
                  └──────┬─────────┬──────┘
                         │         │
                ┌────────▼───┐ ┌──▼────────────┐
                │ MongoDB    │ │ Redis         │
                │            │ │               │
                │ Users      │ │ Presence      │
                │ Rooms      │ │ Participants  │
                │ Sessions   │ │ Pub/Sub       │
                └────────────┘ │ Socket Adapter│
                               └───────┬───────┘
                                       │
                                       ▼
                               ┌──────────────┐
                               │   LiveKit    │
                               │              │
                               │ Token / Auth │
                               │ RTC Media    │
                               │ Webhooks     │
                               └──────────────┘
```

### Ownership — the rule every other decision follows

| Concern | Owner |
|---|---|
| Durable truth | MongoDB |
| Ephemeral truth | Redis |
| Application events | Socket.IO |
| Media / RTC | LiveKit |
| Identity | JWT |
| Boundary validation | Zod |
| Persistence validation | Mongoose |
| Business rules | Service layer |

Nothing is stored in two places. Where the API must expose live state (`isOnline`, `participants`, `participantCount`), it is **computed into the response DTO at read time**, never persisted alongside its Redis original.

---

## 3. Decisions on record

| Decision | Choice | Reasoning |
|---|---|---|
| LiveKit hosting | Cloud free tier primary; self-hosted compose profile secondary | Cloud gives a real `serverUrl` and reliable webhooks so the recording cannot fail live. The self-hosted profile captures the brief's "strong advantage" bonus |
| Deployment | `docker compose up` runs the whole stack; no live public server | §11 is 5% and says "where applicable" |
| Frontend | Next.js 15 App Router — a **reference client**, not a second project | Graded 0%. Exists to make the graded real-time work visible |
| Testing | 100% coverage thresholds on business logic | Enforced in CI; bootstrap excluded, see §9 |
| Web server | Express 5 | Current major |
| Injection defence | Zod at the HTTP/socket boundary **and** Mongoose schema validation | They guard different boundaries; Zod does not replace persistence validation. One README line, no essay about an unused library |
| Auth tokens | Single JWT, **1 hour** expiry | Refresh rotation is not in the brief and was cut. A 7-day token was the wrong way to buy that simplicity; short expiry plus a documented production path is the honest one |
| Password field | `passwordHash`, not `password` | The name should state what it holds |
| Errors | `AppError(code, message, status)` with a stable machine-readable code | Clients branch on `ROOM_NOT_FOUND`, never on prose |
| Roles | `host` and `participant` only | The brief names two. No invented third role |
| Persistence layer | Controller → Service → Mongoose model | No repository/DAO layer at this size |
| Build order | Docker and CI at phases 1–2, not last | A broken container found at hour 8 is a crisis; at hour 1 it is a task |

### Two caches deliberately not built

**`users.isOnline` is not a column.** Persisting it creates the exact drift this design exists to avoid: MongoDB says `true`, Redis has no key, and nothing arbitrates. MongoDB keeps `lastSeenAt` — a historical fact written once on disconnect. `isOnline` is computed from Redis into the DTO.

**`room:{roomId}:meta` is not a Redis key.** Room `status` and `host` are MongoDB's. Caching them in Redis would be a second copy whose only benefit is saving one indexed `_id` read on socket join — a low-frequency operation compared to messaging. It would be added back only if profiling showed join latency mattering, as a short-TTL cache invalidated on status change. Recorded here so its absence reads as a decision.

### Scope and time reporting

Required scope realistically lands near 11 hours; the optional client and 100% coverage add roughly 4.5 more. The brief caps *actual working time* at 8 hours, so the README reports the split honestly rather than one misleading number:

> Time spent: approximately N hours on the required scope (§2–§14), plus approximately M hours on an optional reference client and 100% test coverage — both outside the graded requirements, built so the real-time and LiveKit behaviour is observable rather than merely described.

§10 records actual hours per phase. The README figure comes from that log, not from this estimate.

---

## 4. Repository layout

Backend, frontend and nginx are separate top-level folders — a reviewer should see the shape of the system from the repository root without opening anything. They are independent packages rather than npm workspaces, because workspace hoisting complicates Docker build contexts for no benefit at this size.

Services live inside their domain module; there is no top-level `services/` grab bag.

```
Streaming_platfrom/
├── backend/
│   ├── src/
│   │   ├── config/               # env.ts (Zod-validated), constants.ts
│   │   ├── db/                   # mongoose.ts, redis.ts
│   │   ├── models/               # user, room, participantSession
│   │   ├── middleware/           # auth · validate · errorHandler
│   │   │                         # rateLimit · requestId · notFound
│   │   ├── modules/
│   │   │   ├── auth/             # routes controller service schema
│   │   │   ├── users/
│   │   │   ├── rooms/            # + room.state.service.ts
│   │   │   ├── presence/         # presence.service.ts
│   │   │   └── livekit/          # token service + webhook receiver
│   │   ├── realtime/             # io.ts · socket.auth.ts · socket.guards.ts
│   │   │                         # handlers/ · events.ts
│   │   ├── utils/                # AppError, ApiResponse, logger, asyncHandler
│   │   ├── app.ts                # express app, no listen() — importable by tests
│   │   └── server.ts             # http server + io + graceful shutdown
│   ├── tests/                    # unit/ integration/ helpers/
│   ├── .env.example
│   └── Dockerfile
│
├── frontend/                     # Next.js 15 App Router — reference client
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── Dockerfile
│
├── nginx/
│   ├── default.conf              # dev reverse proxy
│   ├── default.prod.conf         # + TLS, HSTS, rate limit zones
│   └── Dockerfile
│
├── livekit/
│   └── livekit.yaml              # self-hosted LiveKit config
│
├── scripts/seed.ts
├── docker-compose.yml            # backend + frontend + mongo + redis
├── docker-compose.livekit.yml    # profile: self-hosted LiveKit
├── docker-compose.prod.yml       # profile: nginx front door
├── .github/workflows/ci.yml
├── postman/
├── docs/                         # ARCHITECTURE.md DEPLOYMENT.md SCALABILITY.md
├── plan.md
├── CLAUDE.md
└── README.md
```

### Middleware is a first-class layer

`backend/src/middleware/` carries the cross-cutting concerns, each in its own file with a single responsibility, composed once in `app.ts` in a fixed order:

| File | Responsibility |
|---|---|
| `requestId.middleware.ts` | Attach a correlation ID to every request and to the logger child |
| `validate.middleware.ts` | `validate(schema)` — Zod-parses body, params and query; replaces them with the parsed values |
| `auth.middleware.ts` | Verify JWT, load the user, attach `req.user`; `requireAuth` guard |
| `rateLimit.middleware.ts` | Redis-backed limiter, strict variant for auth routes |
| `errorHandler.middleware.ts` | The only place an error response is formatted; translates Mongoose 11000/cast/validation into `AppError` |
| `notFound.middleware.ts` | Terminal 404 for unmatched routes |

Order in `app.ts`: `requestId → helmet → cors → json → rateLimit → routes → notFound → errorHandler`. The error handler is registered last because Express resolves error middleware by position.

---

## 5. Data model — MongoDB owns durable truth

**users**

| Field | Type | Notes |
|---|---|---|
| name | string | required, 2–60 chars |
| email | string | required, lowercase, **unique index** |
| passwordHash | string | bcrypt cost 12, `select: false` |
| profileImage | string? | optional URL |
| lastSeenAt | Date | written on disconnect |

No `isOnline`. It is computed from Redis into the DTO.

**rooms**

| Field | Type | Notes |
|---|---|---|
| name | string | required, 3–80 chars |
| host | ObjectId → users | **indexed** |
| status | enum | `live` \| `ended` |
| maxParticipants | number | default 50 |
| createdAt / endedAt | Date | |

Compound index `{ status: 1, createdAt: -1 }` serves `GET /rooms` — active rooms, newest first — as a covered sort.

**participantsessions** — the room history collection suggested by §6

| Field | Type | Notes |
|---|---|---|
| roomId | ObjectId → rooms | |
| userId | ObjectId → users | |
| role | enum | `host` \| `participant` |
| active | boolean | true only while the session is open |
| joinedAt / leftAt | Date | |
| durationSec | number | computed on close |

```ts
schema.index(
  { roomId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
schema.index({ userId: 1, joinedAt: -1 });
```

The partial unique index enforces **at most one open session per user per room** at the database level, so a network retry or a duplicated webhook cannot create a second one. `active: true` is used rather than `leftAt: null` because equality-on-null in a `partialFilterExpression` conflates a null value with a missing field; boolean equality is unambiguous. Closed sessions leave the index, so unlimited history per user per room is still allowed.

### Why `participants` and `participantCount` are not columns

§3 requires a room to expose `participants` and `participantCount`. Storing them in MongoDB as well as Redis would create two sources of truth for one fact, and they would drift the first time a process died between the two writes.

They are therefore **response DTO fields hydrated from Redis at read time**. MongoDB holds the durable audit trail in `participantsessions`; Redis holds live membership. The API contract is exactly what the brief asks for; the storage underneath is honest about which store owns what.

This is the Redis justification argued through the schema rather than in prose, and it is the clearest thing to point at during the recording.

### Room state machine

```
        CREATE
          │
          ▼
        LIVE ──── host leaves / all participants leave ────▶ ENDED
          │                                                    │
          └── join / leave / message ──▶ LIVE                   ✗ terminal
```

| From | To | Allowed |
|---|---|:--:|
| — | live | ✓ on create |
| live | live | ✓ join, leave, message |
| live | ended | ✓ host leaves, or explicit end |
| ended | anything | ✗ |

`ended` is terminal. The service enforces transitions; a join or leave against an ended room returns `409 ROOM_ENDED` rather than silently mutating state. Declaring the machine explicitly removes a whole class of accidental behaviour.

MongoDB duplicate-key (11000), cast and validation errors are translated centrally into `AppError`. Raw driver errors never reach a client.

---

## 6. Redis — ephemeral truth, and the graded justification

| Key | Type | Purpose |
|---|---|---|
| `presence:online` | SET | all online user IDs |
| `presence:user:{userId}` | STRING, TTL 60s | heartbeat; self-healing liveness |
| `presence:user:{userId}:sockets` | SET | multi-tab correctness — offline only when empty |
| `room:{roomId}:participants` | SET | live membership; `SCARD` is the count |
| `livekit:webhook:{eventId}` | STRING, TTL 24h | webhook deduplication |
| `socket.io#*` | pub/sub | `@socket.io/redis-adapter` fan-out |
| `rl:{ip}:{route}` | STRING | rate limiting shared across instances |

The adapter needs two connections — a publisher and a duplicated subscriber — because a client in subscribe mode cannot issue other commands.

### Why Redis, and why MongoDB alone was not sufficient

Goes into README §Redis Implementation.

1. **Write amplification.** Presence heartbeats every 30 seconds × N users is a continuous write stream for data worthless after a minute. In MongoDB that churns disk, indexes and the oplog for zero durable value.

2. **Expiry semantics.** Redis expires keys natively, so a client that dies without a disconnect event self-heals. MongoDB's TTL monitor sweeps roughly once per minute and cannot express per-key liveness.

3. **Atomicity and latency.** `SADD`/`SREM`/`SCARD` are O(1) in memory and sub-millisecond, and their return values are themselves the concurrency primitive (§8). Participant counts must stay correct when concurrent joins reach *different* API instances; a read-modify-write against MongoDB races.

4. **Pub/Sub fan-out — the decisive one.** Horizontally scaled Socket.IO *requires* a broker so a broadcast on instance A reaches sockets held by instance B. MongoDB change streams are not a message bus: no room-scoped routing, higher latency, and a cost model that punishes fan-out.

5. **Correct separation of concerns.** MongoDB answers *who was in this room last Tuesday* — durable, queryable, auditable. Redis answers *who is in this room right now* — volatile, high-churn, disposable.

---

## 7. API surface

One response envelope everywhere: `{ success, message, data }`, or `{ success: false, code, message, errors? }`.

| Method | Path | Auth | Notes |
|---|---|:--:|---|
| POST | `/api/auth/register` | — | 201; returns user + token |
| POST | `/api/auth/login` | — | 200; rate limited |
| GET | `/api/users/me` | ✓ | includes `isOnline` computed from Redis |
| POST | `/api/rooms` | ✓ | creator becomes host; 201 |
| GET | `/api/rooms` | ✓ | active rooms, paginated |
| GET | `/api/rooms/:id` | ✓ | details + live participants from Redis |
| POST | `/api/rooms/:id/join` | ✓ | idempotent; 409 if full or ended |
| POST | `/api/rooms/:id/leave` | ✓ | idempotent; host leaving ends the room |
| POST | `/api/livekit/token` | ✓ | grants by role |
| POST | `/api/livekit/webhook` | sig | LiveKit signature verified, not JWT |
| GET | `/health` | — | liveness for Docker and load balancer |

### The identity-spoofing detail

The brief's example `POST /livekit/token` body carries `userId`. Accepting a caller-supplied identity would let any authenticated user mint a token impersonating anyone else — privilege escalation straight into the RTC layer.

The endpoint accepts the documented body shape for compatibility, but derives participant identity from the **verified JWT**, and returns `403 IDENTITY_MISMATCH` when a supplied `userId` disagrees. Role is likewise derived from the room record — the caller is host if and only if `room.host` matches — never read from the request.

### LiveKit grants

The product is live streaming *and* group voice chat, so the two roles map onto the two modes:

| Role | canPublish | canSubscribe | canPublishData | roomAdmin |
|---|:--:|:--:|:--:|:--:|
| host — broadcaster | audio + video | ✓ | ✓ | ✓ |
| participant — voice chat | audio only | ✓ | ✓ | ✗ |

### Webhooks reconcile, they do not mutate

Webhook delivery is at-least-once, unordered, and occasionally late. The handler is built accordingly:

- **Deduplicated.** The event `id` is claimed with `SET livekit:webhook:{id} 1 NX EX 86400`. A repeat is acknowledged and dropped.
- **Reconciling.** The handler computes desired state and converges toward it. It never blindly increments or decrements a counter — a triple-delivered `participant_left` must not drive the count negative. Idempotency is a property of the state transition, not of the delivery.
- **Order-tolerant.** Events carrying a `createdAt` older than the current session's last transition are discarded.
- **Non-blocking.** It verifies the signature, claims the id, returns 200, and does the reconciliation work off the request path. A slow handler causes LiveKit to retry, which is the opposite of helpful.
- **Not the only source of truth.** Everything still works with webhooks delayed or entirely unavailable; they correct drift, they do not drive the system.

This covers the §7 bonus.

---

## 8. Socket.IO

**Client → Server:** `room:join`, `room:leave`, `room:message`, `presence:ping`

**Server → Client:** `user:online`, `user:offline`, `room:participant_joined`, `room:participant_left`, `room:participant_count`, `room:status`, `room:message`, `error`

Payloads are declared once in `realtime/events.ts` and used to parameterise `Server<ClientToServer, ServerToClient>`, so the compiler enforces the contract on both ends and the web client imports the same types.

### Authentication and authorization are separate

`io.use()` answers **who are you** — verify the JWT from `socket.handshake.auth.token`, reject unauthenticated sockets before any handler runs.

A per-event guard answers **are you allowed to do this** — for `room:join`: does the room exist, is it `live`, is it under `maxParticipants`, is this user permitted. Conflating the two is how an authenticated user ends up in a room they should never reach.

Every emit is scoped to `room:{roomId}` or `user:{userId}`. A bare `io.emit()` is a bug — §4 requires broadcast to relevant users and rooms only.

### One transition, four callers

Closing a browser tab is **not** `POST /rooms/:id/leave` — it is a socket disconnect. All four entry points converge on one function:

```ts
roomState.leave({
  roomId,
  userId,
  reason: "rest" | "socket" | "disconnect" | "livekit",
})
```

The caller does not care how the user left; the service does not care who called it. `reason` exists for logging and metrics, not for branching.

The transition, in order: idempotency check → Redis `SREM` → close the `ParticipantSession` → recompute count → evaluate room status → emit events.

### Concurrency: the set operation is the lock

A REST leave and a socket disconnect can land on two different API instances within the same millisecond. The guard is the return value of the Redis write, which is atomic by definition:

```ts
const removed = await redis.srem(`room:${roomId}:participants`, userId);
if (removed === 0) return currentState;   // another caller already owns this transition
// exactly one caller proceeds: close the session, recompute, emit
```

`SREM` returns 1 if it removed the member and 0 if it was not there, so exactly one concurrent caller passes. Join is the mirror image using `SADD`. The `ParticipantSession` is closed once because only one caller reaches the close, and the partial unique index (§5) is the backstop if that reasoning is ever wrong.

No Lua script, no distributed lock, no cross-store transaction — the arbiter is a round trip that was happening anyway. Attempting a real distributed transaction between Redis and MongoDB here would add far more failure modes than it removes.

Multi-tab follows the same rule: a user leaves a room when their last socket for that room closes, which is why `presence:user:{id}:sockets` exists.

---

## 9. Phases

Tests are written alongside each module. Every phase ends green and ends in a commit.

### Required scope

| # | Phase | Est. | Done when |
|---:|---|---:|---|
| 0 | Scaffold: git, TS strict, ESLint/Prettier, Jest, `/health` skeleton | 0:30 | `lint && typecheck && build` clean |
| 1 | **Docker first**: multi-stage Dockerfile (non-root, tini), compose with mongo + redis, healthchecks, `depends_on: service_healthy` | 0:45 | `docker compose up` serves `/health` |
| 2 | **CI first**: Actions — install, lint, typecheck, test, build, docker build; mongo:7 + redis:7 service containers | 0:30 | Green on first push |
| 3 | Config (Zod env), pino + request IDs, `AppError`/`ApiResponse`, error middleware, graceful shutdown, DB connections | 0:45 | SIGTERM drains cleanly |
| 4 | Models, indexes, partial unique index | 0:30 | Indexes asserted in tests |
| 5 | Auth module | 1:00 | register/login/me, bcrypt, JWT middleware |
| 6 | Rooms module + state machine | 1:00 | CRUD, transitions enforced, 403/404/409 paths |
| 7 | Presence + room state services | 0:45 | TTL heartbeats, atomic transitions, multi-tab safe |
| 8 | Socket.IO | 1:15 | Authn + authz split, typed events, adapter, one leave path |
| 9 | LiveKit token + reconciling webhooks | 1:15 | Grant matrix, signature verified, deduplicated |
| 10 | nginx prod profile, self-hosted LiveKit profile, deployment docs | 0:45 | Proxy runs; Ubuntu/SSL/logs/monitoring guide written |
| 11 | README (14 sections), Postman collection, seed script | 1:00 | Every required section present |
| 12 | **Clean-clone rehearsal** | 0:20 | Fresh dir → `.env` → `docker compose up` → works |
| 13 | Recording script and rehearsal | 0:40 | All 10 demo steps timed under 10 min |
| | **Required subtotal** | **~11:00** | |

### Beyond the brief

| # | Phase | Est. | Done when |
|---:|---|---:|---|
| 14 | Coverage to 100% thresholds | 1:30 | CI fails below threshold |
| 15 | Next.js reference client | 3:00 | Auth → rooms → join → sockets → LiveKit → leave |
| 16 | Clean-clone rehearsal #2, full stack | 0:20 | Web + API + Mongo + Redis from one command |
| | **Optional subtotal** | **~4:50** | |

**Estimated total ≈ 15:50.** Phases 0–13 are self-contained: if work stopped there, every graded requirement would be complete and demonstrable.

### Client non-goals

The client is a reference implementation of the backend's flow, not a second project. It covers auth → room list → join → live participants over Socket.IO → LiveKit audio → leave. It does **not** get profile editing, avatar upload, settings, a landing page, or a dark-mode toggle.

### Test plan

Coverage thresholds of 100% apply to `modules`, `realtime`, `middleware`, `utils`. Excluded via `coveragePathIgnorePatterns`: `server.ts`, `config/env.ts`, `db/*`, type-only files — chasing a percentage through bootstrap produces tests that assert nothing.

What must be covered regardless of the number:

| Area | Cases |
|---|---|
| Auth | register · duplicate email · login · wrong password · protected endpoint · expired JWT · malformed JWT |
| Rooms | create · get · join · **duplicate join** · leave · **duplicate leave** · full room · ended room · non-host access · illegal state transition |
| Socket | authenticated connect · unauthenticated reject · join · leave · disconnect · **multi-tab** · **room isolation** |
| Presence | TTL expiry · multi-tab last-socket-wins · participant set · participant count |
| LiveKit | host grant · participant grant · invalid room · invalid user · **userId mismatch → 403** |
| Webhooks | **duplicate event dropped** · out-of-order event discarded · unknown room tolerated · bad signature rejected |
| Concurrency | simultaneous REST leave + disconnect closes exactly one session |

**The room-isolation test is the single most valuable one.** Room A holds users 1 and 2, room B holds users 3 and 4; user 1 emits `room:message`; user 2 receives it and users 3 and 4 provably do not. That is direct evidence for the brief's requirement that events reach only relevant users and rooms, so it is both an integration test and a scripted moment in the recording.

Socket tests bind an ephemeral port and drive a real `socket.io-client`, awaiting events through promise helpers. No `setTimeout` sleeps — that is how socket suites become flaky.

---

## 10. Time log

Actuals recorded as work proceeds. The README figure comes from this table.

| Phase | Estimated | Actual | Notes |
|---|---:|---:|---|
| 0–16 | 15:50 | — | Not started |

---

## 11. Submission checklist

- [ ] GitHub repo pushed with incremental, conventional commit history
- [ ] README with all 14 required sections
- [ ] Redis justification (§6) written out in full
- [ ] Scalability answer: backend, WebSocket, Redis, MongoDB, LiveKit, load balancing, infrastructure
- [ ] Postman collection with environment and auth pre-request script
- [ ] Seed script with two demo users
- [ ] 5–10 min recording covering all 10 steps from §13 of the brief
- [ ] Approximate time spent stated in README
- [ ] `.env.example` committed; no real secrets anywhere in git history
- [ ] Clean-clone rehearsal passed twice
- [ ] Google Form submitted

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Optional scope overruns the budget | Phases 0–13 ordered so everything graded completes first |
| Self-hosted LiveKit UDP/NAT trouble on Docker Desktop for Windows | Cloud is the default; self-hosting is an opt-in profile documented as such |
| LiveKit webhooks need a public URL | Tunnel for manual testing; handler unit-tested against signed fixtures regardless |
| Socket tests flake on timing | Real client, ephemeral port, explicit awaits, zero sleeps |
| Grader's `docker compose up` fails on a clean machine | Rehearsed twice from a fresh clone; healthchecks gate startup ordering |
| 100% threshold encourages assertion-free tests | Thresholds scoped to logic directories; the case table above is the real target |

---

## 13. Revisions from architecture review

| # | Change | Rationale |
|---:|---|---|
| 1 | Removed `users.isOnline` from MongoDB | Same two-sources-of-truth flaw already rejected for participants; presence is Redis's, computed into the DTO |
| 2 | Removed `room:{roomId}:meta` from Redis | A cache of MongoDB metadata with no demonstrated need. Re-add condition documented in §3 |
| 3 | `leave()` is an explicit state transition taking a `reason`, guarded by the `SREM` return value | Makes the four entry points one testable transition and resolves the concurrent-leave race without a distributed lock |
| 4 | `ParticipantSession.active` with a partial unique index | Database-level guarantee of one open session per user per room, surviving retries and duplicated webhooks |
| 5 | Added room-isolation, duplicate-webhook and concurrency test cases | Directly evidences the brief's room-scoped broadcast requirement |
| 6 | Split socket authentication from per-event authorization | *Who are you* and *may you do this* are different questions |
| 7 | JWT expiry 7d → 1h | A long-lived token was the wrong way to buy refresh-token simplicity |
| 8 | `password` → `passwordHash`; `ApiError` → `AppError(code, …)` | Names state what they hold; clients branch on codes, not prose |
| 9 | Presence and room-state services moved into their domain modules | No top-level `services/` grab bag |
| 10 | Webhooks reconcile rather than mutate | At-least-once, unordered delivery cannot be allowed to drive counters |

---

## 14. Open questions

- **Commit attribution.** Whether AI-assistance co-author trailers appear in the history is a disclosure decision for the candidate, not a default. To be settled before the first commit.
- **Whether `plan.md` ships in the submitted repository.** It evidences planning discipline and pre-empts "why is there a frontend", but also discloses the time estimate.
