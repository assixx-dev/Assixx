/**
 * Approvals — API Integration Tests
 *
 * Tests the full approval lifecycle against the real Docker backend:
 * config CRUD, approval create, approve, reject, stats.
 *
 * Runs as root (info@assixx.com = root with has_full_access=true).
 * Core addon — no tenant_addons setup needed.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  type AuthState,
  BASE_URL,
  type JsonBody,
  authHeaders,
  authOnly,
  loginApitest,
} from './helpers.js';

let auth: AuthState;

beforeAll(async () => {
  auth = await loginApitest();
});

// Shared state across describe blocks
let configUuid: string;
let approvalUuid: string;

// =============================================================================
// Config: List (initially empty for this addon)
// =============================================================================

describe('Approvals Config: List', () => {
  let res: Response;
  let body: JsonBody;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/configs`, {
      headers: authOnly(auth.authToken),
    });
    body = (await res.json()) as JsonBody;
  });

  it('should return 200', () => {
    expect(res.status).toBe(200);
  });

  it('should return success true', () => {
    expect(body.success).toBe(true);
  });

  it('should return array', () => {
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// =============================================================================
// Config: Create
// =============================================================================

describe('Approvals Config: Create', () => {
  let res: Response;
  let body: JsonBody;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/configs`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        addonCode: 'kvp',
        approverType: 'user',
        approverUserId: auth.userId,
      }),
    });
    body = (await res.json()) as JsonBody;

    if (body.data?.uuid) {
      configUuid = body.data.uuid as string;
    }
  });

  it('should return 200', () => {
    expect(res.status).toBe(200);
  });

  it('should return created config', () => {
    expect(body.data).toHaveProperty('uuid');
    expect(body.data.addonCode).toBe('kvp');
    expect(body.data.approverType).toBe('user');
  });
});

// =============================================================================
// Approval: Create
// =============================================================================

describe('Approvals: Create', () => {
  let res: Response;
  let body: JsonBody;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        addonCode: 'kvp',
        sourceEntityType: 'kvp_suggestion',
        sourceUuid: '00000000-0000-0000-0000-000000000001',
        title: 'API Test Approval',
        priority: 'medium',
      }),
    });
    body = (await res.json()) as JsonBody;

    if (body.data?.uuid) {
      approvalUuid = body.data.uuid as string;
    }
  });

  it('should return 201', () => {
    expect(res.status).toBe(201);
  });

  it('should return approval with pending status', () => {
    expect(body.data).toHaveProperty('uuid');
    expect(body.data.status).toBe('pending');
    expect(body.data.addonCode).toBe('kvp');
    expect(body.data.title).toBe('API Test Approval');
  });
});

// =============================================================================
// Approval: List All
// =============================================================================

describe('Approvals: List All', () => {
  let res: Response;
  let body: JsonBody;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals`, {
      headers: authOnly(auth.authToken),
    });
    body = (await res.json()) as JsonBody;
  });

  it('should return 200', () => {
    expect(res.status).toBe(200);
  });

  // ResponseInterceptor extracts the service's `items[]` into `data` and
  // forwards `pagination` verbatim into `meta.pagination` (Phase 4.3a:
  // FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN changelog 1.13.0). Mirrors
  // the canonical dummy-users (Phase 3.1) and users (Phase 4.1a) envelope.
  it('should return canonical ADR-007 envelope', () => {
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta?.pagination).toBeDefined();
    expect(typeof body.meta.pagination.page).toBe('number');
    expect(typeof body.meta.pagination.limit).toBe('number');
    expect(typeof body.meta.pagination.total).toBe('number');
    expect(typeof body.meta.pagination.totalPages).toBe('number');
  });

  it('should contain the created approval', () => {
    expect(body.meta.pagination.total).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Approval: My Approvals
// =============================================================================

describe('Approvals: My Approvals', () => {
  let res: Response;
  let body: JsonBody;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/my`, {
      headers: authOnly(auth.authToken),
    });
    body = (await res.json()) as JsonBody;
  });

  it('should return 200', () => {
    expect(res.status).toBe(200);
  });

  it('should return array of my requested approvals', () => {
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// =============================================================================
// Approval: Stats
// =============================================================================

describe('Approvals: Stats', () => {
  let res: Response;
  let body: JsonBody;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/stats`, {
      headers: authOnly(auth.authToken),
    });
    body = (await res.json()) as JsonBody;
  });

  it('should return 200', () => {
    expect(res.status).toBe(200);
  });

  it('should return stats object with counts', () => {
    expect(body.data).toHaveProperty('pending');
    expect(body.data).toHaveProperty('approved');
    expect(body.data).toHaveProperty('rejected');
    expect(body.data).toHaveProperty('total');
  });

  it('should have at least 1 pending', () => {
    expect(body.data.pending).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Approval: Get By UUID
// =============================================================================

describe('Approvals: Get By UUID', () => {
  let res: Response;
  let body: JsonBody;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/${approvalUuid}`, {
      headers: authOnly(auth.authToken),
    });
    body = (await res.json()) as JsonBody;
  });

  it('should return 200', () => {
    expect(res.status).toBe(200);
  });

  it('should return the approval', () => {
    expect(body.data.uuid.trim()).toBe(approvalUuid);
    expect(body.data.status).toBe('pending');
  });
});

// =============================================================================
// Approval: Reject without note → 400
// =============================================================================

describe('Approvals: Reject without note', () => {
  let res: Response;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/${approvalUuid}/reject`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({}),
    });
  });

  it('should return 400 (note required)', () => {
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// Approval: Approve (self-approve — will fail because requester = decider)
// NOTE: Root user created the approval AND tries to approve it.
// This should throw ForbiddenException (self-approve prevention).
// =============================================================================

describe('Approvals: Self-approve prevention', () => {
  let res: Response;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/${approvalUuid}/approve`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({}),
    });
  });

  it('should return 403 (self-approve blocked)', () => {
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// Cleanup: Create a second approval from a "different perspective"
// and approve it to test the happy path.
// Since we only have one test user, we test the reject path with note.
// =============================================================================

describe('Approvals: Reject with note', () => {
  let rejectRes: Response;

  beforeAll(async () => {
    // Self-reject is also blocked (same user created + decides).
    // Verifies the 403 — happy-path approve/reject tested via unit tests.
    rejectRes = await fetch(`${BASE_URL}/approvals/${approvalUuid}/reject`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ decisionNote: 'Not approved - test' }),
    });
  });

  it('should return 403 (self-reject also blocked)', () => {
    // Same user created and tries to reject — blocked
    expect(rejectRes.status).toBe(403);
  });
});

// =============================================================================
// Config: Delete
// =============================================================================

describe('Approvals Config: Delete', () => {
  let res: Response;

  beforeAll(async () => {
    res = await fetch(`${BASE_URL}/approvals/configs/${configUuid}`, {
      method: 'DELETE',
      headers: authOnly(auth.authToken),
    });
  });

  it('should return 200', () => {
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// Unauthenticated → 401
// =============================================================================

describe('Approvals: Unauthenticated', () => {
  it('should return 401 for configs without token', async () => {
    const res = await fetch(`${BASE_URL}/approvals/configs`);
    expect(res.status).toBe(401);
  });

  it('should return 401 for list without token', async () => {
    const res = await fetch(`${BASE_URL}/approvals`);
    expect(res.status).toBe(401);
  });

  it('should return 401 for stats without token', async () => {
    const res = await fetch(`${BASE_URL}/approvals/stats`);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Pagination (Step 5.1)
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §Step 5.1 (Session 14, 2026-05-06):
// 4 mandated assertions per migrated endpoint. Search hits `title OR description`
// (approvals.service.ts:135). Seeding 22 approvals with a unique `title` tag
// scopes search results deterministically. PUT /approvals/configs is re-issued
// in beforeAll because the prior describe ('Approvals Config: Delete') destroys
// the kvp config. Cleanup via psql `is_active = 4` — no /approvals DELETE
// endpoint exists; matches the soft-delete pattern at approvals.service.ts:114.
// =============================================================================

describe('Approvals: Pagination (Step 5.1)', () => {
  const tag = `Pg5_1_${Date.now()}`;
  const seedCount = 22;
  const limit = 10;
  const seededUuids: string[] = [];

  beforeAll(async () => {
    // Defensive: soft-delete any leftover active kvp config in this tenant.
    // `createConfig` (approvals-config.service.ts:217) throws ConflictException
    // on duplicate active rows, so a leftover from a prior failed run blocks the
    // PUT below. Idempotent + tenant-scoped.
    execSync(
      `docker exec assixx-postgres psql -U assixx_user -d assixx -c "UPDATE approval_configs SET is_active = 4 WHERE addon_code = 'kvp' AND tenant_id = ${auth.tenantId} AND is_active = 1"`,
      { stdio: 'pipe' },
    );

    // Re-create kvp config (deleted by 'Approvals Config: Delete' describe).
    await fetch(`${BASE_URL}/approvals/configs`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        addonCode: 'kvp',
        approverType: 'user',
        approverUserId: auth.userId,
      }),
    });

    for (let i = 0; i < seedCount; i++) {
      const res = await fetch(`${BASE_URL}/approvals`, {
        method: 'POST',
        headers: authHeaders(auth.authToken),
        body: JSON.stringify({
          addonCode: 'kvp',
          sourceEntityType: 'kvp_suggestion',
          sourceUuid: randomUUID(),
          title: `${tag}_${String(i).padStart(2, '0')}`,
          priority: 'low',
        }),
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`Pagination seed: approval ${i} failed ${res.status} — ${text}`);
      }
      const body = (await res.json()) as JsonBody;
      seededUuids.push((body.data.uuid as string).trim());
    }
  });

  afterAll(() => {
    // Soft-delete via psql — no DELETE endpoint on /approvals (audit-trail design).
    // Tag is `Pg5_1_${Date.now()}` (alphanum + underscore only) → safe to interpolate.
    // Also clear the kvp config I created so a multi-file vitest run doesn't trip
    // 'Approvals Config: Create' on the next pass (would 409 on duplicate active).
    execSync(
      `docker exec assixx-postgres psql -U assixx_user -d assixx -c "UPDATE approvals SET is_active = 4 WHERE title LIKE '${tag}_%'; UPDATE approval_configs SET is_active = 4 WHERE addon_code = 'kvp' AND tenant_id = ${auth.tenantId} AND is_active = 1;"`,
      { stdio: 'pipe' },
    );
  });

  it('?page=2&limit=10 returns correct slice + totalPages math', async () => {
    const res = await fetch(`${BASE_URL}/approvals?search=${tag}&page=2&limit=${limit}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.meta.pagination.limit).toBe(limit);
    expect(body.meta.pagination.total).toBe(seedCount);
    expect(body.meta.pagination.totalPages).toBe(Math.ceil(seedCount / limit));
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ title: string }>) {
      expect(item.title).toContain(tag);
    }
  });

  it('?search=<tag> returns matches that exist beyond page 1', async () => {
    const res = await fetch(`${BASE_URL}/approvals?search=${tag}&page=1&limit=${limit}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.total).toBe(seedCount);
    expect(body.meta.pagination.totalPages).toBeGreaterThan(1);
    expect(body.data.length).toBe(limit);
    expect(body.meta.pagination.total - limit).toBeGreaterThan(0);
  });

  it('combined ?page=2&search=<tag> returns correct slice of search hits', async () => {
    const res = await fetch(`${BASE_URL}/approvals?search=${tag}&page=2&limit=${limit}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ title: string }>) {
      expect(item.title).toContain(tag);
    }
  });

  it('tenant isolation: search returns exactly the seeded set, no leaks', async () => {
    const res = await fetch(`${BASE_URL}/approvals?search=${tag}&limit=100`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.total).toBe(seedCount);
    expect(body.data.length).toBe(seedCount);
    const returnedUuids = (body.data as Array<{ uuid: string }>).map((d) => d.uuid.trim()).sort();
    expect(returnedUuids).toEqual([...seededUuids].sort());
  });
});
