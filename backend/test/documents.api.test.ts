/**
 * Documents API Integration Tests
 *
 * Runs against REAL backend (Docker must be running).
 *
 * @see vitest.config.api.ts
 */
import { type AuthState, BASE_URL, type JsonBody, authOnly, loginApitest } from './helpers.js';

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
