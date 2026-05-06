/**
 * Users API Integration Tests
 *
 * Runs against REAL backend (Docker must be running).
 *
 * @see vitest.config.api.ts
 */
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

// ---- seq: 1 -- Get Current User (me) ----------------------------------------

describe('Users: Get Current User (me)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/users/me`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return user data with required properties', async () => {
    const res = await fetch(`${BASE_URL}/users/me`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('email');
    expect(body.data).toHaveProperty('role');
    expect(body.data).toHaveProperty('firstName');
    expect(body.data).toHaveProperty('lastName');
  });

  it('should not expose password', async () => {
    const res = await fetch(`${BASE_URL}/users/me`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).not.toHaveProperty('password');
  });

  it('should return tenant info', async () => {
    const res = await fetch(`${BASE_URL}/users/me`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('tenantId');
  });

  it('should have correct field types from assertions', async () => {
    const res = await fetch(`${BASE_URL}/users/me`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data.id).toBeTypeOf('number');
    expect(body.data.email).toBeTypeOf('string');
  });
});

// ---- seq: 2 -- List Users (Admin) -------------------------------------------

describe('Users: List Users (Admin)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/users?page=1&limit=10`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return array of users', async () => {
    const res = await fetch(`${BASE_URL}/users?page=1&limit=10`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should return pagination info', async () => {
    const res = await fetch(`${BASE_URL}/users?page=1&limit=10`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    // Canonical ADR-007 envelope keys (Phase 4.1a, masterplan §D4) — was previously
    // currentPage/pageSize/totalItems before the /users → ADR-007 envelope rename.
    expect(body.meta).toHaveProperty('pagination');
    expect(body.meta.pagination).toHaveProperty('page');
    expect(body.meta.pagination).toHaveProperty('limit');
    expect(body.meta.pagination).toHaveProperty('total');
    expect(body.meta.pagination).toHaveProperty('totalPages');
  });
});

// ---- seq: 3 -- Get User by ID (Admin) ---------------------------------------

describe('Users: Get User by ID (Admin)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/users/${auth.userId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return user object with correct field types', async () => {
    const res = await fetch(`${BASE_URL}/users/${auth.userId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('email');
    expect(body.data).toHaveProperty('role');
    expect(body.data.id).toBeTypeOf('number');
  });
});

// ---- seq: 4 -- Create User with positionIds ---------------------------------

describe('Users: Create with positionIds', () => {
  let positionId: string;
  let createdUserId: number;
  const testEmail = `pos-test-${Date.now()}@assixx.com`;

  beforeAll(async () => {
    // Fetch available employee positions
    const res = await fetch(`${BASE_URL}/organigram/positions?roleCategory=employee`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;
    const positions = body.data as { id: string }[];
    if (positions[0] === undefined) throw new Error('No employee positions found');
    positionId = positions[0].id;
  });

  afterAll(async () => {
    // Cleanup: soft-delete created user
    if (createdUserId !== undefined) {
      await fetch(`${BASE_URL}/users/${createdUserId}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  });

  it('should create employee with positionIds', async () => {
    const res = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPass123!',
        firstName: 'Position',
        lastName: 'TestUser',
        role: 'employee',
        positionIds: [positionId],
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    createdUserId = body.data.id as number;
  });

  it('should persist positions in user_positions', async () => {
    const res = await fetch(`${BASE_URL}/users/${createdUserId}/positions`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    const positions = body.data as { positionId: string }[];
    expect(positions).toHaveLength(1);
    expect(positions[0]?.positionId).toBe(positionId);
  });

  it('should reject create without positionIds', async () => {
    const res = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        email: `no-pos-${Date.now()}@assixx.com`,
        password: 'TestPass123!',
        firstName: 'No',
        lastName: 'Position',
        role: 'employee',
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ---- seq: 5 -- Update User positionIds --------------------------------------

describe('Users: Update positionIds', () => {
  let positionIds: string[];
  let targetUserId: number;
  const testEmail = `pos-upd-${Date.now()}@assixx.com`;

  beforeAll(async () => {
    // Fetch 2 employee positions
    const posRes = await fetch(`${BASE_URL}/organigram/positions?roleCategory=employee`, {
      headers: authOnly(auth.authToken),
    });
    const posBody = (await posRes.json()) as JsonBody;
    positionIds = (posBody.data as { id: string }[]).slice(0, 2).map((p: { id: string }) => p.id);

    // Create a user to update
    const createRes = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPass123!',
        firstName: 'Update',
        lastName: 'PosTest',
        role: 'employee',
        positionIds: [positionIds[0]],
      }),
    });
    const createBody = (await createRes.json()) as JsonBody;
    targetUserId = createBody.data.id as number;
  });

  afterAll(async () => {
    if (targetUserId !== undefined) {
      await fetch(`${BASE_URL}/users/${targetUserId}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  });

  it('should update positions via PUT', async () => {
    const res = await fetch(`${BASE_URL}/users/${targetUserId}`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ positionIds: positionIds.slice(0, 2) }),
    });

    expect(res.status).toBe(200);
  });

  it('should reflect updated positions', async () => {
    const res = await fetch(`${BASE_URL}/users/${targetUserId}/positions`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    const assigned = (body.data as { positionId: string }[]).map(
      (p: { positionId: string }) => p.positionId,
    );
    expect(assigned.sort()).toEqual(positionIds.slice(0, 2).sort());
  });
});

// ---- seq: 6 -- Get User Profile (permission-gated) ----------------------------

describe('Users: Get User Profile', () => {
  let targetUuid: string;

  beforeAll(async () => {
    const meRes = await fetch(`${BASE_URL}/users/me`, {
      headers: authOnly(auth.authToken),
    });
    const meBody = (await meRes.json()) as JsonBody;
    targetUuid = (meBody.data as { uuid: string }).uuid;
  });

  it('should return 200 for own profile via /users/profile/:uuid', async () => {
    const res = await fetch(`${BASE_URL}/users/profile/${targetUuid}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return user data with required properties', async () => {
    const res = await fetch(`${BASE_URL}/users/profile/${targetUuid}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;
    const user = body.data as Record<string, unknown>;

    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('uuid');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('firstName');
  });
});

// ---- seq: 7 -- Pagination (Step 5.1) ----------------------------------------
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §Step 5.1 (Session 14, 2026-05-06):
// 4 mandated assertions per migrated endpoint. /users search hits
// `first_name OR last_name OR email` (users.helpers.ts:182). Seeding 22
// employees with a unique `lastName` tag scopes search results deterministically.
// Cleanup via DELETE /users/:id (soft-delete is_active=DELETED), mirrors the
// existing 'Users: Create with positionIds' afterAll pattern (lines 160-167).

describe('Users: Pagination (Step 5.1)', () => {
  const tag = `Pg5_1_${Date.now()}`;
  const seedCount = 22;
  const limit = 10;
  const seededIds: number[] = [];
  let positionId: string;

  beforeAll(async () => {
    // Resolve employee position UUID (FK requirement on POST /users, line 156).
    const posRes = await fetch(`${BASE_URL}/organigram/positions?roleCategory=employee`, {
      headers: authOnly(auth.authToken),
    });
    const posBody = (await posRes.json()) as JsonBody;
    const positions = posBody.data as { id: string }[];
    if (positions[0] === undefined) throw new Error('No employee positions found');
    positionId = positions[0].id;

    for (let i = 0; i < seedCount; i++) {
      const res = await fetch(`${BASE_URL}/users`, {
        method: 'POST',
        headers: authHeaders(auth.authToken),
        body: JSON.stringify({
          email: `pgtest_${tag}_${String(i).padStart(2, '0')}@assixx.com`,
          password: 'TestPass123!',
          firstName: 'PgTest',
          lastName: `${tag}_${String(i).padStart(2, '0')}`,
          role: 'employee',
          positionIds: [positionId],
        }),
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`Pagination seed: user ${i} failed ${res.status} — ${text}`);
      }
      const body = (await res.json()) as JsonBody;
      seededIds.push(body.data.id as number);
    }
  });

  afterAll(async () => {
    for (const id of seededIds) {
      await fetch(`${BASE_URL}/users/${id}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  });

  it('?page=2&limit=10 returns correct slice + totalPages math', async () => {
    const res = await fetch(`${BASE_URL}/users?search=${tag}&page=2&limit=${limit}`, {
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
    for (const item of body.data as Array<{ lastName: string }>) {
      expect(item.lastName).toContain(tag);
    }
  });

  it('?search=<tag> returns matches that exist beyond page 1', async () => {
    const res = await fetch(`${BASE_URL}/users?search=${tag}&page=1&limit=${limit}`, {
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
    const res = await fetch(`${BASE_URL}/users?search=${tag}&page=2&limit=${limit}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ lastName: string }>) {
      expect(item.lastName).toContain(tag);
    }
  });

  it('tenant isolation: search returns exactly the seeded set, no leaks', async () => {
    const res = await fetch(`${BASE_URL}/users?search=${tag}&limit=100`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.total).toBe(seedCount);
    expect(body.data.length).toBe(seedCount);
    const returnedIds = (body.data as Array<{ id: number }>).map((d) => d.id).sort((a, b) => a - b);
    const expectedIds = [...seededIds].sort((a, b) => a - b);
    expect(returnedIds).toEqual(expectedIds);
  });
});
