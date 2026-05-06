/**
 * Manage Root Users — Server-Side Data Loading (Phase 5.2.2 URL-driven state)
 * @module manage-root/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §5.2.2. Mirrors `manage-admins`
 * (§4.2) verbatim — both pages live under `(root)`, so the helper is the
 * base `apiFetchPaginated<T>`, NOT `apiFetchPaginatedWithPermission<T>`.
 *
 * `data.tenantVerified` arrives via layout-data inheritance (set in the
 * `(root)/+layout.server.ts`); this load function does not need to fetch
 * it and the page consumes `data.tenantVerified` directly.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginated } from '$lib/server/api-fetch';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { createLogger } from '$lib/utils/logger';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { RootUser } from './_lib/types';

const log = createLogger('ManageRoot');

/**
 * Status filter URL allow-list. Numeric IS_ACTIVE codes (0=inactive,
 * 1=active, 3=archived) plus `'all'` as no-filter sentinel — string-typed
 * because `URL.searchParams.get` always returns strings. Same convention
 * as `manage-admins` (§4.2 D5) so the URL surface stays consistent across
 * all root-only pages and the backend `/users?isActive=N` query param
 * accepts the values verbatim (no FE-side aliasing layer).
 */
const STATUS_FILTERS = ['all', '0', '1', '3'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Page size for manage-root. 25 matches the pre-Phase-5.2.2 `ROOTS_PER_PAGE`
 * constant — preserves UX continuity. Backend cap is 100
 * (PaginationSchema.max in `common.schema.ts`).
 */
const PAGE_SIZE = 25;

/** Position-API response shape (kept locally — only consumer of these fields). */
interface PositionOption {
  id: string;
  name: string;
  roleCategory: string;
}

export const load: PageServerLoad = async ({ cookies, fetch, locals, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  // Get current user ID from locals (set by RBAC hook) — needed for the
  // self-exclusion filter below (the current user edits themselves on
  // /root-profile, not here).
  const currentUserId = locals.user?.id ?? null;

  // URL → state. Each helper falls back to a safe default on missing/tampered
  // input — see `frontend/src/lib/utils/url-pagination.ts`.
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);
  // UX default: show only ACTIVE root users on bare URL (`/manage-root`).
  // Was `'all'` until 2026-05; product feedback — admins want the live set
  // first, archived/inactive only on explicit toggle. Implication: FE-default
  // ('1') ≠ BE-default (no filter), so we MUST send `isActive=1` to the
  // backend on the canonical URL — the "defaults never sent" rule from R5
  // §0.2 only applies when FE-default == BE-default.
  const status = readFilterFromUrl<StatusFilter>(url, 'isActive', STATUS_FILTERS, '1');

  // State → backend query string. `'all'` is the no-filter sentinel and is
  // intentionally NOT forwarded — backend treats absent param as "all rows".
  const params = new URLSearchParams();
  params.set('role', 'root');
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  if (search !== '') params.set('search', search);
  if (status !== 'all') params.set('isActive', status);

  // Parallel fetch: paginated root users + positions catalog.
  const [rootUsersResult, positionsData] = await Promise.all([
    apiFetchPaginated<RootUser>(`/users?${params.toString()}`, token, fetch),
    apiFetch<PositionOption[]>('/organigram/positions', token, fetch),
  ]);

  // Defensive role filter: backend already filters by `?role=root`, but a
  // future query-param drift bug could leak admins/employees into the
  // response. One predicate, costs nothing, prevents wrong-role rendering.
  // Mirrors §4.1b/§4.2 pattern.
  const allRootUsers = rootUsersResult.data.filter(
    (u: RootUser & { role?: string }) => u.role === undefined || u.role === 'root',
  );

  // Exclude current user — they edit themselves on /root-profile.
  // NOTE: with server-side pagination this self-filter operates on the
  // current page slice only; if the current user happens to be on page N,
  // page N renders with PAGE_SIZE-1 entries. Acceptable trade-off — the
  // backend `?role=root` query has no native "exclude self" param.
  const rootUsers = allRootUsers.filter((u: RootUser): boolean => u.id !== currentUserId);

  log.debug(
    {
      page,
      pageSize: PAGE_SIZE,
      total: rootUsersResult.pagination.total,
      afterFilter: rootUsers.length,
      excludedCurrentUserId: currentUserId,
    },
    'Root users loaded (SSR, paginated)',
  );

  return {
    rootUsers,
    pagination: rootUsersResult.pagination,
    positionOptions:
      Array.isArray(positionsData) ?
        positionsData.map((p: PositionOption) => ({
          id: p.id,
          name: p.name,
          roleCategory: p.roleCategory,
        }))
      : [],
    search,
    // Convert URL string back to `number | 'all'` for the existing toggle
    // buttons. Single conversion point — UI stays numeric, URL stays string.
    statusFilter: status === 'all' ? ('all' as const) : Number.parseInt(status, 10),
  };
};
