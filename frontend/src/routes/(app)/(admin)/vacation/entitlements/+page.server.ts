/**
 * Vacation Entitlements — Server-Side Data Loading (Phase 5.2.1 URL-driven state)
 * @module vacation/entitlements/+page.server
 *
 * URL is the single source of truth for pagination + search per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §5.2.1. Mirrors the canonical
 * Phase-3 reference impl (`manage-dummies/+page.server.ts`) and the
 * Phase-4.1b sibling (`manage-employees/+page.server.ts`).
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `(admin)/+layout.server.ts` (route group RBAC, ADR-012)
 *   Layer 1 — `requireAddon(activeAddons, 'vacation')` (addon gate, ADR-033)
 *   Layer 2 — backend `@RequirePermission(VACATION_ADDON, …, 'canRead')`
 *             produces 403 → `apiFetchPaginatedWithPermission` surfaces it as
 *             `permissionDenied: true` so `+page.svelte` can render
 *             `<PermissionDenied />` (ADR-020).
 *
 * Status filter is NOT exposed: vacation entitlements are managed only for
 * active users by design — `isActive=1` hardcoded in the backend query
 * (no URL param, no UI toggle). Same active-only-by-design pattern as the
 * `tenant_storage` placeholder in ADR-033.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { EmployeeListItem } from './_lib/types';

interface RawUser {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  position: string | null;
  employeeNumber?: string;
  teamNames?: string[];
}

/**
 * Page size for vacation/entitlements. 25 mirrors manage-employees (§4.1b)
 * and manage-admins (§4.2) for cross-page UX consistency. Backend cap is
 * 100 (PaginationSchema.max in `common.schema.ts`).
 */
const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const { activeAddons } = await parent();
  requireAddon(activeAddons, 'vacation');

  const currentYear = new Date().getFullYear();

  // URL → state. Each helper falls back to a safe default on missing/tampered
  // input — see `frontend/src/lib/utils/url-pagination.ts`.
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);

  // State → backend query string. Defaults are NEVER sent to the backend
  // (R5 mitigation §0.2: clean canonical URLs for default state).
  // `isActive=1` + `sortBy=lastName&sortOrder=asc` are structural — entitlement
  // management never operates over inactive/archived users, and surname-asc
  // matches the rest of the user-list UX.
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  params.set('isActive', '1');
  params.set('sortBy', 'lastName');
  params.set('sortOrder', 'asc');
  if (search !== '') params.set('search', search);

  const usersResult = await apiFetchPaginatedWithPermission<RawUser>(
    `/users?${params.toString()}`,
    token,
    fetch,
  );

  if (usersResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      employees: [] as EmployeeListItem[],
      pagination: usersResult.pagination,
      search: '',
      currentYear,
    };
  }

  const employees: EmployeeListItem[] = usersResult.data.map((u: RawUser) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    position: u.position,
    employeeNumber: u.employeeNumber,
    teamNames: u.teamNames,
  }));

  return {
    permissionDenied: false as const,
    employees,
    pagination: usersResult.pagination,
    search,
    currentYear,
  };
};
