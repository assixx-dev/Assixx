/**
 * Blackboard Archived — Server-Side Data Loading (Phase 4.6 URL-driven state)
 * @module blackboard/archived/+page.server
 *
 * Loads archived blackboard entries (`isActive=3`) with server-side pagination.
 * Folded into the §4.6 main migration per Spec Deviation D13 — same backend,
 * same types, same helpers as the main `/blackboard` route.
 *
 * Pre-Phase-4.6 implementation hardcoded `?limit=100` — silent truncation at
 * the 101st archived entry (the masterplan's exact "Why now" motivation). This
 * rewrite drops the band-aid in favour of canonical server-driven pagination.
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `(shared)/+layout.server.ts` (route group RBAC, ADR-012)
 *   Layer 1 — `requireAddon('blackboard')` (addon subscription gate, ADR-033)
 *   Layer 2 — backend `@RequirePermission(blackboard, blackboard-posts,
 *             'canRead')` produces 403 → `apiFetchPaginatedWithPermission`
 *             surfaces it as `permissionDenied: true` for `<PermissionDenied />`.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { createLogger } from '$lib/utils/logger';
import { readPageFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';

const log = createLogger('BlackboardArchived');

/** Page size for the archived view. 25 matches typical table-row UX. */
const PAGE_SIZE = 25;

/**
 * Local response shape for archived rows. Narrower than the full
 * `BlackboardEntry` because the table only renders a handful of fields.
 */
interface ArchivedEntry {
  id: number;
  uuid: string;
  title: string;
  content: string;
  authorFullName: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  priority: string;
  orgLevel: string;
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const { activeAddons } = await parent();
  requireAddon(activeAddons, 'blackboard');

  // URL → state. Only `?page` is URL-driven on archived view (no search /
  // filter UI exposed here — keep canonical URLs minimal per R5 mitigation).
  const page = readPageFromUrl(url);

  // State → backend query string. `isActive=3` is fixed for this route by
  // design (archive view definition).
  const params = new URLSearchParams();
  params.set('isActive', '3');
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));

  const result = await apiFetchPaginatedWithPermission<ArchivedEntry>(
    `/blackboard/entries?${params.toString()}`,
    token,
    fetch,
  );

  if (result.permissionDenied) {
    return {
      permissionDenied: true as const,
      entries: [] as ArchivedEntry[],
      pagination: result.pagination,
      error: null,
    };
  }

  log.info(
    { count: result.data.length, total: result.pagination.total, page },
    'Archived entries loaded',
  );

  return {
    permissionDenied: false as const,
    entries: result.data,
    pagination: result.pagination,
    error: null,
  };
};
