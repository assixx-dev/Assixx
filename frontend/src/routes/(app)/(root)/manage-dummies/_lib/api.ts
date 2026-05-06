// =============================================================================
// Manage Dummies — API FUNCTIONS
// =============================================================================

import { getApiClient } from '$lib/utils/api-client';
import { extractArray } from '$lib/utils/api-response';
import { createLogger } from '$lib/utils/logger';

import type { CreateDummyPayload, DummyUser, Team, UpdateDummyPayload } from './types';

const log = createLogger('DummyUsersApi');
const apiClient = getApiClient();

// =============================================================================
// CORE CRUD
// =============================================================================
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §3.2 (2026-05-04):
// Listing dummies is now URL-driven via the server load function
// (`+page.server.ts` calls `apiFetchPaginated<DummyUser>`). The legacy
// client-side `listDummies()` + `extractPaginated()` helpers were removed
// because every navigation/filter/search change now goes through SvelteKit's
// `goto()` → `load` re-run pipeline, and mutations use `invalidateAll()` to
// retrigger the same load. This file keeps only the create/get/update/delete
// helpers used by the page's mutation flow.

/** Create a new dummy user */
export async function createDummy(payload: CreateDummyPayload): Promise<DummyUser> {
  return await apiClient.post<DummyUser>('/dummy-users', payload);
}

/** Fetch a single dummy user by UUID */
export async function getDummy(uuid: string): Promise<DummyUser> {
  return await apiClient.get<DummyUser>(`/dummy-users/${uuid}`);
}

/** Update a dummy user */
export async function updateDummy(uuid: string, payload: UpdateDummyPayload): Promise<DummyUser> {
  return await apiClient.put<DummyUser>(`/dummy-users/${uuid}`, payload);
}

/** Soft-delete a dummy user (is_active=4) */
export async function deleteDummy(uuid: string): Promise<void> {
  await apiClient.delete(`/dummy-users/${uuid}`);
}

// =============================================================================
// TEAMS
// =============================================================================

/** Fetch all teams for team multi-select */
export async function loadTeams(): Promise<Team[]> {
  const result: unknown = await apiClient.get('/teams');
  return extractArray<Team>(result);
}

// =============================================================================
// ERROR HELPERS
// =============================================================================

/** Log API error with context */
export function logApiError(context: string, err: unknown): void {
  log.error({ err }, `DummyUsers API error: ${context}`);
}
