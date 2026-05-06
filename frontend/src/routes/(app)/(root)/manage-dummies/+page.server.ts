/**
 * Manage Dummies — Server-Side Data Loading (Phase 3.2 reference impl)
 * @module manage-dummies/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §3.2. SvelteKit re-runs this
 * load on every navigation; the page-level mutation handlers call
 * `invalidateAll()` to retrigger it after create/update/delete. There is
 * NO client-side state for `page` / `search` / `isActive` — the URL holds
 * all three, and `+page.svelte` reads them straight from `data` without
 * a `$state` shadow copy.
 *
 * Protected by `(root)/+layout.server.ts` group guard (ADR-012); only
 * role=root reaches this load function.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginated } from '$lib/server/api-fetch';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { DummyUser, Team } from './_lib/types';

/**
 * Status filter URL allow-list. The values mirror IS_ACTIVE codes from
 * `@assixx/shared/constants` (1=active, 0=inactive, 3=archived) plus 'all'
 * as the no-filter sentinel — string-typed because `URL.searchParams.get`
 * always returns strings and `readFilterFromUrl` is a string-enum parser.
 * Same alias the backend `dummy-users` `?isActive=N` query param accepts,
 * so server-side mapping is a one-line passthrough below.
 */
const STATUS_FILTERS = ['all', '0', '1', '3'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Fixed page size for the reference impl. Phase 4 pages may parameterise. */
const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  // URL → state. Each helper falls back to a defined default on missing or
  // tampered input — see `frontend/src/lib/utils/url-pagination.ts`.
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);
  // UX default: show only ACTIVE dummies on bare URL (`/manage-dummies`).
  // Was `'all'` until 2026-05; product feedback — admins want the live set
  // first, archived/inactive only on explicit toggle. Implication: FE-default
  // ('1') ≠ BE-default (no filter), so we MUST send `isActive=1` to the
  // backend on the canonical URL — the "defaults never sent" rule from R5
  // §0.2 only applies when FE-default == BE-default.
  const status = readFilterFromUrl<StatusFilter>(url, 'isActive', STATUS_FILTERS, '1');

  // State → backend query string. `'all'` is the no-filter sentinel and is
  // intentionally NOT forwarded — backend treats absent param as "all rows".
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  if (search !== '') params.set('search', search);
  if (status !== 'all') params.set('isActive', status);

  const [dummiesResult, teamsData] = await Promise.all([
    apiFetchPaginated<DummyUser>(`/dummy-users?${params.toString()}`, token, fetch),
    apiFetch<Team[]>('/teams', token, fetch),
  ]);

  return {
    dummies: dummiesResult.data,
    pagination: dummiesResult.pagination,
    teams: Array.isArray(teamsData) ? teamsData : [],
    search,
    // Convert string back to the `number | 'all'` type the existing
    // `StatusFilterTabs` component expects. Single conversion point.
    statusFilter: status === 'all' ? ('all' as const) : Number.parseInt(status, 10),
  };
};
