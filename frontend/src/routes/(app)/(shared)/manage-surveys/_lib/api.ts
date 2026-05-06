// =============================================================================
// SURVEY-ADMIN — API FUNCTIONS (Phase 4.10b cleanup)
//
// Phase 4.10b (2026-05-06) trimmed the legacy client-side load functions —
// `loadSurveys`, `loadTemplates`, `loadDepartments`, `loadTeams`, `loadAreas`,
// `createFromTemplate` were the manual-fetch counterparts of what the
// `+page.server.ts` SSR load now does in parallel. After the URL-driven
// rewrite, the only mutation flows that still need a client-side API call
// are: get-by-id (for edit modal), create / update / delete / complete.
// All other reads come from SSR data via `$derived(data.X)` and refresh via
// `invalidateAll()`. See FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.10b.
// =============================================================================

import { getApiClient } from '$lib/utils/api-client';
import { createLogger } from '$lib/utils/logger';
import { checkSessionExpired } from '$lib/utils/session-expired.js';

import { API_ENDPOINTS } from './constants';

import type { Survey, SurveyApiResponse, SurveyFormData } from './types';

const log = createLogger('SurveyAdminApi');

const apiClient = getApiClient();

// =============================================================================
// SURVEYS — CRUD only (reads come from SSR via $derived)
// =============================================================================

/**
 * Load survey by ID — used by `loadSurveyForEdit` to populate the edit
 * modal. Cannot come from SSR data because the list rows omit nested
 * questions / assignments / option text.
 */
export async function loadSurveyById(surveyId: number | string): Promise<Survey | null> {
  try {
    return await apiClient.get<Survey>(API_ENDPOINTS.surveyById(surveyId));
  } catch (err: unknown) {
    log.error({ err, surveyId }, 'Error loading survey');
    checkSessionExpired(err);
    return null;
  }
}

/**
 * Create survey
 */
export async function createSurvey(
  data: SurveyFormData,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const response = await apiClient.post<SurveyApiResponse>(API_ENDPOINTS.SURVEYS, data);
    const surveyId = response.surveyId ?? response.id;
    return { success: true, id: surveyId };
  } catch (err: unknown) {
    log.error({ err }, 'Error creating survey');
    checkSessionExpired(err);
    const message = err instanceof Error ? err.message : 'Fehler beim Erstellen der Umfrage';
    return { success: false, error: message };
  }
}

/**
 * Update survey
 */
export async function updateSurvey(
  surveyId: number | string,
  data: SurveyFormData,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiClient.put(API_ENDPOINTS.surveyById(surveyId), data);
    return { success: true };
  } catch (err: unknown) {
    log.error({ err, surveyId }, 'Error updating survey');
    checkSessionExpired(err);
    const message = err instanceof Error ? err.message : 'Fehler beim Aktualisieren der Umfrage';
    return { success: false, error: message };
  }
}

/**
 * Complete (end) a survey by setting its status to 'completed'.
 * Uses the existing PUT endpoint with COALESCE -- only status changes.
 */
export async function completeSurvey(
  surveyId: number | string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiClient.put(API_ENDPOINTS.surveyById(surveyId), {
      status: 'completed',
    });
    return { success: true };
  } catch (err: unknown) {
    log.error({ err, surveyId }, 'Error completing survey');
    checkSessionExpired(err);
    const message = err instanceof Error ? err.message : 'Fehler beim Beenden der Umfrage';
    return { success: false, error: message };
  }
}

/**
 * Delete survey
 */
export async function deleteSurvey(
  surveyId: number | string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiClient.delete(API_ENDPOINTS.surveyById(surveyId));
    return { success: true };
  } catch (err: unknown) {
    log.error({ err, surveyId }, 'Error deleting survey');
    checkSessionExpired(err);
    const message = err instanceof Error ? err.message : 'Fehler beim Löschen der Umfrage';
    return { success: false, error: message };
  }
}
