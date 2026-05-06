/**
 * Work Orders (Employee) — Server-Side Data Loading
 * @module shared/work-orders/+page.server
 *
 * SSR: Loads employee's assigned work orders + stats.
 * Addon guard: requires 'work_orders' addon active for tenant.
 *
 * Phase 4.7b (2026-05-06): URL-state-driven pagination via
 * `apiFetchPaginatedWithPermission` (§D6). URL contract: `?page / ?status /
 * ?priority / ?search`. Search input on the employee view is part of this
 * migration's Beta-correctness gap closure (backend has supported `?search=`
 * since changelog 1.2.0 — Phase 1.2a-B Stage B-2).
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Migration order" row 4.7
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D6, D15
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { WorkOrderListItem, WorkOrderStats } from './_lib/types';

// =============================================================================
// URL CONTRACT — verbatim mirror of backend `ListWorkOrdersQuerySchema`
// (`backend/src/nest/work-orders/dto/list-work-orders-query.dto.ts`).
// Empty string `''` is the sentinel for "no filter" — emitted as nothing on the
// backend params, omitted from the URL by `buildPaginatedHref` per §R5.
// =============================================================================

const STATUS_VALUES = ['', 'open', 'in_progress', 'completed', 'verified'] as const;
const PRIORITY_VALUES = ['', 'low', 'medium', 'high'] as const;

type StatusFilter = (typeof STATUS_VALUES)[number];
type PriorityFilter = (typeof PRIORITY_VALUES)[number];

/** Read all URL state in one place — mirrors the §4.5b/4.6 helper pattern. */
export interface EmployeeUrlState {
  page: number;
  search: string;
  status: StatusFilter;
  priority: PriorityFilter;
}

function readUrlState(url: URL): EmployeeUrlState {
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
    status: readFilterFromUrl<StatusFilter>(url, 'status', STATUS_VALUES, ''),
    priority: readFilterFromUrl<PriorityFilter>(url, 'priority', PRIORITY_VALUES, ''),
  };
}

/** Build backend `URLSearchParams` from URL state — emits only non-default values. */
function buildBackendParams(state: EmployeeUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(state.page));
  params.set('limit', '20');
  if (state.search !== '') params.set('search', state.search);
  if (state.status !== '') params.set('status', state.status);
  if (state.priority !== '') params.set('priority', state.priority);
  return params;
}

function emptyStats(): WorkOrderStats {
  return { open: 0, inProgress: 0, completed: 0, verified: 0, total: 0, overdue: 0 };
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const parentData = await parent();
  requireAddon(parentData.activeAddons, 'work_orders');

  const urlState = readUrlState(url);
  const backendParams = buildBackendParams(urlState);

  const [workOrdersResult, statsData] = await Promise.all([
    apiFetchPaginatedWithPermission<WorkOrderListItem>(
      `/work-orders/my?${backendParams.toString()}`,
      token,
      fetch,
    ),
    apiFetch<WorkOrderStats>('/work-orders/my/stats', token, fetch),
  ]);

  return {
    permissionDenied: workOrdersResult.permissionDenied,
    workOrders: workOrdersResult.data,
    pagination: workOrdersResult.pagination,
    stats: statsData ?? emptyStats(),
    urlState,
  };
};
