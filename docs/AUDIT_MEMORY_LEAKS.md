# Memory Leak Audit — Session-Spanning Playbook

**Status**: In progress · **Started**: 2026-05-05 · **Branch**: `fix/pagination`

---

## Why this document exists

A code audit on 2026-05-05 found one production memory leak in
`backend/src/nest/notifications/notifications.controller.ts`: SSE handlers were
never cleaned up on client disconnect. The `destroy$` Subject was created but
never `.next()`/`.complete()`-ed, so the `cleanupSSEHandlers(handlers)` callback
attached via `eventSubject.pipe(takeUntil(destroy$)).subscribe({ complete })`
never fired. Result: ~23 EventBus listeners leaked **per SSE connection**,
deterministically reproduced (`baseline=3, after 5 disconnects=118`).

Fixed in commit `fix(notifications): SSE EventBus listener leak on disconnect`
with a regression test at `backend/test/notifications.sse.api.test.ts`.

**The audit was NOT exhaustive.** The same lifecycle-discipline class of bugs
likely exists elsewhere. This document tracks the remaining audits so any
future session can pick up without re-deriving context.

---

## Mental model (what TS/V8/Browser do NOT do for you)

- TypeScript catches type errors only — it never sees runtime references.
- V8 / browser GC frees only **unreachable** objects. Anything still
  referenced from a root (module-scope binding, registered listener, timer
  callback, captured closure, `Map`/`Set` entry) **lives forever**.
- Memory leaks are not a compiler problem. They are a **lifecycle-discipline**
  problem. Every allocation that escapes function scope needs an explicit
  matching teardown.

---

## Workflow per audit item

Mirror the TDD cycle that worked for the SSE fix:

1. **Audit** — run the listed `grep` over the listed scope, read each match.
2. **If clean** — tick the box; add a one-line outcome note (e.g. `verified
2026-05-12: 14 matches, all bounded`).
3. **If leak found** — write a Vitest test (Tier 1 unit OR Tier 2 API per
   ADR-018) that reproduces the leak red → apply minimal fix → test green →
   commit `fix(<scope>): <leak description>` + tick the box with the commit
   ref.

Ignore Stop-hook commit nudges if the audit produced no fix this session.

---

## Out of scope (already verified — DO NOT re-audit)

- `DatabaseService` pool acquire/release + `set_config(..., true)` pattern
  (`backend/src/nest/database/database.service.ts`).
- CLS payload size (only `tenantId`/`userId`/`userRole`); no `Scope.REQUEST`
  providers anywhere in `backend/src`.
- WebSocket per-connection cleanup + `shutdown()` clearInterval/close-all
  (`backend/src/websocket.ts:582-661`).
- SSE `destroy$` cleanup (fixed via `finalize()` wrap, regression-tested).
- `unified-logs.service.ts` finally → `clearRlsContext` (uses sys_user with
  `BYPASSRLS` — leak risk is cosmetic, finally is in place).

---

## Audit checklist (7 items)

### [x] 1. Frontend `$effect()` cleanup

- **Scope**: `frontend/src/**/*.{svelte,svelte.ts}`
- **Goal**: Every `$effect` that allocates a long-lived resource returns a
  cleanup function.
- **Grep**: `$effect(` — for each match, the body MUST be checked for
  `setInterval` | `setTimeout` (with stored ref) | `addEventListener` |
  `new EventSource` | `new WebSocket` | `.subscribe(` (RxJS / store) |
  `IntersectionObserver` | `MutationObserver` | `requestAnimationFrame`.
  Any of these without a `return () => …` cleanup is a leak.
- **DoD**: Every match either has correct cleanup, or is purely synchronous
  DOM/state mutation that allocates nothing.
- **Reference**: ADR-018 §Tier 1b for frontend unit-test conventions.
- **Outcome**: verified 2026-05-05 — 173 `$effect` matches across 385 files,
  0 leaks. Resource allocations cover `addEventListener` (37 files),
  `IntersectionObserver` (3), `ResizeObserver` (1), `.subscribe(` (3),
  and debounce `setTimeout` — all with explicit teardown. Zero
  `$effect.root` usage (no manual-teardown risk).

### [x] 2. Module-scope `$state` in `.svelte.ts`

- **Scope**: `frontend/src/**/*.svelte.ts` (explicitly NOT `.svelte`)
- **Goal**: No unbounded growth in module-scope `$state`. On SSR these live
  as long as the SvelteKit Node process; in the browser as long as the tab.
- **Grep**: `^let \w+ = \$state(` and `^const \w+ = \$state(` (top-level only).
- **DoD**: Every match is either (a) a bounded primitive/small object,
  (b) has an explicit size cap / TTL / LRU eviction, or (c) is a documented
  intentional singleton with a measured ceiling. Watch: chat history, log
  streams, notification arrays, calendar event caches.
- **Outcome**: verified 2026-05-05 — strict grep (`^(export )?(let|const) \w+
(: ...)? = \$state(\.raw)?\(`) finds 57 top-level matches across `.svelte.ts`.
  55 are bounded primitives (booleans, numbers, `Date`, strings, single-object
  refs). 2 are `Map` caches (`shiftsCache`/`vacationsCache` in
  `calendar/_lib/{shift,vacation}-indicators.svelte.ts`) — both `.clear()`
  before every refill (3× per file), bounded by current calendar view.
  Broader audit of 105 in-factory `$state` calls: state declared inside
  `createXxxState()` factories that auto-instantiate as singletons
  (`documents-explorer`, `calendar/state-user`, `kvp/state-user`, …) replaces
  collections via assignment (`allDocuments = await apiFetchDocuments()`) —
  no append-style growth. `createChatPageState` is per-component-instance
  (invoked from `chat/+page.svelte`), GC'd on unmount. SSR cross-request
  tenant bleed not via this path: Svelte 5 `$effect` runs client-only
  (svelte.dev/docs/svelte/$effect), so server-side singletons stay at
  initial null/empty between requests; tenant-state population happens
  post-hydration. Multi-tenant SSR isolation is a separate concern (not
  this audit). 0 true unbounded leaks; no fix this session.

### [x] 3. Backend in-memory caches

- **Scope**: `backend/src/**/*.ts`
- **Goal**: Every cache has bounded size or TTL/eviction; cleared in
  `OnModuleDestroy` if it holds OS resources (sockets, FDs, timers).
- **Grep**: `private readonly \w+ = new (Map|Set|WeakMap)` and any
  module-scope `const \w+ = new (Map|Set)`. Inspect `presenceStore` in
  `backend/src/websocket.ts` first — it's the obvious accumulator.
- **DoD**: Each cache documented with bound + eviction strategy, or migrated
  to Redis if unbounded growth is genuinely required.
- **Outcome**: verified 2026-05-05 — 1 fix landed, all other caches bounded.
  - `presenceStore` (`backend/src/nest/chat/presence.store.ts:15`,
    `Set<userId>`): added on connect, deleted on `handleDisconnection`,
    bounded by concurrent users. Safe.
  - `clients` Map (`backend/src/websocket.ts:88`,
    `Map<userId, ExtendedWebSocket>`): same eviction discipline,
    `shutdown()` clears heartbeat interval. Safe.
  - `permission-registry.service.ts:21` (`Map<addonCode, …>`): populated once
    via `OnModuleInit` registrars, never mutated thereafter. Static-lookup
    bounded by ~20–50 addons. Safe.
  - 5 module-scope `const … = new Set([...])` (calendar/blackboard sort
    columns, freemail blocklist, apex hosts, work-order linked-source
    types): all hardcoded immutable allowlists. Safe.
  - **LEAK FIXED**: `audit-request-filter.service.ts:29` —
    `setInterval` handle was discarded; no `OnModuleDestroy`. Constructor
    started a 5-min cleanup interval that kept the Node event loop alive
    past app teardown and accumulated across hot-reloads. Fix: capture
    the handle in `private readonly cleanupInterval`, implement
    `OnModuleDestroy` that calls `clearInterval` + `recentLogs.clear()`.
    Regression test: `audit-request-filter.service.test.ts` →
    `OnModuleDestroy — interval cleanup` (asserts `vi.getTimerCount()`
    is 1 after construction, 0 after `onModuleDestroy()`). Commit pending
    (`fix(audit): clear cleanup interval on module destroy`).

### [x] 4. Sibling `eventBus.on(...)` callers

- **Scope**: `backend/src/**/*.ts` excluding the already-fixed
  `notifications.controller.ts`.
- **Goal**: Same bug class as the fixed SSE leak must not exist elsewhere.
  Every `.on()` traces to either a `.off()` in a disconnect/destroy path,
  OR is a one-shot service-init subscription that lives for the entire
  process lifetime intentionally.
- **Grep**: `eventBus.on(` and `\.on\(['"]` in services / controllers.
- **DoD**: Each match either has a matching `.off()` OR is documented as a
  singleton subscription with rationale.
- **Outcome**: verified 2026-05-05 — no leaks, 4 doc comments added.
  - 4 `eventBus.on()` callers, all SINGLETON_INIT (zero `eventBus.off()`
    in the codebase, by design):
    - `websocket.ts:124` `listenForReadReceipts()` — registered from
      `ChatWebSocketServer` constructor (singleton).
    - `tpm/tpm-plan-approval.service.ts:171` — `OnModuleInit` singleton.
    - `kvp/kvp-approval.service.ts:239` — `OnModuleInit` singleton.
    - `shifts/swap-approval-bridge.service.ts:89` — `OnModuleInit` singleton.
      Added a JSDoc to each registration site documenting the
      process-lifetime rationale (DoD compliance: "documented as singleton
      subscription with rationale").
  - ~20 non-`eventBus` `.on('event', …)` callers — all singleton-init
    (`process.on('SIGTERM' …)` in main.ts + deletion-worker, `redis.on`
    on Redis singletons, `pool.on('error')` on pg pool, `wss.on
('connection')`) OR per-connection auto-GC'd (`ws.on('message'
| 'close' | 'error' | 'pong')` — handlers die with the socket).
  - 1 `.subscribe()` call: the already-fixed `notifications.controller.ts`
    SSE pattern with `takeUntil(destroy$) + finalize()`.
  - No code-behaviour fix this session; pure documentation additions.

### [x] 5. `setInterval` / long-lived `setTimeout`

- **Scope**: `backend/src/**/*.ts`
- **Goal**: No "forever-ticking" timer retains closures past the relevant
  lifecycle. Every `setInterval` cleared in `OnModuleDestroy`, `shutdown()`,
  or equivalent teardown.
- **Grep**: `setInterval(` — for each, verify a matching `clearInterval(`
  in a lifecycle hook. Also flag `setTimeout(` whose handle is stored at
  module/instance scope (rare but real).
- **DoD**: Every interval has documented teardown.
- **Outcome**: verified 2026-05-05 — 2 `setInterval`, 7 production
  `setTimeout`, 0 leaks. No code change this session.
  - `websocket.ts:606` `this.heartbeatInterval` (30s WebSocket ping) →
    cleared in `shutdown()` L629 (`clearInterval` + null), triggered from
    `main.ts gracefulShutdown()`.
  - `audit-request-filter.service.ts:38` `this.cleanupInterval` (5min
    cache sweep) → cleared in `onModuleDestroy()` L53 plus
    `recentLogs.clear()`. Already fixed in commit 3d5542291 (step 3
    cross-finding).
  - 7 production `setTimeout` (excluding 6 test files):
    - Ephemeral Promise sleeps: `deletion-worker.ts:134`,
      `email-service.ts:655` (1s grace before SMTP retry).
    - AbortController fetch-timeouts cleared in `finally`:
      `microsoft.provider.ts:245` (postForm), `microsoft.provider.ts:296`
      (graphFetch).
    - Self-clearing race timeouts (no handle captured, callback fires
      and releases): `websocket.ts:644` (1s ws-close shutdown fallback,
      bounded by `Promise.all`), `domain-verification.service.ts:81`
      (`DNS_TIMEOUT_MS` race; `resolver.cancel()` in `finally` frees the
      socket immediately, JS timer self-clears at deadline).
  - Module/instance-scope `setTimeout` handle stores: 0 matches
    (regex `(this\.\w+|^(let|const)\s+\w+(:[^=]+)?)\s*=\s*setTimeout`).

### [x] 6. `deletion-worker` process audit

- **Scope**: `backend/src/workers/deletion-worker.ts` and its dependencies
  (port 3002, separate Node process).
- **Goal**: Worker lifecycle clean. Apply audits #3, #4, #5 within this
  process. SIGTERM must produce `process.exit(0)` in finite time with no
  orphan connections / listeners / timers.
- **DoD**: Verified by `kill -TERM <pid>` against a running worker; process
  exits 0 within 30s; no warnings about open handles.
- **Outcome**: verified 2026-05-05 — DoD met, 0 leaks, no code change.
  SIGTERM → exit 0 in **0.45 s** (far under the 30 s budget), no
  open-handle warnings.
  - Static audit (worker scope, `backend/src/workers/`):
    - 4 `process.on()` listeners (`SIGTERM`, `SIGINT`, `uncaughtException`,
      `unhandledRejection`) — singleton-init, process-lifetime by design.
    - 1 `setTimeout` (`deletion-worker.ts:134`) — ephemeral Promise sleep
      inside `private async sleep(ms)`. Already covered by step 5.
    - 0 caches, 0 `setInterval`, 0 `eventBus.on()` at worker scope.
  - Module-graph audit (`DeletionWorkerModule` → `TenantDeletionModule`,
    `DatabaseModule`, `ClsModule`, `AppConfigModule`, `ConfigModule`):
    - `TenantDeletionService` — `private redisClient: Redis | null` lazy
      init, registers `redisClient.on('error', …)`. Properly released via
      `OnModuleDestroy` (line 54: `await this.redisClient.quit()`).
    - `DatabaseModule` — pool closed via its own `OnModuleDestroy`
      (live log: "Closing PostgreSQL connection pool... closed"). Out of
      scope per masterplan §"Out of scope".
  - Live SIGTERM verification (`docker stop -t 70 assixx-deletion-worker`,
    `restart: unless-stopped` keeps it stopped after `docker stop`):
    - Pre: status=running, host-pid=2463, uptime 2049 s, `/health` OK.
    - Stop duration 0.45 s, ExitCode=0, OOMKilled=false, Error="".
    - Shutdown log chain in order: "received SIGTERM" → "Closing
      PostgreSQL connection pool…" → "pool closed" → "NestJS
      application context closed" → "Deletion Worker shutdown complete".
    - Restored via `docker-compose up -d deletion-worker`; `/health`
      back to healthy.
  - **Discipline observation (not a leak, no fix this session)**: the
    health-check `http.createServer` (`deletion-worker.ts:110`) is never
    explicitly closed in `shutdown()`. Masked by the trailing
    `process.exit(0)` (hard-kill bypasses Node's event-loop drain), which
    is why the live test showed 0 open-handle warnings. Closing the
    local `const server` would be cleaner discipline; flagged for a
    future polish PR. Current behaviour is correct.

### [x] 7. Frontend `addEventListener` cleanup

- **Scope**: `frontend/src/**/*.{ts,svelte,svelte.ts}`
- **Goal**: Every `addEventListener` on `window`, `document`, or a
  long-lived DOM node has a matching `removeEventListener` in `$effect`
  cleanup, `onDestroy`, or a `beforeunload` handler.
- **Grep**: `addEventListener(` — for each, locate the matching removal.
- **DoD**: Every match traces to a removal path. Anonymous handlers
  (`addEventListener('x', () => …)`) are inherently un-removable; flag as
  bugs unless they live on an element that is itself short-lived.
- **Outcome**: verified 2026-05-06 — 0 production leaks. 71 total
  `addEventListener` matches categorised:
  - **~30 inside `.svelte` `$effect()` blocks** — already verified clean
    by step 1 (each effect returns its own cleanup).
  - **4 long-lived targets, named-ref handler with explicit removal** —
    `notification-sse.ts:212` (`window.beforeunload` paired with
    `disconnect()` L305-307), `role-sync.svelte.ts:178`
    (`window.storage` paired with `destroy()` L263-265),
    `click-outside.ts:35` (`document.click` action returns its own
    cleanup → consumed by `$effect`), `perf-logger.ts:107`
    (`window.load` with `{ once: true }` self-clearing).
  - **~32 local-target handlers** (DOM elements, AbortSignal, XHR,
    confirm/cancel buttons inside throw-away modals) — auto-GC'd with
    their target, no manual cleanup needed.
  - **5 anonymous-handler sites on long-lived targets** — flagged by
    DoD's literal rule, but all live inside enforced singletons that
    only attach the listener once per page load: - `session-manager.ts:71` (`document.visibilitychange`), - `session-manager.ts:96` (`document.scroll`, passive), - `session-manager.ts:108` (`document.{mousedown,keydown,touchstart,
click}`, passive) — SessionManager singleton (lines 22, 54-62). - `token-manager.ts:688` (`document.visibilitychange`) — TokenManager
    singleton (lines 112, 140-148). - `tooltip.svelte.ts:202+205` (`window.{blur,keydown}`) —
    module-scope `isInitialized` flag (line 75) gates exactly-once.
    Production behaviour: each listener attaches once, dies with
    `beforeunload`. No compounding leak. Same singleton-init pattern as
    backend `eventBus.on()` callers (step 4 precedent).
  - **Code change this session**: 4 JSDoc additions documenting the
    singleton-lifetime rationale at each site (matches step 4's
    "documented as singleton subscription" approach):
    - `session-manager.ts` — JSDoc on `setupPageVisibilityListener()`
      and `setupActivityListeners()`.
    - `token-manager.ts` — JSDoc on `setupVisibilityListener()`.
    - `tooltip.svelte.ts` — expanded JSDoc on `initializeListeners()`.
      Each comment cross-references this audit and notes the refactor
      path (anonymous arrow → bound method) to take if future
      requirements demand a `destroy()` API or HMR-dev hygiene.
  - No behavioural change. Lint + type-check verified post-edit.

---

## Verification helpers

```bash
# Listener-count probe (the same endpoint that anchors the SSE regression test)
curl -s http://localhost:3000/api/v2/notifications/stream/stats \
  -H "Authorization: Bearer $TOKEN" | jq

# Postgres pool saturation (catches connection-leak class bugs)
docker exec assixx-postgres psql -U assixx_user -d assixx \
  -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'assixx';"

# Backend memory in-flight
docker stats --no-stream assixx-backend
```

---

## References

- **Anchor commit**: `fix(notifications): SSE EventBus listener leak on
disconnect` (2026-05-05).
- **Regression test pattern**: `backend/test/notifications.sse.api.test.ts`
  — copy as a template for any Tier-2 leak test.
- **ADR-003** Real-Time Notification System — SSE architecture.
- **ADR-018** Testing Strategy — pick the right Tier (unit / API / load).
- **ADR-019** Multi-Tenant RLS Isolation — cleanup guarantees already in
  place at the DB layer.
- **CLAUDE.md** — KISS, brutal honest, no quick fixes.
