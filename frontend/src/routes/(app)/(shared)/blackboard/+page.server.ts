/**
 * Blackboard — Server-Side Data Loading (Phase 4.6 URL-driven state)
 * @module blackboard/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.6 (Session 8c). Mirrors the
 * canonical Phase-3 / Phase-4.1b reference impls (`manage-dummies` /
 * `manage-employees`).
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `(shared)/+layout.server.ts` (route group RBAC, ADR-012)
 *   Layer 1 — `requireAddon('blackboard')` (addon subscription gate, ADR-033)
 *   Layer 2 — backend `@RequirePermission(blackboard, blackboard-posts,
 *             'canRead')` produces 403 → `apiFetchPaginatedWithPermission`
 *             surfaces it as `permissionDenied: true` so `+page.svelte`
 *             can render `<PermissionDenied />` (ADR-020 §"Frontend
 *             Permission-Denied Handling").
 *
 * Spec deviations recorded in masterplan §"Spec Deviations":
 *   D12 — silent `?status=active` URL drift dropped (backend
 *         `ListEntriesQuerySchema` has no `status` field, Zod stripped it;
 *         backend default `isActive ?? 1` already filters to active).
 *   D13 — `archived/` sub-route migration folded into this session.
 *   D14 — `_lib/api.ts` legacy `fetchEntries` + `buildQueryParams` +
 *         `PaginatedResponse<T>` + `FilterState` deleted (dead code).
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type {
  Area,
  BlackboardEntry,
  BlackboardMyPermissions,
  Department,
  SortDir,
  Team,
} from './_lib/types';

/** Page size — matches the pre-Phase-4.6 client-side constant for UX continuity. */
const PAGE_SIZE = 12;

/** Fail-closed default when /blackboard/my-permissions fails or is unreachable. */
const DEFAULT_MY_PERMISSIONS: BlackboardMyPermissions = {
  posts: { canRead: false, canWrite: false, canDelete: false },
  comments: { canRead: false, canWrite: false, canDelete: false },
  archive: { canRead: false, canWrite: false },
};

/**
 * Filter URL allow-list — mirrors backend `ListEntriesQuerySchema.filter`
 * enum verbatim (no FE-side aliasing per §D5). Backend column = `org_level`,
 * URL key = `filter`.
 */
const FILTER_VALUES = ['all', 'company', 'department', 'team', 'area'] as const;
type FilterValue = (typeof FILTER_VALUES)[number];

/**
 * Sort URL allow-list — mirrors backend `ListEntriesQuerySchema.sortBy`
 * enum verbatim (column names; service does the SQL-injection guard).
 */
const SORT_BY_VALUES = ['created_at', 'updated_at', 'title', 'priority', 'expires_at'] as const;
type SortByValue = (typeof SORT_BY_VALUES)[number];

const SORT_DIR_VALUES = ['ASC', 'DESC'] as const;

interface UrlState {
  page: number;
  search: string;
  filter: FilterValue;
  sortBy: SortByValue;
  sortDir: SortDir;
}

/**
 * URL → state. Each `readFilterFromUrl` falls back to a safe default on
 * missing/tampered input. Single source of truth for the URL-contract surface
 * — extracted out of `load` to keep the load function under the 60-line cap
 * (mirrors the §4.5b KVP refactor pattern).
 */
function readUrlState(url: URL): UrlState {
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
    filter: readFilterFromUrl<FilterValue>(url, 'filter', FILTER_VALUES, 'all'),
    sortBy: readFilterFromUrl<SortByValue>(url, 'sortBy', SORT_BY_VALUES, 'created_at'),
    sortDir: readFilterFromUrl<SortDir>(url, 'sortDir', SORT_DIR_VALUES, 'DESC'),
  };
}

/**
 * State → backend query string. Defaults are NEVER sent to the backend
 * (R5 mitigation §0.2: clean canonical URLs for default state).
 */
function buildBackendParams(state: UrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(state.page));
  params.set('limit', String(PAGE_SIZE));
  if (state.search !== '') params.set('search', state.search);
  if (state.filter !== 'all') params.set('filter', state.filter);
  if (state.sortBy !== 'created_at') params.set('sortBy', state.sortBy);
  if (state.sortDir !== 'DESC') params.set('sortDir', state.sortDir);
  return params;
}

export const load: PageServerLoad = async ({ cookies, fetch, url, parent }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const { activeAddons, user, orgScope } = await parent();
  requireAddon(activeAddons, 'blackboard');

  const state = readUrlState(url);
  const params = buildBackendParams(state);

  // Parallel fetch: paginated entries + organisation lookups + own permissions.
  // /departments + /teams + /areas drive modal dropdowns (org targeting on
  // create/edit) — they fire alongside the primary fetch to preserve FAST
  // PATH. /blackboard/my-permissions is the ADR-045 Layer-2 self-lookup that
  // the page consumes to gate action buttons.
  const [entriesResult, departmentsData, teamsData, areasData, myPermissions] = await Promise.all([
    apiFetchPaginatedWithPermission<BlackboardEntry>(
      `/blackboard/entries?${params.toString()}`,
      token,
      fetch,
    ),
    apiFetch<Department[]>('/departments', token, fetch),
    apiFetch<Team[]>('/teams', token, fetch),
    apiFetch<Area[]>('/areas', token, fetch),
    apiFetch<BlackboardMyPermissions>('/blackboard/my-permissions', token, fetch),
  ]);

  if (entriesResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      entries: [] as BlackboardEntry[],
      pagination: entriesResult.pagination,
      departments: [] as Department[],
      teams: [] as Team[],
      areas: [] as Area[],
      user,
      orgScope,
      myPermissions: DEFAULT_MY_PERMISSIONS,
      search: '',
      filter: 'all' as const,
      sortBy: 'created_at' as const,
      sortDir: 'DESC' as const,
    };
  }

  return {
    permissionDenied: false as const,
    entries: entriesResult.data,
    pagination: entriesResult.pagination,
    departments: Array.isArray(departmentsData) ? departmentsData : [],
    teams: Array.isArray(teamsData) ? teamsData : [],
    areas: Array.isArray(areasData) ? areasData : [],
    user,
    orgScope,
    myPermissions: myPermissions ?? DEFAULT_MY_PERMISSIONS,
    search: state.search,
    filter: state.filter,
    sortBy: state.sortBy,
    sortDir: state.sortDir,
  };
};

// Re-export the FilterValue + SortByValue aliases so `+page.svelte` can import
// them for prop typing without re-deriving the allow-list. Single source of
// truth: the URL allow-list arrays above.
export type { FilterValue, SortByValue };
