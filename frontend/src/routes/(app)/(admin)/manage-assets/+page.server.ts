/**
 * Manage Assets — Server-Side Data Loading (Phase 4.4b URL-driven state)
 * @module manage-assets/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.4b. Mirrors the §4.1b
 * `manage-employees` reference impl — every Phase-4 page copies this
 * structure verbatim.
 *
 * Backend `/assets` envelope landed in §4.4a (Session 7c, 2026-05-05,
 * changelog 1.14.0): COUNT + paginated SELECT, ResponseInterceptor lifts
 * `pagination` → `body.meta.pagination`. The FE consumes it via
 * `apiFetchPaginatedWithPermission<Asset>` (§D6).
 *
 * Permission gate: GET `/assets` is currently NOT explicitly addon-gated
 * at the backend (no `@Roles` / `@RequirePermission` on the read path),
 * so 403 is unreachable today. The permission-aware helper is used per
 * the Phase-4 canonical pattern — future-proofs for any later gating
 * without rewriting the load function.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { Asset, AssetStatusFilter, Area, Department, Team } from './_lib/types';

/**
 * Status filter URL allow-list — matches backend `?status=` enum verbatim
 * (`assets/dto/list-assets-query.dto.ts:AssetStatusEnum`) plus `'all'` as
 * the no-filter sentinel. Same convention as the §4.1b reference impl
 * (D5): no FE-side aliasing layer, the value passed via URL is the value
 * the backend accepts.
 *
 * Pre-Phase-4.4b the FE had two extra UI buttons (`'cleaning'`, `'other'`)
 * that did not exist server-side — they silently filtered to zero matches.
 * Greenfield (CLAUDE.md): drift removed without a migration shim.
 */
const STATUS_FILTERS = [
  'all',
  'operational',
  'maintenance',
  'repair',
  'standby',
  'decommissioned',
] as const satisfies readonly AssetStatusFilter[];

/**
 * Page size for manage-assets. 25 mirrors the pre-Phase-4 client-side
 * `ASSETS_PER_PAGE` constant — preserves UX continuity. Backend cap is
 * 100 (`PaginationSchema.max` in `common.schema.ts`).
 */
const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  // URL → state. Each helper falls back to a safe default on missing /
  // tampered input (`frontend/src/lib/utils/url-pagination.ts`).
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);
  const status = readFilterFromUrl<AssetStatusFilter>(url, 'status', STATUS_FILTERS, 'all');

  // State → backend query string. Defaults are NEVER sent (R5 mitigation:
  // clean canonical URLs). `status === 'all'` is the no-filter sentinel.
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  if (search !== '') params.set('search', search);
  if (status !== 'all') params.set('status', status);

  // Reference data (departments / areas / teams) is needed by the form
  // modal regardless of permission outcome — always fire in parallel
  // with the primary fetch (FAST PATH preserved). If the primary fetch
  // returns 403 the parallel data is unused; minor wasted bandwidth in
  // exchange for one round-trip page-load latency.
  const [assetsResult, departmentsData, areasData, teamsData] = await Promise.all([
    apiFetchPaginatedWithPermission<Asset>(`/assets?${params.toString()}`, token, fetch),
    apiFetch<Department[]>('/departments', token, fetch),
    apiFetch<Area[]>('/areas', token, fetch),
    apiFetch<Team[]>('/teams', token, fetch),
  ]);

  if (assetsResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      assets: [] as Asset[],
      pagination: assetsResult.pagination,
      departments: [] as Department[],
      areas: [] as Area[],
      teams: [] as Team[],
      search: '',
      statusFilter: 'all' as const,
    };
  }

  return {
    permissionDenied: false as const,
    assets: assetsResult.data,
    pagination: assetsResult.pagination,
    departments: Array.isArray(departmentsData) ? departmentsData : [],
    areas: Array.isArray(areasData) ? areasData : [],
    teams: Array.isArray(teamsData) ? teamsData : [],
    search,
    statusFilter: status,
  };
};
