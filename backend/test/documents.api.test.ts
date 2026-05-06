/**
 * Documents API Integration Tests
 *
 * Runs against REAL backend (Docker must be running).
 *
 * @see vitest.config.api.ts
 */
import { type AuthState, BASE_URL, type JsonBody, authOnly, loginApitest } from './helpers.js';

/**
 * Auth header for multipart/form-data upload — explicit because `authHeaders`
 * forces `Content-Type: application/json` which would break Multipart parsing.
 * Mirrors `work-orders.api.test.ts:226` upload pattern.
 */
function authBearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

let auth: AuthState;

beforeAll(async () => {
  auth = await loginApitest();
});

// ---- seq: 1 -- List Documents -------------------------------------------------

describe('Documents: List Documents', () => {
  it('should return 200 OK with canonical ADR-007 envelope (data: array, meta.pagination)', async () => {
    // §D9 / §D18 (Phase 4.9a, 2026-05-06): wrapper key renamed `documents` → `items`
    // so ResponseInterceptor.isPaginatedResponse() recognises the shape and emits
    // the canonical envelope. Pre-rename, body.data was `{ documents, pagination }`
    // and meta.pagination was never emitted.
    const res = await fetch(`${BASE_URL}/documents`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta?.pagination).toEqual(
      expect.objectContaining({
        page: expect.any(Number),
        limit: expect.any(Number),
        total: expect.any(Number),
        totalPages: expect.any(Number),
      }),
    );
  });

  it('should echo ?page=2&limit=5 with correct totalPages math', async () => {
    // Mirrors Session 4 / dummy-users canonical-envelope verification
    // (masterplan changelog 1.7.0). totalPages = ceil(total / limit) on a non-empty
    // result; 0 on an empty tenant — both cases tolerated by the math expression.
    const res = await fetch(`${BASE_URL}/documents?page=2&limit=5`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    const pg = body.meta?.pagination as {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    expect(pg.page).toBe(2);
    expect(pg.limit).toBe(5);
    expect(pg.totalPages).toBe(pg.total === 0 ? 0 : Math.ceil(pg.total / 5));
  });

  it('should accept ?sort=name without error (Phase 4.9a / §D18)', async () => {
    const res = await fetch(`${BASE_URL}/documents?sort=name`, {
      headers: authOnly(auth.authToken),
    });

    expect(res.status).toBe(200);
  });

  it('should reject ?sort=invalid with 400', async () => {
    const res = await fetch(`${BASE_URL}/documents?sort=random`, {
      headers: authOnly(auth.authToken),
    });

    expect(res.status).toBe(400);
  });
});

// ---- seq: 2 -- List Chat Folders ----------------------------------------------

describe('Documents: List Chat Folders', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/documents/chat-folders`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return chat folders array', async () => {
    const res = await fetch(`${BASE_URL}/documents/chat-folders`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data.folders).toBeDefined();
    expect(Array.isArray(body.data.folders)).toBe(true);
  });
});

// ---- seq: 3 -- Pagination (Step 5.1) ----------------------------------------
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §Step 5.1 (Session 14b, 2026-05-06):
// 4 mandated assertions per migrated endpoint (slice / cross-page search /
// combined / RLS sanity), mirroring Session 14a. Search columns:
// `d.filename OR d.original_name OR d.description` (document-access.service.ts:170).
// Tag is embedded in `documentName` (becomes filename) so search hits each
// seeded row deterministically. 22 = 2 × limit + 2 guarantees totalPages >= 3
// so test #2's "matches beyond page 1" claim is structural.
//
// Upload uses multipart/form-data: small in-memory text blob keeps the seed
// fast (5MB Multer cap is far above 22 × 1KB). Mirrors work-orders photo
// upload pattern (work-orders.api.test.ts:218). DELETE uses the deprecated
// `:id` route because `enrichDocument()` exposes `id` + `fileUuid` only —
// not the row-level `documents.uuid` column that `/documents/uuid/:uuid`
// expects (documents.helpers.ts:84). `accessScope=company` puts every
// seeded row in tenant-wide visibility regardless of owner.
describe('Documents: Pagination (Step 5.1)', () => {
  const tag = `Pg5_1_${Date.now()}`;
  const seedCount = 22;
  const limit = 10;
  const seededIds: number[] = [];

  beforeAll(async () => {
    for (let i = 0; i < seedCount; i++) {
      const form = new FormData();
      // application/pdf is in ALLOWED_MIME_TYPES (documents.helpers.ts:35);
      // text/plain is rejected. Mirrors work-orders fake-pdf upload pattern.
      const blob = new Blob(['%PDF-1.4 fake pagination seed content'], {
        type: 'application/pdf',
      });
      const filename = `${tag}_${String(i).padStart(2, '0')}.pdf`;
      form.append('document', blob, filename);
      form.append('documentName', filename);
      form.append('category', 'general');
      form.append('accessScope', 'company');
      form.append('description', 'Pagination seed — deleted by afterAll');

      const res = await fetch(`${BASE_URL}/documents`, {
        method: 'POST',
        headers: authBearer(auth.authToken),
        body: form,
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`Pagination seed: document ${i} failed ${res.status} — ${text}`);
      }
      const body = (await res.json()) as JsonBody;
      seededIds.push(body.data.id as number);
    }
  });

  afterAll(async () => {
    for (const id of seededIds) {
      await fetch(`${BASE_URL}/documents/${id}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  });

  it('?page=2&limit=10 returns correct slice + totalPages math', async () => {
    const res = await fetch(`${BASE_URL}/documents?search=${tag}&page=2&limit=${limit}`, {
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
    for (const item of body.data as Array<{ filename: string }>) {
      expect(item.filename).toContain(tag);
    }
  });

  it('?search=<tag> returns matches that exist beyond page 1', async () => {
    const res = await fetch(`${BASE_URL}/documents?search=${tag}&page=1&limit=${limit}`, {
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
    const res = await fetch(`${BASE_URL}/documents?search=${tag}&page=2&limit=${limit}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ filename: string }>) {
      expect(item.filename).toContain(tag);
    }
  });

  it('tenant isolation: search returns exactly the seeded set, no leaks', async () => {
    const res = await fetch(`${BASE_URL}/documents?search=${tag}&limit=100`, {
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
