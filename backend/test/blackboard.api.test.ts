/**
 * Blackboard API Integration Tests
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

// Module-level state shared across sequential describe blocks
let blackboardEntryId: number;
let existingBlackboardId: number;

beforeAll(async () => {
  auth = await loginApitest();
});

// ─── List Blackboard Entries (seq: 1) ───────────────────────────────────────

describe('List Blackboard Entries', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return entries array', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toBeInstanceOf(Array);

    // Store first existing entry ID for fallback after delete
    if (body.data.length > 0) {
      existingBlackboardId = body.data[0].id;
    }
  });

  it('should return pagination info', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.meta.pagination).toBeTypeOf('object');
  });
});

// ─── Create Blackboard Entry (seq: 2) ───────────────────────────────────────

describe('Create Blackboard Entry (Admin)', () => {
  it('should return 201 Created', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        title: `API Test ${Date.now()}`,
        content: 'Created via API test - will be deleted',
        priority: 'medium',
        orgLevel: 'company',
        requiresConfirmation: false,
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
  });

  it('should return created entry', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        title: `API Test ${Date.now()}`,
        content: 'Created via API test - will be deleted',
        priority: 'medium',
        orgLevel: 'company',
        requiresConfirmation: false,
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('id');
    expect(body.data.title).toContain('API Test');

    // Store created entry ID for subsequent tests
    if (body.data?.id) {
      blackboardEntryId = body.data.id;
    }
  });
});

// ─── Get Blackboard Entry (seq: 2) ──────────────────────────────────────────

describe('Get Blackboard Entry', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return entry object', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('title');
  });
});

// ─── Get Entry Full (seq: 3) ────────────────────────────────────────────────

describe('Get Entry Full (with comments and attachments)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}/full`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return entry with comments and attachments', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}/full`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('entry');
    expect(body.data).toHaveProperty('comments');
    expect(body.data).toHaveProperty('attachments');
  });
});

// ─── Update Blackboard Entry (seq: 5) ───────────────────────────────────────

describe('Update Blackboard Entry (Admin)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        title: 'Updated Announcement',
        content: 'Updated content via API test',
        priority: 'high',
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ─── Confirm Entry (seq: 6) ─────────────────────────────────────────────────

describe('Confirm Entry (Mark as Read)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}/confirm`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ─── Get Entry Comments (seq: 7) ────────────────────────────────────────────

describe('Get Entry Comments', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}/comments`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return paginated comments', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}/comments`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('comments');
    expect(Array.isArray(body.data.comments)).toBe(true);
    expect(body.data).toHaveProperty('total');
    expect(body.data).toHaveProperty('hasMore');
  });
});

// ─── Add Comment to Entry (seq: 8) ──────────────────────────────────────────

describe('Add Comment to Entry', () => {
  it('should return 201 Created', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}/comments`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        comment: 'This is a test comment from API integration test.',
        isInternal: false,
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
  });
});

// ─── Get Dashboard Entries (seq: 9) ─────────────────────────────────────────

describe('Get Dashboard Entries', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/dashboard`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return dashboard entries', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/dashboard`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toBeInstanceOf(Array);
  });
});

// ─── Archive Entry (seq: 10) ────────────────────────────────────────────────

describe('Archive Entry (Admin)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}/archive`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ─── Delete Entry (seq: 11) ─────────────────────────────────────────────────

describe('Delete Entry (Admin)', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries/${blackboardEntryId}`, {
      method: 'DELETE',
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // Reset created ID; fall back to existing entry for future use
    if (existingBlackboardId) {
      blackboardEntryId = existingBlackboardId;
    }
  });
});

// ─── Pagination (seq: 12, Step 5.1) ─────────────────────────────────────────
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §Step 5.1 (Session 14b, 2026-05-06):
// 4 mandated assertions per migrated endpoint (slice / cross-page search /
// combined / RLS sanity), mirroring Session 14a (dummy-users/users/assets/approvals).
// Search column: `e.title OR e.content` (blackboard-entries.service.ts:164).
// Seeding 22 entries with a unique `title` tag scopes search results
// deterministically; 22 = 2 × limit + 2 guarantees totalPages >= 3, so the
// "matches beyond page 1" assertion is structural, not coincidental.
describe('Blackboard: Pagination (Step 5.1)', () => {
  const tag = `Pg5_1_${Date.now()}`;
  const seedCount = 22;
  const limit = 10;
  const seededIds: number[] = [];

  beforeAll(async () => {
    for (let i = 0; i < seedCount; i++) {
      const res = await fetch(`${BASE_URL}/blackboard/entries`, {
        method: 'POST',
        headers: authHeaders(auth.authToken),
        body: JSON.stringify({
          title: `${tag}_${String(i).padStart(2, '0')}`,
          content: 'Pagination seed — deleted by afterAll',
          priority: 'medium',
          orgLevel: 'company',
          requiresConfirmation: false,
        }),
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`Pagination seed: blackboard ${i} failed ${res.status} — ${text}`);
      }
      const body = (await res.json()) as JsonBody;
      seededIds.push(body.data.id as number);
    }
  });

  afterAll(async () => {
    for (const id of seededIds) {
      await fetch(`${BASE_URL}/blackboard/entries/${id}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  });

  it('?page=2&limit=10 returns correct slice + totalPages math', async () => {
    const res = await fetch(`${BASE_URL}/blackboard/entries?search=${tag}&page=2&limit=${limit}`, {
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
    const res = await fetch(`${BASE_URL}/blackboard/entries?search=${tag}&page=1&limit=${limit}`, {
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
    const res = await fetch(`${BASE_URL}/blackboard/entries?search=${tag}&page=2&limit=${limit}`, {
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
    const res = await fetch(`${BASE_URL}/blackboard/entries?search=${tag}&limit=100`, {
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
