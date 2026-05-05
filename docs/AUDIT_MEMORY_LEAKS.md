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

### [ ] 3. Backend in-memory caches

- **Scope**: `backend/src/**/*.ts`
- **Goal**: Every cache has bounded size or TTL/eviction; cleared in
  `OnModuleDestroy` if it holds OS resources (sockets, FDs, timers).
- **Grep**: `private readonly \w+ = new (Map|Set|WeakMap)` and any
  module-scope `const \w+ = new (Map|Set)`. Inspect `presenceStore` in
  `backend/src/websocket.ts` first — it's the obvious accumulator.
- **DoD**: Each cache documented with bound + eviction strategy, or migrated
  to Redis if unbounded growth is genuinely required.

### [ ] 4. Sibling `eventBus.on(...)` callers

- **Scope**: `backend/src/**/*.ts` excluding the already-fixed
  `notifications.controller.ts`.
- **Goal**: Same bug class as the fixed SSE leak must not exist elsewhere.
  Every `.on()` traces to either a `.off()` in a disconnect/destroy path,
  OR is a one-shot service-init subscription that lives for the entire
  process lifetime intentionally.
- **Grep**: `eventBus.on(` and `\.on\(['"]` in services / controllers.
- **DoD**: Each match either has a matching `.off()` OR is documented as a
  singleton subscription with rationale.

### [ ] 5. `setInterval` / long-lived `setTimeout`

- **Scope**: `backend/src/**/*.ts`
- **Goal**: No "forever-ticking" timer retains closures past the relevant
  lifecycle. Every `setInterval` cleared in `OnModuleDestroy`, `shutdown()`,
  or equivalent teardown.
- **Grep**: `setInterval(` — for each, verify a matching `clearInterval(`
  in a lifecycle hook. Also flag `setTimeout(` whose handle is stored at
  module/instance scope (rare but real).
- **DoD**: Every interval has documented teardown.

### [ ] 6. `deletion-worker` process audit

- **Scope**: `backend/src/workers/deletion-worker.ts` and its dependencies
  (port 3002, separate Node process).
- **Goal**: Worker lifecycle clean. Apply audits #3, #4, #5 within this
  process. SIGTERM must produce `process.exit(0)` in finite time with no
  orphan connections / listeners / timers.
- **DoD**: Verified by `kill -TERM <pid>` against a running worker; process
  exits 0 within 30s; no warnings about open handles.

### [ ] 7. Frontend `addEventListener` cleanup

- **Scope**: `frontend/src/**/*.{ts,svelte,svelte.ts}`
- **Goal**: Every `addEventListener` on `window`, `document`, or a
  long-lived DOM node has a matching `removeEventListener` in `$effect`
  cleanup, `onDestroy`, or a `beforeunload` handler.
- **Grep**: `addEventListener(` — for each, locate the matching removal.
- **DoD**: Every match traces to a removal path. Anonymous handlers
  (`addEventListener('x', () => …)`) are inherently un-removable; flag as
  bugs unless they live on an element that is itself short-lived.

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
