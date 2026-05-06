/**
 * Manage Areas - Server-Side Data Loading (Scope-Filtered)
 * @module manage-areas/+page.server
 *
 * SSR: Loads areas + departments + potential leads in parallel.
 * Access: Root (all) | Admin (scoped) — NO Employee access (D1=NEIN)
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchWithPermission } from '$lib/server/api-fetch';
import { assertAdminLevelAccess } from '$lib/server/manage-page-access';
import { buildLoginUrl } from '$lib/utils/build-apex-url';

import type { PageServerLoad } from './$types';
import type { Area, Department, Hall } from './_lib/types';

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const { user, orgScope } = await parent();
  assertAdminLevelAccess(orgScope, {
    role: user?.role,
    pathname: url.pathname,
  });

  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  // Permission check: first fetch detects 403 (ADR-020 pattern)
  const areasResult = await apiFetchWithPermission<Area[]>('/areas', token, fetch);
  if (areasResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      areas: [] as Area[],
      departments: [] as Department[],
      halls: [] as Hall[],
    };
  }

  // Parallel fetch remaining data (permission confirmed). Lead candidates
  // are no longer pre-fetched server-side — the modal's <PickerTypeahead>
  // queries `/users` debounced on demand (FEAT_SERVER_DRIVEN_PAGINATION
  // §4.12 / §D23 / Audit B2). Eliminates the silent 10-candidate cap that
  // applied while the SSR fetch shipped no `?limit=`.
  const [departmentsData, hallsData] = await Promise.all([
    apiFetch<Department[]>('/departments', token, fetch),
    apiFetch<Hall[]>('/halls', token, fetch),
  ]);

  const areas = Array.isArray(areasResult.data) ? areasResult.data : [];
  const departments = Array.isArray(departmentsData) ? departmentsData : [];
  const halls = Array.isArray(hallsData) ? hallsData : [];

  return {
    permissionDenied: false as const,
    areas,
    departments,
    halls,
  };
};
