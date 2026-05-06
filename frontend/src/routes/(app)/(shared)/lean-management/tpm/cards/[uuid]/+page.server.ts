/**
 * TPM Card Management - Server-Side Data Loading
 * @module lean-management/tpm/cards/[uuid]/+page.server
 *
 * SSR: The [uuid] param is the plan UUID. Cards list is paginated server-side.
 *
 * Phase 4.11b (2026-05-06): URL-state migration. URL contract: `?page` +
 * `?search` + `?status` + `?intervalType` + `?cardRole` (verbatim mirror of
 * backend `ListCardsQuerySchema` per §D5). Pagination + search UI ADDED in
 * 4.11b — both were absent pre-migration (cards silently truncated at the
 * hardcoded `limit=50`).
 *
 * Access: Root | Admin (scoped) | Employee Team-Lead. The plan-level
 * permission gate (`apiFetchWithPermission` on `/tpm/plans/:uuid`) protects
 * the cards list — a denied plan implies denied cards, so the cards fetch
 * uses base `apiFetchPaginated` and inherits the gate via the parent fetch.
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Migration order" row 4.11
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D6, D21, D22
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginated, apiFetchWithPermission } from '$lib/server/api-fetch';
import { assertTeamLevelAccess } from '$lib/server/manage-page-access';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { TpmCard, TpmPlan } from '../../_admin/types';

/** Subset of TpmLocation needed for card form dropdown + photo preview */
interface LocationOption {
  uuid: string;
  positionNumber: number;
  title: string;
  photoPath: string | null;
}

// =============================================================================
// URL CONTRACT — verbatim mirror of backend `ListCardsQuerySchema`
// =============================================================================

const STATUS_VALUES = ['', 'green', 'red', 'yellow', 'overdue'] as const;
const INTERVAL_VALUES = [
  '',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
  'custom',
] as const;
const ROLE_VALUES = ['', 'operator', 'maintenance'] as const;

type StatusFilter = (typeof STATUS_VALUES)[number];
type IntervalFilter = (typeof INTERVAL_VALUES)[number];
type RoleFilter = (typeof ROLE_VALUES)[number];

export interface CardsUrlState {
  page: number;
  search: string;
  status: StatusFilter;
  intervalType: IntervalFilter;
  cardRole: RoleFilter;
}

function readUrlState(url: URL): CardsUrlState {
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
    status: readFilterFromUrl<StatusFilter>(url, 'status', STATUS_VALUES, ''),
    intervalType: readFilterFromUrl<IntervalFilter>(url, 'intervalType', INTERVAL_VALUES, ''),
    cardRole: readFilterFromUrl<RoleFilter>(url, 'cardRole', ROLE_VALUES, ''),
  };
}

function buildBackendParams(planUuid: string, state: CardsUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('planUuid', planUuid);
  params.set('page', String(state.page));
  params.set('limit', '20');
  if (state.search !== '') params.set('search', state.search);
  if (state.status !== '') params.set('status', state.status);
  if (state.intervalType !== '') params.set('intervalType', state.intervalType);
  if (state.cardRole !== '') params.set('cardRole', state.cardRole);
  return params;
}

export const load: PageServerLoad = async ({ params, cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const { activeAddons, user, orgScope } = await parent();
  assertTeamLevelAccess(orgScope, { role: user?.role, pathname: url.pathname });
  requireAddon(activeAddons, 'tpm');

  const planUuid = params.uuid;
  const urlState = readUrlState(url);

  // Permission gate first — the plan fetch is the source of truth for whether
  // this user can see this plan's cards. If denied, render PermissionDenied
  // without firing the cards fetch.
  const planResult = await apiFetchWithPermission<TpmPlan>(`/tpm/plans/${planUuid}`, token, fetch);

  if (planResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      plan: null as TpmPlan | null,
      cards: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
      locations: [] as LocationOption[],
      planUuid,
      urlState,
    };
  }

  if (planResult.data === null) {
    redirect(302, '/lean-management/tpm');
  }

  const backendParams = buildBackendParams(planUuid, urlState);

  const [cardsResult, locationsData] = await Promise.all([
    apiFetchPaginated<TpmCard>(`/tpm/cards?${backendParams.toString()}`, token, fetch),
    apiFetch<LocationOption[]>(`/tpm/locations?planUuid=${planUuid}`, token, fetch),
  ]);

  return {
    permissionDenied: false as const,
    plan: planResult.data,
    cards: cardsResult.data,
    pagination: cardsResult.pagination,
    locations: Array.isArray(locationsData) ? locationsData : [],
    planUuid,
    urlState,
  };
};
