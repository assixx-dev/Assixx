/**
 * Work Orders (Admin) — Server-Side Data Loading
 * @module shared/work-orders/admin/+page.server
 *
 * SSR: Loads all work orders (URL-driven), stats, and eligible users in parallel.
 * Addon guard: requires 'work_orders' addon active for tenant.
 * Scope guard: Root | Admin (scoped) | Employee Team-Lead (ADR-036 pattern).
 * Deputies inherit lead scope when tenant toggle is ON.
 *
 * Phase 4.7b (2026-05-06): URL-state-driven pagination via
 * `apiFetchPaginatedWithPermission` (§D6). URL contract: `?page / ?status /
 * ?priority / ?search / ?isActive / ?overdue`. Adds the search input on the
 * admin view (Beta-correctness gap closure: backend has supported `?search=`
 * since changelog 1.2.0 — Phase 1.2a-B Stage B-2 — but FE never exposed it).
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Migration order" row 4.7
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D6, D15
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { assertTeamLevelAccess } from '$lib/server/manage-page-access';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { EligibleUser, WorkOrderListItem, WorkOrderStats } from '../_lib/types';

// =============================================================================
// URL CONTRACT — verbatim mirror of backend `ListWorkOrdersQuerySchema`
// (`backend/src/nest/work-orders/dto/list-work-orders-query.dto.ts`).
// Empty string `''` is the sentinel for "no filter" — emitted as nothing on the
// backend params, omitted from the URL by `buildPaginatedHref` per §R5.
// =============================================================================

const STATUS_VALUES = ['', 'open', 'in_progress', 'completed', 'verified'] as const;
const PRIORITY_VALUES = ['', 'low', 'medium', 'high'] as const;
const IS_ACTIVE_VALUES = ['active', 'archived', 'all'] as const;

type StatusFilter = (typeof STATUS_VALUES)[number];
type PriorityFilter = (typeof PRIORITY_VALUES)[number];
type IsActiveFilter = (typeof IS_ACTIVE_VALUES)[number];

export interface AdminUrlState {
  page: number;
  search: string;
  status: StatusFilter;
  priority: PriorityFilter;
  isActive: IsActiveFilter;
  overdue: boolean;
}

function readUrlState(url: URL): AdminUrlState {
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
    status: readFilterFromUrl<StatusFilter>(url, 'status', STATUS_VALUES, ''),
    priority: readFilterFromUrl<PriorityFilter>(url, 'priority', PRIORITY_VALUES, ''),
    isActive: readFilterFromUrl<IsActiveFilter>(url, 'isActive', IS_ACTIVE_VALUES, 'active'),
    // `?overdue=true` toggles ON; absence or any other value = OFF.
    overdue: url.searchParams.get('overdue') === 'true',
  };
}

function buildBackendParams(state: AdminUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(state.page));
  params.set('limit', '20');
  if (state.search !== '') params.set('search', state.search);
  if (state.status !== '') params.set('status', state.status);
  if (state.priority !== '') params.set('priority', state.priority);
  // `active` is the backend default for the admin view; only emit when overridden
  // so the URL stays clean per §R5.
  if (state.isActive !== 'active') params.set('isActive', state.isActive);
  if (state.overdue) params.set('overdue', 'true');
  return params;
}

function emptyStats(): WorkOrderStats {
  return { open: 0, inProgress: 0, completed: 0, verified: 0, total: 0, overdue: 0 };
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const { user, orgScope, activeAddons } = await parent();
  assertTeamLevelAccess(orgScope, { role: user?.role, pathname: url.pathname });

  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  requireAddon(activeAddons, 'work_orders');

  const urlState = readUrlState(url);
  const backendParams = buildBackendParams(urlState);

  const [workOrdersResult, statsData, eligibleUsersData] = await Promise.all([
    apiFetchPaginatedWithPermission<WorkOrderListItem>(
      `/work-orders?${backendParams.toString()}`,
      token,
      fetch,
    ),
    apiFetch<WorkOrderStats>('/work-orders/stats', token, fetch),
    apiFetch<EligibleUser[]>('/work-orders/eligible-users', token, fetch),
  ]);

  return {
    permissionDenied: workOrdersResult.permissionDenied,
    workOrders: workOrdersResult.data,
    pagination: workOrdersResult.pagination,
    stats: statsData ?? emptyStats(),
    eligibleUsers: Array.isArray(eligibleUsersData) ? eligibleUsersData : [],
    urlState,
  };
};
