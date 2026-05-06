/**
 * Inventory Items Page — Server-Side Data Loading
 * @module inventory/lists/[id]/+page.server
 *
 * Phase 4.8b (2026-05-06): URL-state-driven pagination via
 * `apiFetchPaginatedWithPermission` (§D6). URL contract: `?page / ?status /
 * ?search` — verbatim mirror of backend `ItemsQuerySchema`. Per-row
 * `customValues` consumption replaces the legacy `customValuesByItem`
 * sibling map (§D17 — backend rebuilt the envelope in 4.8a, this consumer
 * catches up).
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Migration order" row 4.8
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D6, D17
 */
import { redirect } from '@sveltejs/kit';

import { apiFetchPaginatedWithPermission, apiFetchWithPermission } from '$lib/server/api-fetch';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type {
  InventoryCustomField,
  InventoryItemWithCustomValues,
  InventoryList,
} from '../../_lib/types';

// =============================================================================
// URL CONTRACT — verbatim mirror of backend `ItemsQuerySchema`
// (`backend/src/nest/inventory/dto/common.dto.ts`). Empty string `''` is the
// sentinel for "no status filter" — emitted as nothing on the backend side,
// omitted from the URL by `buildPaginatedHref` per §R5 (clean canonical state).
// Status values audited against `InventoryItemStatusSchema` 2026-05-06: identical.
// =============================================================================

const STATUS_VALUES = [
  '',
  'operational',
  'defective',
  'repair',
  'maintenance',
  'decommissioned',
  'removed',
  'stored',
] as const;

type StatusFilter = (typeof STATUS_VALUES)[number];

/** Single source of truth for URL state read by this page. */
export interface ItemsUrlState {
  page: number;
  search: string;
  status: StatusFilter;
}

interface ListDetailResponse {
  list: InventoryList;
  fields: InventoryCustomField[];
}

const ITEMS_PER_PAGE = 50;

function readUrlState(url: URL): ItemsUrlState {
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
    status: readFilterFromUrl<StatusFilter>(url, 'status', STATUS_VALUES, ''),
  };
}

/** Build backend `URLSearchParams` from URL state — emits only non-default values. */
function buildBackendParams(listId: string, state: ItemsUrlState): URLSearchParams {
  const params = new URLSearchParams();
  // listId is the route key, NOT a filter — always emitted.
  params.set('listId', listId);
  params.set('page', String(state.page));
  params.set('limit', String(ITEMS_PER_PAGE));
  if (state.search !== '') params.set('search', state.search);
  if (state.status !== '') params.set('status', state.status);
  return params;
}

export const load: PageServerLoad = async ({ params, cookies, fetch, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const urlState = readUrlState(url);
  const backendParams = buildBackendParams(params.id, urlState);

  const [listResult, itemsResult] = await Promise.all([
    apiFetchWithPermission<ListDetailResponse>(`/inventory/lists/${params.id}`, token, fetch),
    apiFetchPaginatedWithPermission<InventoryItemWithCustomValues>(
      `/inventory/items?${backendParams.toString()}`,
      token,
      fetch,
    ),
  ]);

  // 403 on either endpoint → render <PermissionDenied />. Both go through the
  // same addon gate (`inventory`), so a denial on one implies a denial on the
  // other in practice; the OR keeps the contract explicit.
  const permissionDenied = listResult.permissionDenied || itemsResult.permissionDenied;

  return {
    permissionDenied,
    list: listResult.data?.list ?? null,
    fields: listResult.data?.fields ?? [],
    items: itemsResult.data,
    pagination: itemsResult.pagination,
    urlState,
  };
};
