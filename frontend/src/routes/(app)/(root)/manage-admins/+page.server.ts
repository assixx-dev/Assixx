/**
 * Manage Admins — Server-Side Data Loading (Phase 4.2 URL-driven state)
 * @module manage-admins/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.2. Mirrors the canonical
 * Phase-3 reference impl (`manage-dummies/+page.server.ts`) and the
 * Phase-4.1b sibling (`manage-employees/+page.server.ts`); the only
 * structural difference here is `(root)`-only access — the page is gated
 * by `(root)/+layout.server.ts` (ADR-012 fail-closed RBAC), so no addon
 * Layer-2 path is needed and the helper is the base `apiFetchPaginated<T>`,
 * NOT `apiFetchPaginatedWithPermission<T>`.
 *
 * Per-admin permission enrichment (`loadAdminPermissions`) is preserved.
 * With server-side pagination it now fires for ≤25 admins per page slice
 * instead of the pre-Phase-4 100-admin batch — pure performance gain.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginated } from '$lib/server/api-fetch';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { Admin, AdminPermissions, Area, Department } from './_lib/types';

/**
 * Status filter URL allow-list. Numeric IS_ACTIVE codes (0=inactive,
 * 1=active, 3=archived) plus `'all'` as no-filter sentinel — string-typed
 * because `URL.searchParams.get` always returns strings. Same convention
 * as `manage-dummies` (Phase-3 §3.2 D5) and `manage-employees` (§4.1b D5)
 * so the URL surface stays consistent across all Phase-4 pages and the
 * backend `/users?isActive=N` query param accepts the values verbatim
 * (no FE-side aliasing layer).
 */
const STATUS_FILTERS = ['all', '0', '1', '3'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Page size for manage-admins. 25 matches the pre-Phase-4 client-side
 * `ADMINS_PER_PAGE` constant — preserves UX continuity. Backend cap is
 * 100 (PaginationSchema.max in `common.schema.ts`).
 */
const PAGE_SIZE = 25;

/** Position-API response shape (kept locally — only consumer of these fields). */
interface PositionOption {
  id: string;
  name: string;
  roleCategory: string;
}

/** Extract permission fields with safe defaults */
function extractPermissions(
  raw: AdminPermissions | null | undefined,
): Pick<Admin, 'areas' | 'departments' | 'leadAreas' | 'leadDepartments' | 'hasFullAccess'> {
  const p = raw ?? {};
  return {
    areas: p.areas ?? [],
    departments: p.departments ?? [],
    leadAreas: p.leadAreas ?? [],
    leadDepartments: p.leadDepartments ?? [],
    hasFullAccess: p.hasFullAccess ?? false,
  };
}

/**
 * Load permissions for a single admin and return new admin object with permissions.
 * Returns a NEW object to avoid ESLint require-atomic-updates warnings.
 */
async function loadAdminPermissions(
  admin: Admin,
  token: string,
  fetchFn: typeof fetch,
): Promise<Admin> {
  const permsData = await apiFetch<AdminPermissions>(
    `/admin-permissions/${admin.id}`,
    token,
    fetchFn,
  );

  return { ...admin, ...extractPermissions(permsData) };
}

export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  // URL → state. Each helper falls back to a safe default on missing/tampered
  // input — see `frontend/src/lib/utils/url-pagination.ts`.
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);
  // UX default: show only ACTIVE admins on bare URL (`/manage-admins`). Was
  // `'all'` until 2026-05; product feedback — admins overwhelmingly want to
  // see the live workforce first, archived/inactive only on explicit toggle.
  // Implication: FE-default ('1') ≠ BE-default (no filter), so we MUST send
  // `isActive=1` to the backend on the canonical URL — the "defaults never
  // sent" rule from R5 §0.2 only applies when FE-default == BE-default.
  const status = readFilterFromUrl<StatusFilter>(url, 'isActive', STATUS_FILTERS, '1');

  // State → backend query string. `'all'` is the no-filter sentinel and is
  // intentionally NOT forwarded — backend treats absent param as "all rows".
  const params = new URLSearchParams();
  params.set('role', 'admin');
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  if (search !== '') params.set('search', search);
  if (status !== 'all') params.set('isActive', status);

  // Single paginated call. /areas + /departments + /positions fire in parallel
  // (FAST PATH preserved — these three datasets are needed for the form modal
  // regardless of which admin page we're on).
  const [adminsResult, areasData, departmentsData, positionsData] = await Promise.all([
    apiFetchPaginated<Admin>(`/users?${params.toString()}`, token, fetch),
    apiFetch<Area[]>('/areas', token, fetch),
    apiFetch<Department[]>('/departments', token, fetch),
    apiFetch<PositionOption[]>('/organigram/positions', token, fetch),
  ]);

  // Defensive role filter: backend already filters by `?role=admin`, but
  // a future query-param drift bug could leak employees/roots into the
  // response. One predicate, costs nothing, prevents wrong-role rendering.
  const rawAdmins = adminsResult.data.filter((u: Admin) => u.role === 'admin');

  // Per-admin permission enrichment. With server-side pagination this now
  // fires for ≤PAGE_SIZE admins — performance win vs the pre-Phase-4 batch
  // of up to 100. Sequential per-admin requests run in parallel via
  // Promise.all so total wall-time is one round-trip, not N.
  const admins = await Promise.all(
    rawAdmins.map((admin: Admin) => loadAdminPermissions(admin, token, fetch)),
  );

  return {
    admins,
    pagination: adminsResult.pagination,
    areas: Array.isArray(areasData) ? areasData : [],
    departments: Array.isArray(departmentsData) ? departmentsData : [],
    positionOptions:
      Array.isArray(positionsData) ?
        positionsData
          .filter((p: PositionOption) => p.roleCategory !== 'root')
          .map((p: PositionOption) => ({
            id: p.id,
            name: p.name,
            roleCategory: p.roleCategory,
          }))
      : [],
    search,
    // Convert URL string back to `number | 'all'` for the existing toggle
    // buttons. Single conversion point — UI stays numeric, URL stays string.
    // The numeric branch's value is structurally one of 0/1/3 (constrained by
    // `STATUS_FILTERS` allowlist above) — TypeScript can't see that across
    // the `Number.parseInt` boundary, so the FE-side compares directly
    // against `1`/`0`/`3` (number-literal comparison is fine on `number`).
    statusFilter: status === 'all' ? ('all' as const) : Number.parseInt(status, 10),
  };
};
