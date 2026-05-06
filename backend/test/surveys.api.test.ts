/**
 * Surveys API Integration Tests
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

/** ID of the first survey found in the list (fallback for get-by-id). */
let existingSurveyId: number | undefined;

/** ID of the survey created during the test run. */
let createdSurveyId: number | undefined;

/** Resolved survey ID used by downstream tests. */
let surveyId: number | undefined;

beforeAll(async () => {
  auth = await loginApitest();
});

// ---- seq: 1 -- List Surveys ---------------------------------------------------

describe('Surveys: List Surveys', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/surveys`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return surveys array', async () => {
    const res = await fetch(`${BASE_URL}/surveys`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(Array.isArray(body.data)).toBe(true);

    // Capture existing survey ID for later use as fallback
    if (Array.isArray(body.data) && body.data.length > 0) {
      existingSurveyId = body.data[0].id as number;
    }
  });

  // Phase 4.10a (2026-05-06) — §D15 broken-by-shape rebuild assertions.
  // Pre-rebuild: controller returned `Promise<unknown[]>` and the response
  // interceptor wrapped as `{success, data: Survey[]}` with no `meta.pagination`.
  // Post-rebuild: controller returns `{items, pagination}`, interceptor extracts
  // `items` to top-level `data` and `pagination` to `meta.pagination`. The wire
  // `data` field is unchanged shape (still `Survey[]`); only `meta.pagination` is
  // new. Existing `(shared)/surveys/+page.server.ts` consumer continues to work
  // unchanged (reads `data` as flat array). Mirrors KVP §D9 + work-orders §D15
  // canonical-envelope assertions.

  it('should ship canonical pagination envelope (page, limit, total, totalPages)', async () => {
    const res = await fetch(`${BASE_URL}/surveys`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.meta).toBeDefined();
    expect(body.meta?.pagination).toMatchObject({
      page: expect.any(Number),
      limit: expect.any(Number),
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
    // Default page=1 + limit=10 — DTO PaginationSchema sets limit=10 (common.schema.ts);
    // the service-level `?? 20` fallback in listSurveys is dead-code defensive (DTO
    // always injects a value before the service runs). Service-default 20 only fires
    // when the service is called directly (e.g. unit tests bypassing the DTO pipe).
    expect(body.meta?.pagination.page).toBe(1);
    expect(body.meta?.pagination.limit).toBe(10);
  });

  it('should respect ?page=1&limit=5 and emit correct pagination math', async () => {
    const res = await fetch(`${BASE_URL}/surveys?page=1&limit=5`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    // Slice cap matches limit (regardless of how many surveys exist in tenant)
    expect((body.data as unknown[]).length).toBeLessThanOrEqual(5);
    expect(body.meta?.pagination.page).toBe(1);
    expect(body.meta?.pagination.limit).toBe(5);
    // totalPages = ceil(total/5) when total > 0; 0 when total === 0.
    const total = body.meta?.pagination.total as number;
    const totalPages = body.meta?.pagination.totalPages as number;
    expect(totalPages).toBe(total === 0 ? 0 : Math.ceil(total / 5));
  });
});

// ---- seq: 2 -- Create Survey (Admin) ------------------------------------------

describe('Surveys: Create Survey (Admin)', () => {
  it('should return 201 Created', async () => {
    const res = await fetch(`${BASE_URL}/surveys`, {
      method: 'POST',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({
        title: `API Test ${Date.now()}`,
        description: 'Created via API test - will be deleted',
        status: 'draft',
        questions: [
          {
            questionText: 'Test question?',
            questionType: 'rating',
            isRequired: true,
          },
        ],
      }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);

    // Store created survey ID for downstream tests
    if (body.data?.id) {
      surveyId = body.data.id as number;
      createdSurveyId = body.data.id as number;
    }
  });
});

// ---- seq: 3 -- Get Survey by ID -----------------------------------------------

describe('Surveys: Get Survey by ID', () => {
  it('should return 200 OK', async () => {
    const id = surveyId ?? existingSurveyId;
    expect(id).toBeDefined();

    const res = await fetch(`${BASE_URL}/surveys/${id}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return survey object with questions', async () => {
    const id = surveyId ?? existingSurveyId;
    expect(id).toBeDefined();

    const res = await fetch(`${BASE_URL}/surveys/${id}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('title');
  });
});

// ---- seq: 3 -- Get Survey Templates -------------------------------------------

describe('Surveys: Get Survey Templates', () => {
  it('should return 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/surveys/templates`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should return templates array', async () => {
    const res = await fetch(`${BASE_URL}/surveys/templates`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ---- seq: 5 -- Get Survey Statistics (Admin) ----------------------------------

describe('Surveys: Get Survey Statistics (Admin)', () => {
  it('should return 200 OK', async () => {
    const id = surveyId ?? existingSurveyId;
    expect(id).toBeDefined();

    const res = await fetch(`${BASE_URL}/surveys/${id}/statistics`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ---- seq: 6 -- Get My Survey Response -----------------------------------------

describe('Surveys: Get My Survey Response', () => {
  it('should return 200 OK or 404 (no response yet)', async () => {
    const id = surveyId ?? existingSurveyId;
    expect(id).toBeDefined();

    const res = await fetch(`${BASE_URL}/surveys/${id}/my-response`, {
      headers: authOnly(auth.authToken),
    });

    expect([200, 404]).toContain(res.status);
  });
});

// ---- seq: 7 -- Delete Survey (Admin) ------------------------------------------

describe('Surveys: Delete Survey (Admin)', () => {
  it('should return 200 OK', async () => {
    // Only delete the survey we created during this test run
    expect(createdSurveyId).toBeDefined();

    const res = await fetch(`${BASE_URL}/surveys/${createdSurveyId}`, {
      method: 'DELETE',
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // Clear created survey ID, fall back to existing
    createdSurveyId = undefined;
    surveyId = existingSurveyId;
  });
});

// ---- seq: 8 -- Pagination (Step 5.1) ----------------------------------------
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §Step 5.1 (Session 14b, 2026-05-06):
// 4 mandated assertions per migrated endpoint (slice / cross-page search /
// combined / RLS sanity), mirroring Session 14a (dummy-users/users/assets/approvals).
// Search column: `s.title OR s.description` (survey-access.service.ts:412 et al.,
// Phase 1.2a-B Stage B-1, 2026-05-02). Seeding 22 surveys with a unique `title`
// tag scopes search results deterministically; 22 = 2 × limit + 2 guarantees
// totalPages >= 3 so test #2's "matches beyond page 1" claim is structural.
describe('Surveys: Pagination (Step 5.1)', () => {
  const tag = `Pg5_1_${Date.now()}`;
  const seedCount = 22;
  const limit = 10;
  const seededIds: number[] = [];

  beforeAll(async () => {
    for (let i = 0; i < seedCount; i++) {
      const res = await fetch(`${BASE_URL}/surveys`, {
        method: 'POST',
        headers: authHeaders(auth.authToken),
        body: JSON.stringify({
          title: `${tag}_${String(i).padStart(2, '0')}`,
          description: 'Pagination seed — deleted by afterAll',
          status: 'draft',
          questions: [
            {
              questionText: 'Test question?',
              questionType: 'rating',
              isRequired: true,
            },
          ],
        }),
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`Pagination seed: survey ${i} failed ${res.status} — ${text}`);
      }
      const body = (await res.json()) as JsonBody;
      seededIds.push(body.data.id as number);
    }
  });

  afterAll(async () => {
    for (const id of seededIds) {
      await fetch(`${BASE_URL}/surveys/${id}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  });

  // `?status=draft` is required so the seeded drafts are in scope of the
  // visibility filter — see survey-access.service.ts. Without it the listSurveys
  // default visibility scope drops drafts authored by other users.
  it('?page=2&limit=10 returns correct slice + totalPages math', async () => {
    const res = await fetch(
      `${BASE_URL}/surveys?status=draft&search=${tag}&page=2&limit=${limit}`,
      {
        headers: authOnly(auth.authToken),
      },
    );
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
    const res = await fetch(
      `${BASE_URL}/surveys?status=draft&search=${tag}&page=1&limit=${limit}`,
      {
        headers: authOnly(auth.authToken),
      },
    );
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.total).toBe(seedCount);
    expect(body.meta.pagination.totalPages).toBeGreaterThan(1);
    expect(body.data.length).toBe(limit);
    expect(body.meta.pagination.total - limit).toBeGreaterThan(0);
  });

  it('combined ?page=2&search=<tag> returns correct slice of search hits', async () => {
    const res = await fetch(
      `${BASE_URL}/surveys?status=draft&search=${tag}&page=2&limit=${limit}`,
      {
        headers: authOnly(auth.authToken),
      },
    );
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    expect(body.meta.pagination.page).toBe(2);
    expect(body.data.length).toBe(limit);
    for (const item of body.data as Array<{ title: string }>) {
      expect(item.title).toContain(tag);
    }
  });

  it('tenant isolation: search returns exactly the seeded set, no leaks', async () => {
    const res = await fetch(`${BASE_URL}/surveys?status=draft&search=${tag}&limit=100`, {
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
