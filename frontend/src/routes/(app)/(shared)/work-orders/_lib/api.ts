// =============================================================================
// Work Orders — API FUNCTIONS
// =============================================================================

import { getApiClient } from '$lib/utils/api-client';
import { extractArray } from '$lib/utils/api-response';
import { createLogger } from '$lib/utils/logger';

import type {
  AssignUsersPayload,
  CreateWorkOrderPayload,
  EligibleUser,
  UpdateStatusPayload,
  UpdateWorkOrderPayload,
  WorkOrder,
  WorkOrderAssignee,
  WorkOrderComment,
  WorkOrderPhoto,
  WorkOrderStats,
} from './types';

const log = createLogger('WorkOrdersApi');
const apiClient = getApiClient();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Local return shape for `extractPaginated` — kept ONLY for `fetchComments`
 * below, which still consumes the legacy flat `{ items, total, page, pageSize }`
 * envelope from `WorkOrderCommentsService.listComments` (same drift class as the
 * pre-Phase-4.7a list endpoints; comments rarely > 20 in practice → not a Beta
 * blocker, deferred to V2).
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Known Limitations" #10
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D15
 */
interface LegacyCommentsPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY_PAGE: LegacyCommentsPage<never> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

function numberOr(val: unknown, fallback: number): number {
  return typeof val === 'number' ? val : fallback;
}

/** Type-safe extraction of paginated data from API response (legacy comments envelope only) */
function extractPaginated<T>(result: unknown): LegacyCommentsPage<T> {
  if (result === null || typeof result !== 'object') return EMPTY_PAGE;
  const obj = result as Record<string, unknown>;
  const items =
    Array.isArray(obj.data) ? (obj.data as T[])
    : Array.isArray(obj.items) ? (obj.items as T[])
    : [];
  return {
    items,
    total: numberOr(obj.total, 0),
    page: numberOr(obj.page, 1),
    pageSize: numberOr(obj.pageSize ?? obj.limit, 20),
  };
}

// =============================================================================
// CORE CRUD
// =============================================================================

/** Create a new work order */
export async function createWorkOrder(payload: CreateWorkOrderPayload): Promise<WorkOrder> {
  return await apiClient.post<WorkOrder>('/work-orders', payload);
}

/** Fetch a single work order by UUID (full detail with assignees) */
export async function fetchWorkOrder(uuid: string): Promise<WorkOrder> {
  return await apiClient.get<WorkOrder>(`/work-orders/${uuid}`);
}

// Phase 4.7b (2026-05-06): `fetchWorkOrders` + `fetchMyWorkOrders` + `applyFilters`
// removed. Both list views now load via `apiFetchPaginatedWithPermission` from
// `+page.server.ts` (SSR), so the client-side fetchers were dead post-migration.
// `extractPaginated` is intentionally retained for `fetchComments` only — see
// the LegacyCommentsPage<T> JSDoc above for the V2 boundary (Known Limitation #10).
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Migration order" row 4.7
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D15

/** Update a work order (admin only) */
export async function updateWorkOrder(
  uuid: string,
  payload: UpdateWorkOrderPayload,
): Promise<WorkOrder> {
  return await apiClient.patch<WorkOrder>(`/work-orders/${uuid}`, payload);
}

/** Archive a work order (admin only) — work orders are never deleted */
export async function archiveWorkOrder(uuid: string): Promise<void> {
  await apiClient.patch(`/work-orders/${uuid}/archive`, {});
}

/** Restore an archived work order back to active (admin only) */
export async function restoreWorkOrder(uuid: string): Promise<void> {
  await apiClient.patch(`/work-orders/${uuid}/restore`, {});
}

// =============================================================================
// READ TRACKING
// =============================================================================

/** Mark a work order as read (idempotent — safe to call multiple times) */
export async function markWorkOrderAsRead(uuid: string): Promise<void> {
  try {
    await apiClient.post(`/work-orders/${uuid}/read`, {});
  } catch (err: unknown) {
    logApiError('markWorkOrderAsRead', err);
  }
}

// =============================================================================
// STATUS
// =============================================================================

/** Update work order status (employee + admin) */
export async function updateStatus(uuid: string, payload: UpdateStatusPayload): Promise<void> {
  await apiClient.patch(`/work-orders/${uuid}/status`, payload);
}

// =============================================================================
// ASSIGNEES
// =============================================================================

/** Assign users to a work order (admin only) */
export async function assignUsers(
  uuid: string,
  payload: AssignUsersPayload,
): Promise<WorkOrderAssignee[]> {
  return await apiClient.post<WorkOrderAssignee[]>(`/work-orders/${uuid}/assignees`, payload);
}

/** Remove an assignee from a work order (admin only) */
export async function removeAssignee(uuid: string, userUuid: string): Promise<void> {
  await apiClient.delete(`/work-orders/${uuid}/assignees/${userUuid}`);
}

/** Fetch eligible users for assignment (team-filtered if assetId given) */
export async function fetchEligibleUsers(assetId?: number): Promise<EligibleUser[]> {
  const url =
    assetId !== undefined ?
      `/work-orders/eligible-users?assetId=${assetId}`
    : '/work-orders/eligible-users';
  const result: unknown = await apiClient.get(url);
  return extractArray<EligibleUser>(result);
}

// =============================================================================
// COMMENTS
// =============================================================================

/** Add a comment (or reply) to a work order */
export async function addComment(
  uuid: string,
  content: string,
  parentId?: number,
): Promise<boolean> {
  try {
    await apiClient.post<WorkOrderComment>(
      `/work-orders/${uuid}/comments`,
      parentId !== undefined ? { content, parentId } : { content },
    );
    return true;
  } catch (err: unknown) {
    logApiError('addComment', err);
    return false;
  }
}

/** Fetch paginated top-level comments (offset-based for lazy loading) */
export async function fetchComments(
  uuid: string,
  limit = 20,
  offset = 0,
): Promise<{ comments: WorkOrderComment[]; total: number; hasMore: boolean }> {
  const page = Math.floor(offset / limit) + 1;
  const result: unknown = await apiClient.get(
    `/work-orders/${uuid}/comments?page=${page}&limit=${limit}`,
  );
  const paginated = extractPaginated<WorkOrderComment>(result);
  return {
    comments: paginated.items,
    total: paginated.total,
    hasMore: offset + paginated.items.length < paginated.total,
  };
}

/** Fetch all replies for a specific comment */
export async function fetchReplies(uuid: string, commentId: number): Promise<WorkOrderComment[]> {
  const result: unknown = await apiClient.get(`/work-orders/${uuid}/comments/${commentId}/replies`);
  return extractArray<WorkOrderComment>(result);
}

// =============================================================================
// PHOTOS
// =============================================================================

/** Upload a photo to a work order */
export async function uploadPhoto(uuid: string, file: File): Promise<WorkOrderPhoto> {
  const formData = new FormData();
  formData.append('file', file);
  return await apiClient.post<WorkOrderPhoto>(`/work-orders/${uuid}/photos`, formData);
}

/** Fetch photos for a work order */
export async function fetchPhotos(uuid: string): Promise<WorkOrderPhoto[]> {
  const result: unknown = await apiClient.get(`/work-orders/${uuid}/photos`);
  return extractArray<WorkOrderPhoto>(result);
}

/** Delete a photo from a work order */
export async function deletePhoto(uuid: string, photoUuid: string): Promise<void> {
  await apiClient.delete(`/work-orders/${uuid}/photos/${photoUuid}`);
}

// =============================================================================
// STATS
// =============================================================================

/** Fetch work order stats (counts per status) for dashboard — all (admin) */
export async function fetchStats(): Promise<WorkOrderStats> {
  return await apiClient.get<WorkOrderStats>('/work-orders/stats');
}

/** Fetch work order stats filtered to current user's assignments */
export async function fetchMyStats(): Promise<WorkOrderStats> {
  return await apiClient.get<WorkOrderStats>('/work-orders/my/stats');
}

// =============================================================================
// ERROR HELPERS
// =============================================================================

/** Log API error with context */
export function logApiError(context: string, err: unknown): void {
  log.error({ err }, `WorkOrders API error: ${context}`);
}
