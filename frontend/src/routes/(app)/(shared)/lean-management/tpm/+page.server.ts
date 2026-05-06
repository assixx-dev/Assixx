/**
 * TPM Dashboard - Server-Side Data Loading
 * @module lean-management/tpm/+page.server
 *
 * SSR: Loads paginated maintenance plans + color config + interval matrix +
 * permissions in parallel. URL-state-driven pagination.
 *
 * Phase 4.11b (2026-05-06): URL-state migration via `apiFetchPaginatedWithPermission`
 * (§D6). URL contract: `?page` + `?search` (verbatim mirror of backend
 * `ListPlansQuerySchema` per §D5). The `?isActive` filter dropped — backend
 * `ListPlansQuerySchema` has no `isActive` field; client-side filtering over a
 * paginated subset would be the §D5/§D10/§D11/§D12 dishonest-UI pattern.
 * Recorded as Known Limitation #13.
 *
 * Access: Root | Admin (scoped) | Employee Team-Lead
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Migration order" row 4.11
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D6, D21, D22
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { assertTeamLevelAccess } from '$lib/server/manage-page-access';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { TpmPlan, TpmColorConfigEntry, IntervalMatrixEntry } from './_admin/types';

/** User's effective TPM permissions (mirrors backend TpmMyPermissions) */
interface TpmMyPermissions {
  plans: { canRead: boolean; canWrite: boolean; canDelete?: boolean };
  cards: { canRead: boolean; canWrite: boolean; canDelete?: boolean };
  executions: { canRead: boolean; canWrite: boolean };
  config: { canRead: boolean; canWrite: boolean };
  locations: { canRead: boolean; canWrite: boolean; canDelete?: boolean };
}

/** URL-state read once at the top of `load()` and threaded to the page. */
export interface DashboardUrlState {
  page: number;
  search: string;
}

function readUrlState(url: URL): DashboardUrlState {
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
  };
}

/** Build backend `URLSearchParams` from URL state — emits only non-default values. */
function buildBackendParams(state: DashboardUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(state.page));
  params.set('limit', '20');
  if (state.search !== '') params.set('search', state.search);
  return params;
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const { activeAddons, user, orgScope } = await parent();
  assertTeamLevelAccess(orgScope, { role: user?.role, pathname: url.pathname });
  requireAddon(activeAddons, 'tpm');

  const urlState = readUrlState(url);
  const backendParams = buildBackendParams(urlState);

  const plansResult = await apiFetchPaginatedWithPermission<TpmPlan>(
    `/tpm/plans?${backendParams.toString()}`,
    token,
    fetch,
  );

  if (plansResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      plans: [] as TpmPlan[],
      pagination: plansResult.pagination,
      colors: [] as TpmColorConfigEntry[],
      intervalMatrix: [] as IntervalMatrixEntry[],
      permissions: null as TpmMyPermissions | null,
      urlState,
    };
  }

  // Sibling fetches run in parallel — independent of permission gate result.
  const [colorsData, matrixData, permissionsData] = await Promise.all([
    apiFetch<TpmColorConfigEntry[]>('/tpm/config/colors', token, fetch),
    apiFetch<IntervalMatrixEntry[]>('/tpm/plans/interval-matrix', token, fetch),
    apiFetch<TpmMyPermissions>('/tpm/plans/my-permissions', token, fetch),
  ]);

  return {
    permissionDenied: false as const,
    plans: plansResult.data,
    pagination: plansResult.pagination,
    colors: Array.isArray(colorsData) ? colorsData : [],
    intervalMatrix: Array.isArray(matrixData) ? matrixData : [],
    permissions: permissionsData,
    urlState,
  };
};
