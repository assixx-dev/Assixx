/**
 * TPM Employee Overview — Server-Side Data Loading
 * @module shared/lean-management/tpm/+page.server
 *
 * SSR: Loads employee-visible maintenance plans, board data per plan,
 * and color config in parallel.
 *
 * Phase 4.11b (2026-05-06): switched to canonical `apiFetchPaginated*` after
 * 4.11a backend envelope rebuild. The legacy `extractPlans/extractCards`
 * shims read `obj.data || obj.items` — but post-4.11a `extractResponseData`
 * lifts the array to the top level, so neither key existed and the shim
 * silently returned `[]`. This is a non-paginated overview view; the
 * pagination metadata from the helper is intentionally discarded — limit=50
 * (plans) and limit=200 (per-plan cards) are visual ceilings recorded in
 * Known Limitation #13 alongside the dashboard's status filter.
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D22
 */
import { redirect } from '@sveltejs/kit';

import {
  apiFetch,
  apiFetchPaginated,
  apiFetchPaginatedWithPermission,
} from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';

import type { PageServerLoad } from './$types';
import type {
  TpmPlan,
  TpmCard,
  TpmColorConfigEntry,
  AssetWithTpmStatus,
  StatusCounts,
} from '../_lib/types';

/** Count card statuses from a list of cards */
function countStatuses(cards: TpmCard[]): StatusCounts {
  let green = 0;
  let red = 0;
  let yellow = 0;
  let overdue = 0;

  for (const card of cards) {
    if (card.status === 'green') green++;
    else if (card.status === 'red') red++;
    else if (card.status === 'yellow') yellow++;
    else overdue++;
  }

  return { green, red, yellow, overdue, total: cards.length };
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const parentData = await parent();
  requireAddon(parentData.activeAddons, 'tpm');

  // Phase 1: Fetch plans (permission-aware) + colors in parallel.
  // limit=50 is a visual ceiling — see Known Limitation #13.
  const [plansResult, colorsData] = await Promise.all([
    apiFetchPaginatedWithPermission<TpmPlan>('/tpm/plans?page=1&limit=50', token, fetch),
    apiFetch<TpmColorConfigEntry[]>('/tpm/config/colors', token, fetch),
  ]);

  if (plansResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      assets: [] as AssetWithTpmStatus[],
      colors: [] as TpmColorConfigEntry[],
    };
  }

  const plans = plansResult.data;
  const colors = Array.isArray(colorsData) ? colorsData : [];

  // Phase 2: Fetch board data (cards) for each plan in parallel.
  // limit=200 is a visual ceiling — see Known Limitation #13.
  const boardPromises = plans.map((plan: TpmPlan) =>
    apiFetchPaginated<TpmCard>(`/tpm/plans/${plan.uuid}/board?page=1&limit=200`, token, fetch),
  );
  const boardResults = await Promise.all(boardPromises);

  // Build asset-with-status list
  const assets: AssetWithTpmStatus[] = plans.map((plan: TpmPlan, idx: number) => {
    const cards = boardResults[idx]?.data ?? [];
    return {
      plan,
      statusCounts: countStatuses(cards),
      cards,
    };
  });

  return { permissionDenied: false as const, assets, colors };
};
