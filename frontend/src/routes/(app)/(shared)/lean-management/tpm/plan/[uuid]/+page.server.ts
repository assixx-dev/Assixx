/**
 * TPM Plan Detail - Server-Side Data Loading
 * @module lean-management/tpm/plan/[uuid]/+page.server
 *
 * SSR: Handles both create (uuid='new') and edit modes.
 * Access: Root | Admin (scoped) | Employee Team-Lead
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginated, apiFetchWithPermission } from '$lib/server/api-fetch';
import { assertTeamLevelAccess } from '$lib/server/manage-page-access';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';

import type { PageServerLoad } from './$types';
import type {
  TpmPlan,
  TpmTimeEstimate,
  Asset,
  TpmArea,
  TpmDepartment,
  IntervalColorConfigEntry,
} from '../../_admin/types';

/** Safely coerce nullable API result to array */
function safeArray<T>(data: T[] | null): T[] {
  return Array.isArray(data) ? data : [];
}

/**
 * Extract asset UUIDs from a flat plan array.
 *
 * Phase 4.11b (2026-05-06): switched from the `extractAssetUuids({data: ...})`
 * shim to a flat array — `apiFetchPaginated` returns `{data: TpmPlan[], pagination}`
 * after the canonical envelope unwrap, which the previous shim mis-read after
 * 4.11a backend rebuild. The picker stays at limit=500 (B2-class band-aid for
 * Phase 4.12 typeahead) — recorded in Known Limitation #13.
 */
function planAssetUuids(plans: TpmPlan[]): string[] {
  return plans
    .map((p: TpmPlan) => p.assetUuid)
    .filter((uuid: string | undefined): uuid is string => uuid !== undefined);
}

/** Empty data returned when permission is denied */
function buildDeniedResult() {
  return {
    permissionDenied: true as const,
    isCreateMode: false,
    plan: null as TpmPlan | null,
    timeEstimates: [] as TpmTimeEstimate[],
    assets: [] as Asset[],
    areas: [] as TpmArea[],
    departments: [] as TpmDepartment[],
    intervalColors: [] as IntervalColorConfigEntry[],
  };
}

/** Scoped org data response from GET /tpm/plans/my-assets */
interface ScopedOrgData {
  areas: TpmArea[];
  departments: TpmDepartment[];
  assets: Asset[];
}

/** Load scoped org data (areas, departments, assets within user's scope) + interval colors */
async function loadOrgData(
  token: string,
  fetchFn: typeof fetch,
): Promise<{
  assets: Asset[];
  areas: TpmArea[];
  departments: TpmDepartment[];
  intervalColors: IntervalColorConfigEntry[];
}> {
  const [orgData, ic] = await Promise.all([
    apiFetch<ScopedOrgData>('/tpm/plans/my-assets', token, fetchFn),
    apiFetch<IntervalColorConfigEntry[]>('/tpm/config/interval-colors', token, fetchFn),
  ]);
  return {
    assets: safeArray(orgData?.assets ?? null),
    areas: safeArray(orgData?.areas ?? null),
    departments: safeArray(orgData?.departments ?? null),
    intervalColors: safeArray(ic),
  };
}

export const load: PageServerLoad = async ({ params, cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const { activeAddons, user, orgScope } = await parent();
  assertTeamLevelAccess(orgScope, { role: user?.role, pathname: url.pathname });
  requireAddon(activeAddons, 'tpm');

  const isCreateMode = params.uuid === 'new';

  // Permission check: use plans list for create, plan detail for edit
  const permEndpoint = isCreateMode ? '/tpm/plans?page=1&limit=1' : `/tpm/plans/${params.uuid}`;
  const permResult = await apiFetchWithPermission<unknown>(permEndpoint, token, fetch);
  if (permResult.permissionDenied) return buildDeniedResult();

  const shared = await loadOrgData(token, fetch);

  if (isCreateMode) {
    const plansResult = await apiFetchPaginated<TpmPlan>(
      '/tpm/plans?page=1&limit=500',
      token,
      fetch,
    );
    return {
      permissionDenied: false as const,
      isCreateMode: true,
      plan: null,
      timeEstimates: [],
      ...shared,
      assetUuidsWithPlans: planAssetUuids(plansResult.data),
    };
  }

  // Edit mode: plan already fetched via permResult
  const planData = permResult.data as TpmPlan | null;
  if (planData === null) redirect(302, '/lean-management/tpm');

  const estimatesData = await apiFetch<TpmTimeEstimate[]>(
    `/tpm/plans/${params.uuid}/time-estimates`,
    token,
    fetch,
  );

  return {
    permissionDenied: false as const,
    isCreateMode: false,
    plan: planData,
    timeEstimates: safeArray(estimatesData),
    ...shared,
  };
};
