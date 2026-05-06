/**
 * Tier-2 API Test: SSE EventBus listener-leak detection.
 *
 * WHY this test exists (2026-05-05):
 *   `notifications.controller.ts:911` constructs `const destroy$ = new Subject<void>()`
 *   but never calls `destroy$.next()` / `.complete()` anywhere in the controller.
 *   The inner subscription `eventSubject.pipe(takeUntil(destroy$)).subscribe({
 *     complete: () => cleanupSSEHandlers(handlers)
 *   })` therefore never reaches its `complete` callback when the HTTP client
 *   disconnects — NestJS unsubscribes the OUTER merged Observable, but the
 *   INNER auxiliary subscription stays alive forever.
 *
 *   Result: every SSE connection adds N EventBus listeners that are never
 *   removed → linear memory growth per connection cycle.
 *
 * WHAT this test does:
 *   1. Snapshot baseline listener counts via `GET /notifications/stream/stats`
 *      (the endpoint exists exactly because the team anticipated this concern —
 *      see notifications.controller.ts:970-985).
 *   2. Open + abort 5 SSE connections, sleeping ~1.2s before abort so that
 *      `registerSSEHandlers` (registered async after permission resolution
 *      per controller.ts:933-941) has guaranteed run.
 *   3. Wait 2s for backend teardown to settle.
 *   4. Re-snapshot listener counts. Must equal baseline.
 *
 * EXPECTED RESULT: this test will FAIL until destroy$ is properly completed.
 *   Suggested fix: wrap the merged Observable in `finalize(() => {
 *     destroy$.next(); destroy$.complete();
 *   })` so RxJS teardown propagates Subject completion.
 *
 * @see backend/src/nest/notifications/notifications.controller.ts:905-953
 * @see docs/infrastructure/adr/ADR-003-notification-system.md (SSE architecture)
 * @see docs/infrastructure/adr/ADR-018-testing-strategy.md (Tier 2 patterns)
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { type AuthState, BASE_URL, type JsonBody, authOnly, loginApitest } from './helpers.js';

let auth: AuthState;
beforeAll(async () => {
  auth = await loginApitest();
});

interface StreamStats {
  activeEvents: string[];
  listenerCounts: Record<string, number>;
  timestamp: string;
}

/**
 * Read live SSE handler statistics. Endpoint is admin-only with
 * `@RequirePermission(NOTIFICATIONS_ADDON, MOD_MANAGE, 'canRead')` —
 * `info@assixx.com` (test-tenant root) satisfies this via `hasFullAccess`.
 */
async function getStats(token: string): Promise<StreamStats> {
  const res = await fetch(`${BASE_URL}/notifications/stream/stats`, {
    headers: authOnly(token),
  });
  const body = (await res.json()) as JsonBody;
  if (!res.ok) {
    throw new Error(`stats failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  return body.data as StreamStats;
}

function totalListeners(stats: StreamStats): number {
  return Object.values(stats.listenerCounts).reduce((sum: number, count: number) => sum + count, 0);
}

/**
 * Open an SSE connection, hold it for `openMs`, then close cleanly.
 *
 * Node has no `EventSource` global — `fetch` + `body.cancel()` mirrors what a
 * real EventSource client does over the wire: HTTP request held open, then
 * client-side close → undici propagates teardown to the underlying socket →
 * backend observes TCP FIN and unsubscribes from the merged Observable.
 */
async function openSseAndClose(token: string, openMs: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/notifications/stream`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
  });
  if (!res.ok) {
    throw new Error(`SSE connect failed: HTTP ${res.status}`);
  }

  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, openMs);
  });

  // Cancelling the ReadableStream releases the underlying socket so the
  // backend observes the disconnect. Swallow the AbortError that undici
  // rejects with on the in-flight read.
  await res.body?.cancel().catch(() => undefined);
}

describe('SSE: EventBus listener-leak detection (notifications.controller destroy$)', () => {
  it('listener count MUST return to baseline after 5 disconnected SSE clients', async () => {
    // Step 1: baseline
    const baseline = await getStats(auth.authToken);
    const baseTotal = totalListeners(baseline);

    // Step 2: open + close 5 SSE connections
    // 1.2s open window > controller.ts:933-941 async permission resolution +
    // registerSSEHandlers — guarantees handlers were actually attached before
    // we abort (otherwise the test would be a false-positive: "no leak"
    // because nothing was registered).
    const N = 5;
    for (let i = 0; i < N; i++) {
      await openSseAndClose(auth.authToken, 1_200);
    }

    // Step 3: wait for backend teardown to settle.
    // RxJS unsubscribe is synchronous, but Fastify needs a tick to translate
    // TCP FIN into Observable.unsubscribe(). 2s is generous.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 2_000);
    });

    // Step 4: re-measure
    const after = await getStats(auth.authToken);
    const afterTotal = totalListeners(after);
    const delta = afterTotal - baseTotal;

    /* eslint-disable vitest/valid-expect -- Vitest 4 supports a 2nd `message` arg on expect() (see https://vitest.dev/api/expect.html#expect). The vitest/valid-expect rule (@vitest/eslint-plugin <=2.x) is stale and asserts maxArgs:1; the message is essential here because the bare `expected 3 to be 118` diff hides the production root cause + fix recipe. */
    expect(
      afterTotal,
      `EventBus listener LEAK detected: baseline=${baseTotal}, ` +
        `after ${N} disconnected SSE clients=${afterTotal}, delta=+${delta}.\n\n` +
        `ROOT CAUSE: notifications.controller.ts:911 creates ` +
        `\`const destroy$ = new Subject<void>()\` but NEVER calls ` +
        `\`destroy$.next()\` or \`.complete()\` on client disconnect.\n` +
        `The auxiliary subscription \`eventSubject.pipe(takeUntil(destroy$))` +
        `.subscribe({ complete: cleanupSSEHandlers })\` (Z.935-939) therefore ` +
        `never reaches its \`complete\` callback. EventBus handlers ` +
        `registered in \`registerSSEHandlers\` accumulate per connection.\n\n` +
        `SUGGESTED FIX: wrap the returned merged Observable in \n` +
        `  finalize(() => { destroy$.next(); destroy$.complete(); })\n` +
        `so that NestJS teardown on client disconnect propagates Subject ` +
        `completion → cleanupSSEHandlers fires → listeners removed.`,
    ).toBe(baseTotal);
    /* eslint-enable vitest/valid-expect */
  }, 30_000);
});
