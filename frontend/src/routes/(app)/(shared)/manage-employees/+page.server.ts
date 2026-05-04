/**
 * Manage Employees — Server-Side Data Loading (Phase 4.1b URL-driven state)
 * @module manage-employees/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.1b. Mirrors the canonical
 * Phase-3 reference impl (`manage-dummies/+page.server.ts`) — every Phase-4
 * page copies this structure verbatim.
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `(shared)/+layout.server.ts` (route group RBAC, ADR-012)
 *   Layer 1 — `assertTeamLevelAccess` (any-team-scope check, ADR-035/036)
 *   Layer 2 — backend `@RequirePermission(MANAGE_HIERARCHY, MANAGE_EMPLOYEES,
 *             'canRead')` produces 403 → `apiFetchPaginatedWithPermission`
 *             surfaces it as `permissionDenied: true` so `+page.svelte`
 *             can render `<PermissionDenied />` (ADR-020).
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { assertTeamLevelAccess } from '$lib/server/manage-page-access';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { Employee, Team } from './_lib/types';

/**
 * Status filter URL allow-list. Numeric IS_ACTIVE codes (0=inactive,
 * 1=active, 3=archived) plus `'all'` as no-filter sentinel — string-typed
 * because `URL.searchParams.get` always returns strings. Same convention
 * as the `manage-dummies` reference impl (Phase-3 §3.2 D5) so the URL
 * surface stays consistent across all Phase-4 pages and the backend
 * `/users?isActive=N` query param accepts the values verbatim
 * (no FE-side aliasing layer).
 */
const STATUS_FILTERS = ['all', '0', '1', '3'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Page size for manage-employees. 25 matches the pre-Phase-4 client-side
 * `EMPLOYEES_PER_PAGE` constant — preserves UX continuity. Backend cap is
 * 100 (PaginationSchema.max in `common.schema.ts`).
 */
const PAGE_SIZE = 25;

/** Position-API response shape (kept locally — only consumer of these fields). */
interface PositionOption {
  id: string;
  name: string;
  roleCategory: string;
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const { user, orgScope } = await parent();
  assertTeamLevelAccess(orgScope, { role: user?.role, pathname: url.pathname });

  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  // URL → state. Each helper falls back to a safe default on missing/tampered
  // input — see `frontend/src/lib/utils/url-pagination.ts`.
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);
  const status = readFilterFromUrl<StatusFilter>(url, 'isActive', STATUS_FILTERS, 'all');

  // State → backend query string. Defaults are NEVER sent to the backend
  // (R5 mitigation §0.2: clean canonical URLs).
  const params = new URLSearchParams();
  params.set('role', 'employee');
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  if (search !== '') params.set('search', search);
  if (status !== 'all') params.set('isActive', status);

  // Single paginated call with Layer-2 (ADR-020) 403 detection.
  // /teams + /positions fire in parallel (FAST PATH preserved). If the
  // primary employee fetch returns 403 the parallel data is unused — minor
  // wasted bandwidth in exchange for one round-trip page-load latency.
  const [empResult, teamsData, positionsData] = await Promise.all([
    apiFetchPaginatedWithPermission<Employee>(`/users?${params.toString()}`, token, fetch),
    apiFetch<Team[]>('/teams', token, fetch),
    apiFetch<PositionOption[]>('/organigram/positions?roleCategory=employee', token, fetch),
  ]);

  if (empResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      employees: [] as Employee[],
      pagination: empResult.pagination,
      teams: [] as Team[],
      positionOptions: [] as PositionOption[],
      search: '',
      statusFilter: 'all' as const,
    };
  }

  // Defensive role filter: backend already filters by `?role=employee`, but
  // a future query-param drift bug could leak admins/roots into the response.
  // One predicate, costs nothing, prevents the UI from showing wrong roles.
  const employees = empResult.data.filter((u: Employee) => u.role === 'employee');

  return {
    permissionDenied: false as const,
    employees,
    pagination: empResult.pagination,
    teams: Array.isArray(teamsData) ? teamsData : [],
    positionOptions:
      Array.isArray(positionsData) ?
        positionsData.map((p: PositionOption) => ({
          id: p.id,
          name: p.name,
          roleCategory: p.roleCategory,
        }))
      : [],
    search,
    // Convert URL string back to `number | 'all'` for the existing toggle
    // buttons. Single conversion point — UI stays numeric, URL stays string.
    // The numeric branch's value is structurally one of 0/1/3 (constrained by
    // `STATUS_FILTERS` allowlist above) but TypeScript can't see that across
    // the `Number.parseInt` boundary, so the FE-side compares directly
    // against `1`/`0`/`3` (number-literal comparison is fine on `number`).
    statusFilter: status === 'all' ? ('all' as const) : Number.parseInt(status, 10),
  };
};
