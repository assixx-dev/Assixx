/**
 * KVP (Suggestions) — Server-Side Data Loading (Phase 4.5b URL-driven state)
 * @module kvp/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.5b. Mirrors the §4.1b
 * `manage-employees` and §4.4b `manage-assets` reference impls — every
 * Phase-4 page copies this structure verbatim.
 *
 * Backend `/kvp` envelope landed in §4.5a (Session 8a, 2026-05-05, changelog
 * 1.16.0): canonical ADR-007 wrapper `{ items[], pagination }` flattened by
 * `ResponseInterceptor` to `{ data: T[], meta: { pagination } }`. The FE
 * consumes it via `apiFetchPaginatedWithPermission<KvpSuggestion>` (§D6).
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `requireAddon('kvp', activeAddons)` (addon subscription gate)
 *   Layer 1 — `(shared)/+layout.server.ts` (route group RBAC, ADR-012)
 *   Layer 2 — backend `@RequirePermission(KVP_ADDON, KVP_SUGGESTIONS,
 *             'canRead')` produces 403 → `apiFetchPaginatedWithPermission`
 *             surfaces it as `permissionDenied: true` so `+page.svelte`
 *             can render `<PermissionDenied />` (ADR-020).
 *
 * Filter URL contract (per masterplan §4.5b + §D5 — backend names verbatim,
 * no FE-side aliasing layer):
 *   ?page, ?search, ?status, ?orgLevel, ?categoryId | ?customCategoryId,
 *   ?teamId, ?mineOnly
 *
 * Pre-Phase-4.5b FE-only filter values dropped per Q3 sign-off (§D9):
 *   - `assetFilter` → no backend `assetId` filter exists.
 *   - `currentFilter='asset'` → backend `OrgLevelSchema` has no `'asset'`.
 *   - `currentFilter='manage'` → no backend equivalent.
 *
 * Pre-Phase-4.5b silent no-op dropped per §D10 (recorded as new spec
 * deviation; not in Q3 list but unavoidable to satisfy §D5 "every filter
 * must be URL-persistent" rule):
 *   - `departmentFilter` (mapped to `?departmentId=` which Zod silently
 *      strips since `ListSuggestionsQuerySchema` doesn't declare it) →
 *      removed. Use `?orgLevel=department` to filter to dept-level
 *      suggestions; specific department filtering would need a backend
 *      extension out of 4.5b scope.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type {
  CurrentUser,
  Department,
  KvpCategory,
  KvpStats,
  KvpSuggestion,
  UserTeamWithAssets,
} from './_lib/types';

/**
 * Status URL allow-list — mirrors backend `StatusSchema` enum verbatim
 * (`backend/src/nest/kvp/dto/query-suggestion.dto.ts:14`) plus `'all'` as
 * the no-filter sentinel. Drops `'restored'` from the pre-Phase-4.5b FE
 * dropdown since the backend rejects it as a query param (recorded as §D11):
 * selecting "Wiederhergestellt" in the dropdown produced a silent 400.
 */
const STATUS_FILTERS = [
  'all',
  'new',
  'in_review',
  'approved',
  'implemented',
  'rejected',
  'archived',
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * orgLevel URL allow-list — mirrors backend `OrgLevelSchema` enum verbatim
 * (`backend/src/nest/kvp/dto/query-suggestion.dto.ts:31`) plus `'all'` as
 * the no-filter sentinel. Pre-Phase-4.5b FE had `'asset'` and `'manage'`
 * toggle values that did not exist server-side — dropped per §D9 / Q3
 * sign-off (greenfield: no migration shim).
 */
const ORG_LEVEL_FILTERS = ['all', 'company', 'department', 'area', 'team'] as const;
type OrgLevelFilter = (typeof ORG_LEVEL_FILTERS)[number];

/**
 * Page size for the KVP suggestions list. 20 mirrors the backend
 * `PaginationSchema` default and the pre-Phase-4 UX.
 */
const PAGE_SIZE = 20;

/**
 * Parse a positive-integer URL param, fall back to `null` on missing/invalid.
 * Mirrors the defensive shape of `readPageFromUrl` for ID-typed filter params
 * (`categoryId`, `customCategoryId`, `teamId`).
 */
function readIdFromUrl(url: URL, key: string): number | null {
  const raw = url.searchParams.get(key);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Approval-config status for the create-button gate. `hasConfigForUser` is
 * the scope-aware flag that drives the "+ Neuer KVP" button — when false,
 * the backend will refuse the POST anyway (Hard-Gate, ADR-037 Amendment
 * 2026-04-26 + Masterplan §3.4 v0.6.0). `hasConfig` is kept for tenant-level
 * UI hints. `masters` powers the info banner ("Dein KVP-Master: …") so the
 * employee knows who their suggestion will be routed to. Endpoint defaults
 * are conservative — empty + both flags false on fetch errors.
 */
interface ApprovalMaster {
  id: number;
  displayName: string;
}
interface ApprovalConfigStatus {
  hasConfig: boolean;
  hasConfigForUser: boolean;
  masters: ApprovalMaster[];
}

/**
 * Parent user type from layout
 */
interface ParentUser {
  id: number;
  role: 'root' | 'admin' | 'employee';
  position?: string;
  tenantId: number;
  teamIds?: number[];
  teamDepartmentId?: number | null;
}

/**
 * Maps parent layout user to KVP CurrentUser format.
 * Parent layout returns teamIds[] array, KVP expects teamId (first team).
 */
function mapParentUserToCurrentUser(parentUser: ParentUser | null): CurrentUser | null {
  if (parentUser === null) return null;
  return {
    id: parentUser.id,
    role: parentUser.role,
    tenantId: parentUser.tenantId,
    departmentId: parentUser.teamDepartmentId ?? null,
    teamId: parentUser.teamIds?.[0],
  };
}

/**
 * URL-state snapshot — consumed by `+page.svelte` for derived display + by
 * `buildBackendParams` for the outbound query string. Extracted from `load()`
 * to keep the function under the ESLint `max-lines-per-function` budget.
 */
interface UrlState {
  page: number;
  search: string;
  status: StatusFilter;
  orgLevel: OrgLevelFilter;
  categoryId: number | null;
  customCategoryId: number | null;
  teamId: number | null;
  mineOnly: boolean;
}

/** Read every filter param from the URL into a single normalised snapshot. */
function readUrlState(url: URL): UrlState {
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
    status: readFilterFromUrl<StatusFilter>(url, 'status', STATUS_FILTERS, 'all'),
    orgLevel: readFilterFromUrl<OrgLevelFilter>(url, 'orgLevel', ORG_LEVEL_FILTERS, 'all'),
    categoryId: readIdFromUrl(url, 'categoryId'),
    customCategoryId: readIdFromUrl(url, 'customCategoryId'),
    teamId: readIdFromUrl(url, 'teamId'),
    mineOnly: url.searchParams.get('mineOnly') === 'true',
  };
}

/**
 * State → backend query string. Defaults are NEVER sent to the backend
 * (R5 mitigation §0.2: clean canonical URLs). `categoryId` /
 * `customCategoryId` are mutually exclusive — the FE dropdown ensures at
 * most one is set per click.
 */
function buildBackendParams(state: UrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(state.page));
  params.set('limit', String(PAGE_SIZE));
  if (state.search !== '') params.set('search', state.search);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.orgLevel !== 'all') params.set('orgLevel', state.orgLevel);
  if (state.categoryId !== null) params.set('categoryId', String(state.categoryId));
  if (state.customCategoryId !== null) {
    params.set('customCategoryId', String(state.customCategoryId));
  }
  if (state.teamId !== null) params.set('teamId', String(state.teamId));
  if (state.mineOnly) params.set('mineOnly', 'true');
  return params;
}

/** Backend defaults to "no config" so the create-button stays disabled on fetch errors. */
const APPROVAL_FALLBACK: ApprovalConfigStatus = {
  hasConfig: false,
  hasConfigForUser: false,
  masters: [],
};

/** Coerce a possibly-null array response into a safe `[]` default. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Whether the request comes from a user who should see KVP statistics.
 * Admin / root see tenant-wide numbers; team leads see their own team
 * stats. Employees never see the panel.
 */
function shouldShowStats(parentUser: ParentUser | null): boolean {
  if (parentUser === null) return false;
  if (parentUser.role === 'admin' || parentUser.role === 'root') return true;
  return parentUser.position === 'team_lead';
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const parentData = await parent();
  requireAddon(parentData.activeAddons, 'kvp');

  const parentUser = parentData.user as ParentUser | null;
  const showStats = shouldShowStats(parentUser);
  const urlState = readUrlState(url);
  const params = buildBackendParams(urlState);

  // Reference data fires in parallel with the primary fetch (FAST PATH
  // preserved). If the primary fetch returns 403 the parallel data is unused
  // — minor wasted bandwidth in exchange for one round-trip latency.
  const [kvpResult, categoriesData, departmentsData, orgsData, statsData, approvalStatus] =
    await Promise.all([
      apiFetchPaginatedWithPermission<KvpSuggestion>(`/kvp?${params.toString()}`, token, fetch),
      apiFetch<KvpCategory[]>('/kvp/categories', token, fetch),
      apiFetch<Department[]>('/departments', token, fetch),
      apiFetch<UserTeamWithAssets[]>('/kvp/my-organizations', token, fetch),
      showStats ? apiFetch<KvpStats>('/kvp/dashboard/stats', token, fetch) : Promise.resolve(null),
      apiFetch<ApprovalConfigStatus>('/kvp/approval-config-status', token, fetch),
    ]);

  // URL-state mirrors — consumed directly by `+page.svelte` (no `$state`
  // shadow). All Phase-4 pages share this contract.
  const sharedShape = {
    showStats,
    currentUser: mapParentUserToCurrentUser(parentUser),
    pagination: kvpResult.pagination,
    approvalConfig: approvalStatus ?? APPROVAL_FALLBACK,
    departments: asArray<Department>(departmentsData),
    ...urlState,
  };

  if (kvpResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      suggestions: [] as KvpSuggestion[],
      categories: [] as KvpCategory[],
      userOrganizations: [] as UserTeamWithAssets[],
      statistics: null,
      ...sharedShape,
    };
  }

  return {
    permissionDenied: false as const,
    suggestions: kvpResult.data,
    categories: asArray<KvpCategory>(categoriesData),
    userOrganizations: asArray<UserTeamWithAssets>(orgsData),
    statistics: statsData,
    ...sharedShape,
  };
};
