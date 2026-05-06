/**
 * Department/Team Hall Hierarchy — 1:1 Strict Model API Tests (ADR-057)
 *
 * After migration 20260505221345432_simplify-department-hall-1to1, the M:N
 * `department_halls` and `team_halls` junctions were dropped in favour of:
 *
 * - `departments.hall_id` (1:1, NULLable, FK halls(id))
 * - DB trigger `trg_enforce_dept_hall_area_match` enforces
 *   `halls.area_id = departments.area_id` whenever `hall_id IS NOT NULL`.
 * - DB trigger `trg_prevent_hall_area_change_with_depts` blocks halls.area_id
 *   updates while a department references the hall.
 *
 * Validates:
 * 1. PUT /departments/:id/hall with same-area hall succeeds (200).
 * 2. PUT /departments/:id/hall with cross-area hall returns 400 (trigger).
 * 3. GET /departments/:id returns the assigned hall as `hall: { id, name, areaId }`.
 * 4. PUT /departments/:id/hall with `hallId: null` clears the assignment.
 * 5. Teams inherit the hall transitively from their parent department.
 * 6. Changing department.area_id requires the hall_id to be cleared first.
 *
 * @see docs/infrastructure/adr/ADR-057-department-hall-1to1-hierarchy.md
 * @see database/migrations/20260505221345432_simplify-department-hall-1to1.ts
 */
import {
  type AuthState,
  BASE_URL,
  type JsonBody,
  authHeaders,
  authOnly,
  loginApitest,
} from './helpers.js';

interface HallEntry {
  id: number;
  name: string;
  areaId: number | null;
}

interface DepartmentPayload {
  id: number;
  hall?: HallEntry | null;
  hallId?: number | null;
  hallName?: string | null;
  areaId?: number | null;
}

interface TeamPayload {
  id: number;
  hallId?: number | null;
  hallName?: string | null;
  departmentId?: number | null;
}

let auth: AuthState;

// Resources created for this test run — cleaned up in afterAll.
let areaAId: number;
let areaBId: number;
let hallAId: number; // sits in Area A
let hallBId: number; // sits in Area B (cross-area relative to Dept-in-A)
let deptId: number; // lives in Area A
let teamId: number; // child of dept

const ts = Date.now();

async function createOrFail(url: string, body: Record<string, unknown>): Promise<number> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(auth.authToken),
    body: JSON.stringify(body),
  });
  if (res.status !== 201) {
    const text = await res.text();
    throw new Error(`Setup failed: POST ${url} returned ${res.status.toString()}: ${text}`);
  }
  return ((await res.json()) as JsonBody).data.id as number;
}

beforeAll(async () => {
  auth = await loginApitest();

  areaAId = await createOrFail(`${BASE_URL}/areas`, {
    name: `HallHier Area A ${ts}`,
    type: 'building',
  });
  areaBId = await createOrFail(`${BASE_URL}/areas`, {
    name: `HallHier Area B ${ts}`,
    type: 'building',
  });
  hallAId = await createOrFail(`${BASE_URL}/halls`, {
    name: `HallHier Hall A ${ts}`,
    areaId: areaAId,
  });
  hallBId = await createOrFail(`${BASE_URL}/halls`, {
    name: `HallHier Hall B ${ts}`,
    areaId: areaBId,
  });
  deptId = await createOrFail(`${BASE_URL}/departments`, {
    name: `HallHier Dept ${ts}`,
    areaId: areaAId,
    description: 'Auto-created for hall-hierarchy 1:1 integration tests (ADR-057)',
  });
  teamId = await createOrFail(`${BASE_URL}/teams`, {
    name: `HallHier Team ${ts}`,
    departmentId: deptId,
  });
});

afterAll(async () => {
  // Clear hall_id first to avoid trigger conflicts when departments are re-parented during cleanup.
  if (deptId) {
    await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: null }),
    });
  }
  if (teamId) {
    await fetch(`${BASE_URL}/teams/${teamId}?force=true`, {
      method: 'DELETE',
      headers: authOnly(auth.authToken),
    });
  }
  if (deptId) {
    await fetch(`${BASE_URL}/departments/${deptId}?force=true`, {
      method: 'DELETE',
      headers: authOnly(auth.authToken),
    });
  }
  for (const hallId of [hallAId, hallBId]) {
    if (hallId) {
      await fetch(`${BASE_URL}/halls/${hallId}`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  }
  for (const areaId of [areaAId, areaBId]) {
    if (areaId) {
      await fetch(`${BASE_URL}/areas/${areaId}?force=true`, {
        method: 'DELETE',
        headers: authOnly(auth.authToken),
      });
    }
  }
});

// ----------------------------------------------------------------------------
// PUT /departments/:id/hall — same-area success path
// ----------------------------------------------------------------------------

describe('Department Hall (1:1): same-area assignment succeeds', () => {
  it('PUT /departments/:id/hall with Hall A (same area) returns 200', async () => {
    const res = await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: hallAId }),
    });
    expect(res.status).toBe(200);
  });

  it('GET /departments/:id reflects the assignment as `hall.id` and flat `hallId`', async () => {
    const res = await fetch(`${BASE_URL}/departments/${deptId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(200);
    const dept = body.data as DepartmentPayload;
    expect(dept.hallId).toBe(hallAId);
    expect(dept.hallName).toBeTruthy();
    expect(dept.hall?.id).toBe(hallAId);
    expect(dept.hall?.areaId).toBe(areaAId);
  });
});

// ----------------------------------------------------------------------------
// PUT /departments/:id/hall — cross-area assignment is blocked by DB trigger
// ----------------------------------------------------------------------------

describe('Department Hall (1:1): cross-area assignment is rejected', () => {
  it('PUT /departments/:id/hall with Hall B (different area) returns 400', async () => {
    const res = await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: hallBId }),
    });
    const body = (await res.json()) as JsonBody;

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    // The trigger error message mentions area mismatch.
    const msg = typeof body.error === 'object' ? body.error.message : body.message;
    expect(String(msg).toLowerCase()).toContain('area');
  });

  it('GET /departments/:id still shows the previous Hall A assignment (rollback)', async () => {
    const res = await fetch(`${BASE_URL}/departments/${deptId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;
    const dept = body.data as DepartmentPayload;

    expect(dept.hallId).toBe(hallAId);
  });
});

// ----------------------------------------------------------------------------
// Team inherits hall transitively via department.hall_id
// ----------------------------------------------------------------------------

describe('Team Hall Inheritance (1:1): team reflects department hall', () => {
  it('GET /teams/:id returns hallId/hallName inherited from parent department', async () => {
    const res = await fetch(`${BASE_URL}/teams/${teamId}`, {
      headers: authOnly(auth.authToken),
    });
    const body = (await res.json()) as JsonBody;
    const team = body.data as TeamPayload;

    expect(res.status).toBe(200);
    expect(team.hallId).toBe(hallAId);
    expect(team.hallName).toBeTruthy();
  });
});

// ----------------------------------------------------------------------------
// PUT /departments/:id/hall — clear assignment with null
// ----------------------------------------------------------------------------

describe('Department Hall (1:1): clearing the assignment', () => {
  it('PUT /departments/:id/hall with hallId=null clears the assignment', async () => {
    const res = await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: null }),
    });
    expect(res.status).toBe(200);

    const getRes = await fetch(`${BASE_URL}/departments/${deptId}`, {
      headers: authOnly(auth.authToken),
    });
    const dept = ((await getRes.json()) as JsonBody).data as DepartmentPayload;

    expect(dept.hallId).toBeNull();
    expect(dept.hall ?? null).toBeNull();
  });

  it('Team inheritance reflects the cleared hall (hallId=null)', async () => {
    const res = await fetch(`${BASE_URL}/teams/${teamId}`, {
      headers: authOnly(auth.authToken),
    });
    const team = ((await res.json()) as JsonBody).data as TeamPayload;

    expect(team.hallId).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Department area change — area-match invariant during update
// ----------------------------------------------------------------------------

describe('Department Hall (1:1): area change requires hall reset', () => {
  it('Reassign Hall A first (so dept has a hall before the area change)', async () => {
    const res = await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: hallAId }),
    });
    expect(res.status).toBe(200);
  });

  it('PUT /departments/:id changing area to Area B without clearing hall returns 400', async () => {
    // The trigger trg_enforce_dept_hall_area_match fires on UPDATE OF area_id
    // when hall_id is set: hall.area_id (=areaA) != new dept.area_id (=areaB).
    const res = await fetch(`${BASE_URL}/departments/${deptId}`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ areaId: areaBId }),
    });
    expect(res.status).toBe(400);
  });

  it('Clearing hall first, then changing area, succeeds', async () => {
    const clearRes = await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: null }),
    });
    expect(clearRes.status).toBe(200);

    const moveRes = await fetch(`${BASE_URL}/departments/${deptId}`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ areaId: areaBId }),
    });
    expect(moveRes.status).toBe(200);

    // Now Hall B (Area B) must be assignable, Hall A (Area A) must not.
    const assignBRes = await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: hallBId }),
    });
    expect(assignBRes.status).toBe(200);

    const assignARes = await fetch(`${BASE_URL}/departments/${deptId}/hall`, {
      method: 'PUT',
      headers: authHeaders(auth.authToken),
      body: JSON.stringify({ hallId: hallAId }),
    });
    expect(assignARes.status).toBe(400);
  });
});
