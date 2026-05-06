/**
 * Dummy Users API Integration Tests
 *
 * Runs against REAL backend (Docker must be running).
 * Tests: Auth, CRUD, Dummy Login & Access Control, Query Isolation.
 *
 * @see vitest.config.api.ts
 */
import {
  APITEST_PASSWORD,
  type AuthState,
  BASE_URL,
  type JsonBody,
  authHeaders,
  authOnly,
  ensureTestEmployee,
  flushThrottleKeys,
  loginApitest,
  loginNonRoot,
  loginNonRootFull,
} from './helpers.js';

let adminAuth: AuthState;

/** UUID of dummy created in CRUD tests */
let dummyUuid: string;
/** Auto-generated email of the created dummy */
let dummyEmail: string;

/** UUID of a second dummy for login/access tests (not soft-deleted) */
let accessDummyUuid: string;
let accessDummyEmail: string;
let accessDummyAuth: AuthState;

const DUMMY_PASSWORD = 'DummyPasswort123!';

beforeAll(async () => {
  adminAuth = await loginApitest();
});

// Clean up dummy users after all tests
afterAll(async () => {
  const uuids = [dummyUuid, accessDummyUuid].filter(Boolean);
  for (const uuid of uuids) {
    await fetch(`${BASE_URL}/dummy-users/${uuid}`, {
      method: 'DELETE',
      headers: authOnly(adminAuth.authToken),
    });
  }
});

// ---- seq: 1 -- Auth: Unauthenticated → 401 ---------------------------------

describe('Dummy Users: Auth', () => {
  it('should return 401 without token', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users`);
    expect(res.status).toBe(401);
  });

  it('should return 403 for employee role', async () => {
    await ensureTestEmployee(adminAuth.authToken);

    // Login as employee — full 2-step 2FA dance per FEAT_2FA_EMAIL Step 2.4
    // (helpers.loginNonRoot consolidates the pattern across ~7 api-test files).
    const employeeToken = await loginNonRoot('employee@assixx.com', APITEST_PASSWORD);

    const res = await fetch(`${BASE_URL}/dummy-users`, {
      headers: authOnly(employeeToken),
    });
    expect(res.status).toBe(403);
  });
});

// ---- seq: 2 -- CRUD: Create Dummy -------------------------------------------

describe('Dummy Users: Create', () => {
  it('should return 201 with auto-generated email', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users`, {
      method: 'POST',
      headers: authHeaders(adminAuth.authToken),
      body: JSON.stringify({
        displayName: `API Test Dummy ${Date.now()}`,
        password: DUMMY_PASSWORD,
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.email).toMatch(/^dummy_\d+@.*\.display$/);
    expect(body.data.employeeNumber).toMatch(/^DUMMY-\d{3,}$/);
    expect(body.data.uuid).toBeDefined();

    dummyUuid = body.data.uuid as string;
    dummyEmail = body.data.email as string;
  });

  it('should return 400 for missing displayName', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users`, {
      method: 'POST',
      headers: authHeaders(adminAuth.authToken),
      body: JSON.stringify({ password: DUMMY_PASSWORD }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 for too short password', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users`, {
      method: 'POST',
      headers: authHeaders(adminAuth.authToken),
      body: JSON.stringify({ displayName: 'Test', password: 'short' }),
    });

    expect(res.status).toBe(400);
  });
});

// ---- seq: 3 -- CRUD: List Dummies -------------------------------------------

describe('Dummy Users: List', () => {
  // FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §3.1 (2026-05-04): GET /dummy-users
  // now ships the canonical ADR-007 envelope `{ success, data: T[], meta:
  // { pagination: { page, limit, total, totalPages } }, timestamp }`. The
  // ResponseInterceptor extracts the service's `items[]` into `data` and
  // forwards `pagination` verbatim into `meta.pagination`. The frontend
  // `apiFetchPaginated<T>` helper rejects anything else (Phase-2 contract,
  // masterplan changelog 1.4.0).
  it('should return 200 with canonical ADR-007 envelope', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.meta?.pagination).toBeDefined();
    expect(typeof body.meta.pagination.page).toBe('number');
    expect(typeof body.meta.pagination.limit).toBe('number');
    expect(body.meta.pagination.total).toBeGreaterThanOrEqual(1);
    expect(typeof body.meta.pagination.totalPages).toBe('number');
  });

  it('should only contain dummy users, not employees', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;
    const items = body.data as Array<{ email: string }>;

    for (const item of items) {
      expect(item.email).toMatch(/dummy/i);
    }
  });

  // Plan §Step 3.1 mandate: verify `?page=2&limit=10` round-trips correctly
  // and `meta.pagination.totalPages = ceil(total / limit)` (or 0 when total=0).
  it('should echo ?page=2&limit=10 with correct totalPages math', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users?page=2&limit=10`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.meta.pagination.limit).toBe(10);
    const { total, limit, totalPages } = body.meta.pagination as {
      total: number;
      limit: number;
      totalPages: number;
    };
    const expectedTotalPages = total === 0 ? 0 : Math.ceil(total / limit);
    expect(totalPages).toBe(expectedTotalPages);
  });
});

// ---- seq: 4 -- CRUD: Get Single Dummy ---------------------------------------

describe('Dummy Users: Get Single', () => {
  it('should return 200 with dummy details', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users/${dummyUuid}`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.data.uuid).toBe(dummyUuid);
    expect(body.data.email).toBe(dummyEmail);
    expect(body.data.displayName).toBeDefined();
  });
});

// ---- seq: 5 -- CRUD: Update Dummy -------------------------------------------

describe('Dummy Users: Update', () => {
  it('should return 200 with updated displayName', async () => {
    const newName = `Updated Dummy ${Date.now()}`;
    const res = await fetch(`${BASE_URL}/dummy-users/${dummyUuid}`, {
      method: 'PUT',
      headers: authHeaders(adminAuth.authToken),
      body: JSON.stringify({ displayName: newName }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.data.displayName).toBe(newName);
  });
});

// ---- seq: 6 -- CRUD: Delete Dummy -------------------------------------------

describe('Dummy Users: Delete', () => {
  it('should return 200 on soft-delete', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users/${dummyUuid}`, {
      method: 'DELETE',
      headers: authOnly(adminAuth.authToken),
    });

    expect(res.status).toBe(200);
  });

  it('should return 404 after delete', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users/${dummyUuid}`, {
      headers: authOnly(adminAuth.authToken),
    });

    expect(res.status).toBe(404);
  });
});

// ---- seq: 7 -- Dummy Login & Access Control ---------------------------------

describe('Dummy Users: Login & Access', () => {
  // Create a fresh dummy for login tests (the CRUD one was deleted)
  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/dummy-users`, {
      method: 'POST',
      headers: authHeaders(adminAuth.authToken),
      body: JSON.stringify({
        displayName: `Access Test Dummy ${Date.now()}`,
        password: DUMMY_PASSWORD,
      }),
    });
    const body = (await res.json()) as JsonBody;
    accessDummyUuid = body.data.uuid as string;
    accessDummyEmail = body.data.email as string;

    // Flush throttle keys to prevent 429 from accumulated login requests.
    flushThrottleKeys();

    // Login as the dummy user — full 2-step 2FA dance per FEAT_2FA_EMAIL
    // Step 2.4. Dummy users have email like `dummy_NNN@<tenant>.display`;
    // their 2FA mail still lands in Mailpit because the SMTP transport is
    // address-agnostic in dev (mailpit catches everything).
    accessDummyAuth = await loginNonRootFull(accessDummyEmail, DUMMY_PASSWORD);
  });

  // --- Allowed endpoints (auto-assigned read-only permissions) ---

  it('should allow dummy GET /blackboard/entries', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries`, {
      headers: authOnly(accessDummyAuth.authToken),
    });
    expect(res.status).toBe(200);
  });

  it('should allow dummy GET /calendar/events', async () => {
    const res = await fetch(`${BASE_URL}/calendar/events`, {
      headers: authOnly(accessDummyAuth.authToken),
    });
    expect(res.status).toBe(200);
  });

  it('should allow dummy GET /tpm/plans', async () => {
    const res = await fetch(`${BASE_URL}/tpm/plans`, {
      headers: authOnly(accessDummyAuth.authToken),
    });
    expect(res.status).toBe(200);
  });

  // --- Denied endpoints ---

  it('should deny dummy POST /blackboard/entries (canWrite=false)', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries`, {
      method: 'POST',
      headers: authHeaders(accessDummyAuth.authToken),
      body: JSON.stringify({
        title: 'Dummy should not create',
        content: 'This should fail',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('should deny dummy POST /calendar/events (canWrite=false)', async () => {
    const res = await fetch(`${BASE_URL}/calendar/events`, {
      method: 'POST',
      headers: authHeaders(accessDummyAuth.authToken),
      body: JSON.stringify({
        title: 'Dummy should not create events',
        startTime: '2026-04-01T09:00:00',
        endTime: '2026-04-01T10:00:00',
        orgLevel: 'personal',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('should deny dummy GET /chat/conversations (no chat permission)', async () => {
    const res = await fetch(`${BASE_URL}/chat/conversations`, {
      headers: authOnly(accessDummyAuth.authToken),
    });
    expect(res.status).toBe(403);
  });

  it('should return 200 with scope-filtered data for dummy GET /users (no @RequirePermission on GET)', async () => {
    const res = await fetch(`${BASE_URL}/users`, {
      headers: authOnly(accessDummyAuth.authToken),
    });
    expect(res.status).toBe(200);
  });
});

// ---- seq: 8 -- Query Isolation (Regression) ---------------------------------

describe('Dummy Users: Query Isolation', () => {
  it('should NOT show dummies in GET /users', async () => {
    const res = await fetch(`${BASE_URL}/users?limit=100`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    const users = body.data as Array<{ role: string }>;
    const dummies = users.filter((u: { role: string }) => u.role === 'dummy');
    expect(dummies).toHaveLength(0);
  });
});

// ---- seq: 9 -- Pagination (Step 5.1) ----------------------------------------
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §Step 5.1 (Session 14, 2026-05-06):
// every migrated endpoint receives 4 dedicated pagination assertions —
//   1. ?page=2&limit=N returns correct slice + correct meta.pagination.totalPages
//   2. ?search=<term> returns matches that exist beyond page 1
//   3. Combined ?page=2&search=<term> returns correct slice of search hits
//   4. Tenant-isolation sanity (RLS unchanged but verify): search by unique tag
//      returns EXACTLY the seeded set; no foreign-tenant records leak in.
//
// Seed 22 dummies with a unique `displayName` tag so search results are
// deterministic and scoped to the test tenant 1 (`apitest`, subdomain `assixx`).
// 22 = 2 × `limit` + 2 — guarantees `totalPages >= 3` so test #2's
// "matches beyond page 1" claim is structural, not coincidental.
describe('Dummy Users: Pagination (Step 5.1)', () => {
  const tag = `Pg5_1_${Date.now()}`;
  const seedCount = 22;
  const limit = 10;
  const seededUuids: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < seedCount; i++) {
      const res = await fetch(`${BASE_URL}/dummy-users`, {
        method: 'POST',
        headers: authHeaders(adminAuth.authToken),
        body: JSON.stringify({
          displayName: `${tag}_${String(i).padStart(2, '0')}`,
          password: DUMMY_PASSWORD,
        }),
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`Pagination seed: dummy ${i} failed ${res.status} — ${text}`);
      }
      const body = (await res.json()) as JsonBody;
      seededUuids.push(body.data.uuid as string);
    }
  });

  afterAll(async () => {
    for (const uuid of seededUuids) {
      await fetch(`${BASE_URL}/dummy-users/${uuid}`, {
        method: 'DELETE',
        headers: authOnly(adminAuth.authToken),
      });
    }
  });

  it('?page=2&limit=10 returns correct slice + totalPages math', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users?search=${tag}&page=2&limit=${limit}`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.meta.pagination.limit).toBe(limit);
    expect(body.meta.pagination.total).toBe(seedCount);
    expect(body.meta.pagination.totalPages).toBe(Math.ceil(seedCount / limit));
    // Page 2 of 22 with limit 10 → exactly 10 items
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ displayName: string }>) {
      expect(item.displayName).toContain(tag);
    }
  });

  it('?search=<tag> returns matches that exist beyond page 1', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users?search=${tag}&page=1&limit=${limit}`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    // Total exactly equals our seed → proves no pre-existing dummies match the tag
    expect(body.meta.pagination.total).toBe(seedCount);
    // ceil(22/10) = 3 → matches exist on pages 2 AND 3
    expect(body.meta.pagination.totalPages).toBeGreaterThan(1);
    expect(body.data.length).toBe(limit);
    expect(body.meta.pagination.total - limit).toBeGreaterThan(0);
  });

  it('combined ?page=2&search=<tag> returns correct slice of search hits', async () => {
    const res = await fetch(`${BASE_URL}/dummy-users?search=${tag}&page=2&limit=${limit}`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ displayName: string }>) {
      expect(item.displayName).toContain(tag);
    }
  });

  it('tenant isolation: search returns exactly the seeded set, no leaks', async () => {
    // Fetch every search hit at limit=100 and assert the UUID set === seeded set.
    // Proves the response respects RLS scoping — no records from other tenants
    // appear under our tag, and no stale records from prior runs survive.
    const res = await fetch(`${BASE_URL}/dummy-users?search=${tag}&limit=100`, {
      headers: authOnly(adminAuth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.total).toBe(seedCount);
    expect(body.data.length).toBe(seedCount);
    const returnedUuids = (body.data as Array<{ uuid: string }>).map((d) => d.uuid).sort();
    expect(returnedUuids).toEqual([...seededUuids].sort());
  });
});
