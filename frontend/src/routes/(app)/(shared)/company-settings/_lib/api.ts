/**
 * Company Settings - API Functions
 * @module company-settings/_lib/api
 */

import { getApiClient } from '$lib/utils/api-client';
import { createLogger } from '$lib/utils/logger';

import { MESSAGES } from './constants';

import type {
  DeletionStatusData,
  DeletionQueueResponse,
  DeletionStatusResponse,
  RootUsersResponse,
  ShiftTimeData,
} from './types';

const log = createLogger('CompanySettingsApi');

const apiClient = getApiClient();

// NOTE: previous `parseJwtPayload`, `getAccessToken`, and `checkAuthRole`
// (removed 2026-05-06) read `localStorage.getItem(STORAGE_KEYS.accessToken)`,
// but `STORAGE_KEYS` exposes `ACCESS_TOKEN` (UPPER_SNAKE), not `accessToken`
// — so the lookup was `localStorage.getItem(undefined)` and always returned
// null. The functions had zero external callers (dead code). Auth identity
// is centralised in `apiClient` + the SSR `parent()` user load. See
// ADR-005 (auth strategy) + ADR-046 (cookie shape).

/** Load pending deletion status */
export async function loadDeletionStatus(): Promise<DeletionStatusData | null> {
  try {
    const result = await apiClient.get<DeletionStatusResponse | DeletionStatusData | null>(
      '/root/tenant/deletion-status',
    );

    if (result === null) {
      return null;
    }

    // Handle wrapped response
    if ('data' in result && result.data && 'queueId' in result.data) {
      return result.data;
    }

    if ('queueId' in result) {
      return result;
    }

    return null;
  } catch {
    // No pending deletion - this is expected in most cases
    return null;
  }
}

/** Get count of root users in tenant */
export async function getRootUserCount(): Promise<number> {
  try {
    const result = await apiClient.get<RootUsersResponse | { id: number }[]>('/root/users');

    if (Array.isArray(result)) {
      return result.length;
    }

    if (result.users !== undefined && Array.isArray(result.users)) {
      return result.users.length;
    }

    return 0;
  } catch (err: unknown) {
    log.error({ err }, 'Error fetching root users');
    return 0;
  }
}

/** Delete tenant (initiates deletion request) */
export async function deleteTenant(reason: string): Promise<DeletionQueueResponse> {
  return await apiClient.delete('/root/tenants/current', {
    reason: reason !== '' ? reason : MESSAGES.defaultReason,
  });
}

// =============================================================================
// Shift Times API
// =============================================================================

/** Load shift times for current tenant */
export async function loadShiftTimes(): Promise<ShiftTimeData[]> {
  try {
    const result = await apiClient.get<ShiftTimeData[]>('/shift-times');
    return Array.isArray(result) ? result : [];
  } catch (err: unknown) {
    log.error({ err }, 'Error fetching shift times');
    return [];
  }
}

/** Save all shift times at once */
export async function saveShiftTimes(
  shiftTimes: {
    shiftKey: string;
    label: string;
    startTime: string;
    endTime: string;
  }[],
): Promise<ShiftTimeData[]> {
  return await apiClient.put<ShiftTimeData[]>('/shift-times', { shiftTimes });
}

/** Reset shift times to system defaults */
export async function resetShiftTimes(): Promise<ShiftTimeData[]> {
  return await apiClient.post<ShiftTimeData[]>('/shift-times/reset', {});
}

// =============================================================================
// Security Settings API — user-password-change-policy (Root only)
// =============================================================================

/**
 * Persist the "allow user password change" policy for the current tenant.
 *
 * Only Root may call this endpoint (backend enforces via `@Roles('root')`).
 * Returns the new value echoed by the server so the caller can trust the
 * persisted state even if the local checkbox gets out of sync.
 *
 * See ADR-045 + user-request 2026-04-20.
 */
export async function saveUserPasswordChangePolicy(
  allowed: boolean,
): Promise<{ allowed: boolean }> {
  return await apiClient.put<{ allowed: boolean }>(
    '/security-settings/user-password-change-policy',
    { allowed },
  );
}
