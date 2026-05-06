/**
 * Assets API Integration Tests
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

// Shared state across sequential describe blocks
let assetId: number;
let _existingAssetId: number;
let _createdAssetId: number;

beforeAll(async () => {
  auth = await loginApitest();
});

// ---- seq: 1 -- List Assets -------------------------------------------------

describe('Assets: List', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return assets array', async () => {
    const res = await fetch(`${BASE_URL}/assets`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(Array.isArray(body.data)).toBe(true);

    // Store first existing asset ID for fallback after delete
    if (body.data.length > 0) {
      _existingAssetId = body.data[0].id;
    }
  });

  // Canonical ADR-007 envelope assertion — masterplan §4.4a (Session 7c, 2026-05-05).
  // ResponseInterceptor lifts service `{items, pagination}` → `body.data` / `body.meta.pagination`.
  // Mirrors dummy-users (Phase 3.1) / users (Phase 4.1a) / approvals (Phase 4.3a) tests.
  it('should return canonical ADR-007 envelope (page/limit/total/totalPages)', async () => {
    const res = await fetch(`${BASE_URL}/assets`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
    expect(body.meta.pagination).toBeDefined();
    expect(typeof body.meta.pagination.page).toBe('number');
    expect(typeof body.meta.pagination.limit).toBe('number');
    expect(typeof body.meta.pagination.total).toBe('number');
    expect(typeof body.meta.pagination.totalPages).toBe('number');
  });
});

// ---- seq: 2 -- Create Asset (Admin) ----------------------------------------

describe('Assets: Create (Admin)', () => {
  it('should return 201 Created', async () => {
    const res = await fetch(`${BASE_URL}/assets`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        name: `API Test ${Date.now()}`,
        model: 'TM-001',
        manufacturer: 'Test Corp',
        assetType: 'production',
        status: 'operational',
        location: 'Test Location',
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);

    // Store created asset ID for subsequent tests
    if (body.data?.id) {
      assetId = body.data.id;
      _createdAssetId = body.data.id;
    }
  });
});

// ---- seq: 3 -- Get Asset by ID --------------------------------------------

describe('Assets: Get by ID', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets/${assetId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return asset object with id and name', async () => {
    const res = await fetch(`${BASE_URL}/assets/${assetId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('name');
  });
});

// ---- seq: 4 -- Update Asset (Admin) ----------------------------------------

describe('Assets: Update (Admin)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets/${assetId}`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        name: 'Updated Asset Name',
        status: 'maintenance',
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ---- seq: 5 -- Get Asset Statistics ----------------------------------------

describe('Assets: Statistics', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets/statistics`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return statistics with totalAssets', async () => {
    const res = await fetch(`${BASE_URL}/assets/statistics`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('totalAssets');
  });
});

// ---- seq: 6 -- Get Asset Categories ----------------------------------------

describe('Assets: Categories', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets/categories`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return categories array', async () => {
    const res = await fetch(`${BASE_URL}/assets/categories`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ---- seq: 7 -- Get Upcoming Maintenance --------------------------------------

describe('Assets: Upcoming Maintenance', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets/upcoming-maintenance`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return assets needing maintenance', async () => {
    const res = await fetch(`${BASE_URL}/assets/upcoming-maintenance`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ---- seq: 8 -- Get Maintenance History ---------------------------------------

describe('Assets: Maintenance History', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets/${assetId}/maintenance`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return maintenance history array', async () => {
    const res = await fetch(`${BASE_URL}/assets/${assetId}/maintenance`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ---- seq: 9 -- Delete Asset (Admin) ----------------------------------------

describe('Assets: Delete (Admin)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/assets/${assetId}`, {
      method: 'DELETE',
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // Clear created ID and fall back to existing asset
    _createdAssetId = 0;
    if (_existingAssetId) {
      assetId = _existingAssetId;
    }
  });
});

// ---- seq: 10 -- Pagination (Step 5.1) ---------------------------------------
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §Step 5.1 (Session 14, 2026-05-06):
// 4 mandated assertions per migrated endpoint (slice / search beyond page 1 /
// combined / RLS sanity). Search hits `name OR model OR manufacturer OR
// serial_number OR asset_number` (assets.helpers.ts:72). Seeding 22 assets
// with a unique `name` tag scopes search results deterministically.
describe('Assets: Pagination (Step 5.1)', () => {
  const tag = `Pg5_1_${Date.now()}`;
  const seedCount = 22;
  const limit = 10;
  const seededIds: number[] = [];

  beforeAll(async () => {
    for (let i = 0; i < seedCount; i++) {
      const res = await fetch(`${BASE_URL}/assets`, {
        method: 'POST',
        headers: authHeaders(auth.authToken),
        body: JSON.stringify({
          name: `${tag}_${String(i).padStart(2, '0')}`,
          assetType: 'production',
          status: 'operational',
        }),
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`Pagination seed: asset ${i} failed ${res.status} — ${text}`);
      }
      const body = (await res.json()) as JsonBody;
      seededIds.push(body.data.id as number);
    }
  });

  afterAll(async () => {
    for (const id of seededIds) {
      await fetch(`${BASE_URL}/assets/${id}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  });

  it('?page=2&limit=10 returns correct slice + totalPages math', async () => {
    const res = await fetch(`${BASE_URL}/assets?search=${tag}&page=2&limit=${limit}`, {
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
    for (const item of body.data as Array<{ name: string }>) {
      expect(item.name).toContain(tag);
    }
  });

  it('?search=<tag> returns matches that exist beyond page 1', async () => {
    const res = await fetch(`${BASE_URL}/assets?search=${tag}&page=1&limit=${limit}`, {
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
    const res = await fetch(`${BASE_URL}/assets?search=${tag}&page=2&limit=${limit}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ name: string }>) {
      expect(item.name).toContain(tag);
    }
  });

  it('tenant isolation: search returns exactly the seeded set, no leaks', async () => {
    const res = await fetch(`${BASE_URL}/assets?search=${tag}&limit=100`, {
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
