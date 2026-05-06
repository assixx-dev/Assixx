/**
 * Blackboard API
 *
 * Client-side fetch helpers for blackboard mutations and lookups.
 *
 * Listing is NOT here: `+page.server.ts` calls `apiFetchPaginatedWithPermission`
 * directly per FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.6 (Session 8c).
 * Pre-Phase-4.6 helpers `fetchEntries` + `buildQueryParams` were deleted as
 * dead code (mirrors the §4.5b KVP cleanup of `fetchSuggestions`).
 */

import { getApiClient } from '$lib/utils/api-client';

import type {
  BlackboardEntry,
  CreateEntryData,
  UpdateEntryData,
  Department,
  Team,
  Area,
} from './types';

const apiClient = getApiClient();

// ============================================================================
// Entry API Functions
// ============================================================================

/**
 * Fetch single entry by UUID
 */
export async function fetchEntryByUuid(uuid: string): Promise<BlackboardEntry | null> {
  try {
    // Backend returns entry directly (no wrapper)
    return await apiClient.get<BlackboardEntry>(`/blackboard/entries/${encodeURIComponent(uuid)}`);
  } catch (err: unknown) {
    // Return null for 404
    if (err !== null && typeof err === 'object' && 'status' in err && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Create new entry
 */
export async function createEntry(data: CreateEntryData): Promise<BlackboardEntry> {
  return await apiClient.post<BlackboardEntry>('/blackboard', data);
}

/**
 * Update existing entry
 */
export async function updateEntry(id: number, data: UpdateEntryData): Promise<BlackboardEntry> {
  return await apiClient.put<BlackboardEntry>(`/blackboard/${id}`, data);
}

/**
 * Delete entry
 */
export async function deleteEntry(id: number): Promise<void> {
  await apiClient.delete(`/blackboard/${id}`);
}

/**
 * Confirm entry (mark as read/confirmed)
 * Uses UUID for consistent API pattern
 */
export async function confirmEntry(uuid: string): Promise<boolean> {
  try {
    await apiClient.post(`/blackboard/entries/${uuid}/confirm`, {});
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Attachment API Functions
// ============================================================================

/**
 * Upload attachment to entry
 */
export async function uploadAttachment(entryId: number, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('attachment', file); // Backend expects 'attachment' field name

  await apiClient.upload(`/blackboard/entries/${entryId}/attachments`, formData);
}

/**
 * Delete attachment
 */
export async function deleteAttachment(attachmentId: number): Promise<void> {
  await apiClient.delete(`/blackboard/attachments/${attachmentId}`);
}

// ============================================================================
// Organization Data API Functions
// ============================================================================

/**
 * Fetch departments
 */
export async function fetchDepartments(): Promise<Department[]> {
  const data = await apiClient.get<{ data?: Department[] } | Department[]>('/departments');
  return Array.isArray(data) ? data : (data.data ?? []);
}

/**
 * Fetch teams
 */
export async function fetchTeams(): Promise<Team[]> {
  const data = await apiClient.get<{ data?: Team[] } | Team[]>('/teams');
  return Array.isArray(data) ? data : (data.data ?? []);
}

/**
 * Fetch areas
 */
export async function fetchAreas(): Promise<Area[]> {
  const data = await apiClient.get<{ data?: Area[] } | Area[]>('/areas');
  return Array.isArray(data) ? data : (data.data ?? []);
}

/**
 * Fetch all organization data at once
 */
export async function fetchOrganizations(): Promise<{
  departments: Department[];
  teams: Team[];
  areas: Area[];
}> {
  const [departments, teams, areas] = await Promise.all([
    fetchDepartments(),
    fetchTeams(),
    fetchAreas(),
  ]);

  return { departments, teams, areas };
}
