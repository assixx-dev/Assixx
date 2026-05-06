/**
 * TPM Kamishibai Board — Server-Side Data Loading
 * Loads plan + all cards + colors in parallel.
 * [uuid] = plan UUID (linked from employee asset overview)
 *
 * Phase 4.11b (2026-05-06): switched cards fetch to `apiFetchPaginated` after
 * 4.11a backend envelope rebuild. The legacy `extractCards` shim broke when
 * the canonical envelope lifted the array to the top of `extractResponseData`.
 * Pagination metadata discarded — board is a visual swim-lane, not a list view;
 * limit=200 is a visual ceiling recorded in Known Limitation #13.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginated, apiFetchWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';

import type { PageServerLoad } from './$types';
import type {
  TpmPlan,
  TpmCard,
  TpmColorConfigEntry,
  IntervalColorConfigEntry,
  CategoryColorConfigEntry,
} from '../../_lib/types';

async function fetchBoardData(token: string, fetchFn: typeof fetch, planUuid: string) {
  return await Promise.all([
    apiFetchWithPermission<TpmPlan>(`/tpm/plans/${planUuid}`, token, fetchFn),
    apiFetchPaginated<TpmCard>(`/tpm/plans/${planUuid}/board?page=1&limit=200`, token, fetchFn),
    apiFetch<TpmColorConfigEntry[]>('/tpm/config/colors', token, fetchFn),
    apiFetch<IntervalColorConfigEntry[]>('/tpm/config/interval-colors', token, fetchFn),
    apiFetch<CategoryColorConfigEntry[]>('/tpm/config/category-colors', token, fetchFn),
  ]);
}

function buildBoardDeniedResponse(planUuid: string) {
  return {
    permissionDenied: true as const,
    planUuid,
    plan: null,
    cards: [] as TpmCard[],
    colors: [] as TpmColorConfigEntry[],
    intervalColors: [] as IntervalColorConfigEntry[],
    categoryColors: [] as CategoryColorConfigEntry[],
    userRole: 'employee',
  };
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, params, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '')
    redirect(302, buildLoginUrl('session-expired', undefined, url));

  const parentData = await parent();
  requireAddon(parentData.activeAddons, 'tpm');

  const { uuid: planUuid } = params;
  const [planResult, boardResult, colorsData, intervalColorsData, categoryColorsData] =
    await fetchBoardData(token, fetch, planUuid);

  if (planResult.permissionDenied) {
    return buildBoardDeniedResponse(planUuid);
  }

  return {
    permissionDenied: false as const,
    planUuid,
    plan: planResult.data,
    cards: boardResult.data,
    colors: Array.isArray(colorsData) ? colorsData : [],
    intervalColors: Array.isArray(intervalColorsData) ? intervalColorsData : [],
    categoryColors: Array.isArray(categoryColorsData) ? categoryColorsData : [],
    userRole: parentData.user?.role ?? 'employee',
  };
};
