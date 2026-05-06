/**
 * Manage Approvals — Server-Side Data Loading (Phase 4.3b URL-driven state)
 * @module shared/manage-approvals/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.3b. Mirrors the canonical
 * Phase-3 reference impl (`manage-dummies/+page.server.ts`) and the Phase-4.1b
 * `manage-employees` template.
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `(shared)/+layout.server.ts` (route group RBAC, ADR-012).
 *             `approvals` is a core addon (always active) — no `requireAddon` here.
 *   Layer 1 — `hasManageAccess` (role + hasFullAccess + isAnyLead, ADR-045).
 *             Fail → redirect /permission-denied.
 *   Layer 2 — backend `@RequirePermission(approvals, approvals-manage,
 *             'canRead')` produces 403 → `apiFetchPaginatedWithPermission`
 *             surfaces it as `permissionDenied: true` so `+page.svelte`
 *             can render `<PermissionDenied />` (ADR-020).
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { createLogger } from '$lib/utils/logger';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { OrganizationalScope } from '$lib/types/organizational-scope';
import type { PageServerLoad } from './$types';
import type { ApprovalListItem, RootSelfTerminationRequest, RootUserLookup } from './_lib/types';

interface ApprovalStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

const log = createLogger('ManageApprovals');

/**
 * Status filter URL allow-list. Matches the backend `ApprovalStatus` enum
 * plus `'all'` as no-filter sentinel — string-typed because
 * `URL.searchParams.get` always returns strings. D5 convention from the
 * `manage-dummies` reference impl: numeric-IS_ACTIVE pages use numeric URL
 * codes, enum-status pages use enum strings verbatim. No FE-side aliasing
 * layer; backend `?status=` accepts the values directly.
 */
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Addon-code filter URL allow-list. Mirrors the legacy ADDON_FILTER_OPTIONS
 * from `+page.svelte`; backend `?addonCode=` accepts the values verbatim.
 * `'all'` is the no-filter sentinel.
 */
const ADDON_FILTERS = [
  'all',
  'kvp',
  'tpm',
  'vacation',
  'shift_planning',
  'blackboard',
  'calendar',
  'surveys',
] as const;
type AddonFilter = (typeof ADDON_FILTERS)[number];

/**
 * Page size for manage-approvals. 20 matches the pre-Phase-4.3b client-side
 * default (`listApprovals(page, pageSize=20)`) — preserves UX continuity.
 * Backend cap is 100 (PaginationSchema.max in `common.schema.ts`).
 */
const PAGE_SIZE = 20;

function hasManageAccess(
  role: string,
  hasFullAccess: boolean,
  orgScope: OrganizationalScope,
): boolean {
  if (role === 'root') return true;
  if (role === 'admin' && hasFullAccess) return true;
  return orgScope.isAnyLead;
}

/**
 * Layer-1 page-level access gate. Throws redirects on failure (302 to
 * /login or /permission-denied) and returns the validated `{ token, user }`
 * pair on success — narrows both at the call site without an `asserts`
 * type-guard (TS can't propagate `asserts` across `parentData.user`).
 *
 * Mirrors the `assertTeamLevelAccess` pattern from manage-employees
 * (Phase 4.1b) but inlined here because the approvals access rule
 * (`hasManageAccess`) is not shared with other pages. Factored out of
 * `load` to keep the main body under the ESLint `max-lines-per-function: 60`
 * budget.
 */
function assertManageApprovalsAccess<U extends { role: string; hasFullAccess: boolean }>(
  url: URL,
  token: string | undefined,
  user: U | null | undefined,
  orgScope: OrganizationalScope,
): { token: string; user: U } {
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }
  if (user === null || user === undefined) {
    log.warn({ pathname: url.pathname }, 'RBAC: No user data');
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }
  if (!hasManageAccess(user.role, user.hasFullAccess, orgScope)) {
    log.warn(
      { pathname: url.pathname, userRole: user.role },
      'RBAC: Access denied to manage-approvals',
    );
    redirect(302, '/permission-denied');
  }
  return { token, user };
}

/**
 * Assemble the backend `/approvals?...` query string from URL state. Defaults
 * (page=1, search='', status='all', addonCode='all') are NEVER emitted —
 * R5 mitigation §0.2: backend sees only filters the user actually set.
 *
 * Factored out of `load` so its cyclomatic complexity stays under the
 * SonarJS `complexity: 10` cap (manage-employees uses the same pattern).
 */
function buildApprovalsQuery(
  page: number,
  search: string,
  status: StatusFilter,
  addonCode: AddonFilter,
  pageSize: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(pageSize));
  if (search !== '') params.set('search', search);
  if (status !== 'all') params.set('status', status);
  if (addonCode !== 'all') params.set('addonCode', addonCode);
  return params;
}

/**
 * Fetch the root-only data for the self-termination peer-approval card.
 *
 * WHY a separate helper: keeps the conditional `isRoot ? apiFetch : Promise.resolve(null)`
 * branches out of the main `load` function so its cyclomatic complexity stays
 * under the project's `complexity: 10` ESLint cap. Returns the same paired
 * shape regardless of role — non-root users get `[[], []]` so the page-data
 * envelope is uniform and the consumer doesn't need a role check.
 *
 * @see docs/FEAT_ROOT_ACCOUNT_PROTECTION_MASTERPLAN.md §5.3
 */
async function loadRootSelfTerminationData(
  role: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<{ requests: RootSelfTerminationRequest[]; peerRoots: RootUserLookup[] }> {
  if (role !== 'root') {
    return { requests: [], peerRoots: [] };
  }
  const [requestsData, peerRootsData] = await Promise.all([
    apiFetch<RootSelfTerminationRequest[]>(
      '/users/self-termination-requests/pending',
      token,
      fetchFn,
    ),
    apiFetch<RootUserLookup[]>('/users?role=root', token, fetchFn),
  ]);
  return {
    requests: Array.isArray(requestsData) ? requestsData : [],
    peerRoots: Array.isArray(peerRootsData) ? peerRootsData : [],
  };
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const parentData = await parent();
  const { token, user } = assertManageApprovalsAccess(
    url,
    cookies.get('accessToken'),
    parentData.user,
    parentData.orgScope,
  );

  // URL → state. Each helper falls back to a safe default on missing/tampered
  // input — see `frontend/src/lib/utils/url-pagination.ts`.
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);
  const status = readFilterFromUrl<StatusFilter>(url, 'status', STATUS_FILTERS, 'all');
  const addonCode = readFilterFromUrl<AddonFilter>(url, 'addonCode', ADDON_FILTERS, 'all');

  const params = buildApprovalsQuery(page, search, status, addonCode, PAGE_SIZE);
  const emptyStats: ApprovalStats = { pending: 0, approved: 0, rejected: 0, total: 0 };

  // Single paginated call with Layer-2 (ADR-020) 403 detection.
  // Stats / reward-tiers / root self-termination fire in parallel (FAST PATH).
  // If the primary approvals fetch returns 403 the parallel data is unused —
  // minor wasted bandwidth in exchange for one round-trip page-load latency.
  const [approvalsResult, statsData, rewardTiersData, rootSelfTermination] = await Promise.all([
    apiFetchPaginatedWithPermission<ApprovalListItem>(
      `/approvals?${params.toString()}`,
      token,
      fetch,
    ),
    apiFetch<ApprovalStats>('/approvals/stats', token, fetch),
    apiFetch<{ id: number; amount: number; sortOrder: number }[]>(
      '/kvp/reward-tiers',
      token,
      fetch,
    ),
    loadRootSelfTerminationData(user.role, token, fetch),
  ]);

  if (approvalsResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      approvals: [] as ApprovalListItem[],
      pagination: approvalsResult.pagination,
      stats: emptyStats,
      rewardTiers: [] as { id: number; amount: number; sortOrder: number }[],
      rootSelfTerminationRequests: [] as RootSelfTerminationRequest[],
      rootUsers: [] as RootUserLookup[],
      search: '',
      statusFilter: 'all' as const,
      addonFilter: 'all' as const,
    };
  }

  return {
    permissionDenied: false as const,
    approvals: approvalsResult.data,
    pagination: approvalsResult.pagination,
    stats: statsData ?? emptyStats,
    rewardTiers: Array.isArray(rewardTiersData) ? rewardTiersData : [],
    rootSelfTerminationRequests: rootSelfTermination.requests,
    rootUsers: rootSelfTermination.peerRoots,
    search,
    statusFilter: status,
    addonFilter: addonCode,
  };
};
