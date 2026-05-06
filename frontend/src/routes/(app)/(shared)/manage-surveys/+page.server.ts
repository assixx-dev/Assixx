/**
 * Manage Surveys — Server-Side Data Loading (Phase 4.10b URL-driven state)
 * @module manage-surveys/+page.server
 *
 * URL is the single source of truth for pagination + search state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.10b. Three card sections
 * (Aktive / Beendete / Entwürfe) each get their own pagination cursor.
 * The "Beendete" section folds two backend statuses (`completed` +
 * `archived`) into one URL pivot via two parallel calls — recorded as
 * Spec Deviation §D20.
 *
 * Backend `/surveys` envelope landed in §4.10a (Session 10c, 2026-05-06,
 * changelog 1.25.0): canonical ADR-007 wrapper `{ items[], pagination }`
 * flattened by `ResponseInterceptor` to `{ data: T[], meta: { pagination } }`.
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `requireAddon('surveys', activeAddons)` (addon subscription).
 *   Layer 1 — `canManageSurveys()` (admin / lead / full-access; ADR-045
 *             §canManage). Backend would 403 anyway, but the redirect keeps
 *             the UX honest — `/manage-surveys` is for managers only.
 *   Layer 2 — backend `@RequirePermission(SURVEY_ADDON, SURVEY_MANAGE,
 *             'canRead')` produces 403 → `apiFetchPaginatedWithPermission`
 *             surfaces `permissionDenied: true` so `+page.svelte` can render
 *             `<PermissionDenied />` (ADR-020).
 *
 * URL contract (FE-internal — explicit §D5 exception):
 *   ?draftPage     — page index for the Entwürfe section
 *   ?activePage    — page index for the Aktive Umfragen section
 *   ?completedPage — page index for the Beendete section, drives BOTH
 *                    `status=completed` + `status=archived` in parallel,
 *                    both at the same page N → §D20.
 *   ?search        — shared title/description ILIKE term across all sections
 *
 * §D5 ("URL filter contract = verbatim backend names; no FE-side aliasing
 * layer") concerns value-aliasing (e.g. FE `assetFilter='asset'` mapping to
 * a non-existent backend `orgLevel='asset'`). Here NO value aliasing exists
 * — the status value is hardcoded per call site (`status=draft|active|
 * completed|archived`). Per-section URL keys are structurally necessary
 * because three sections cannot all share `?page=`.
 *
 * Out of scope per masterplan row 4.10:
 *   - Templates section (4th visual block) — single non-paginated lookup.
 *     Typical tenant has < 20 templates; pagination would be over-engineering.
 *   - Single survey-status dropdown — by design this page shows ALL three
 *     status sections at once (admin overview); no filter switcher needed.
 */
import { redirect } from '@sveltejs/kit';

import type { PaginationMeta, PaginatedPermissionResult } from '$lib/server/api-fetch';
import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readSearchFromUrl } from '$lib/utils/url-pagination';

import { canManageSurveys } from '../../_lib/navigation-config';

import type { PageServerLoad } from './$types';
import type { Area, Department, Survey, SurveyTemplate, Team, UserRole } from './_lib/types';

/**
 * Page size per section. 20 mirrors the backend `PaginationSchema` default
 * and the Phase-4 reference impls (kvp 4.5b, work-orders 4.7b). The pre-
 * Phase-4.10b `?limit=100` band-aid is now structurally moot because each
 * section has its own pagination cursor.
 */
const PAGE_SIZE = 20;

interface UrlState {
  draftPage: number;
  activePage: number;
  completedPage: number;
  search: string;
}

interface CurrentUser {
  userId: number;
  role: UserRole;
  hasFullAccess: boolean;
}

/** Section status keys — must match backend `SurveyStatusSchema` enum verbatim. */
type SectionStatus = 'draft' | 'active' | 'completed' | 'archived';

/**
 * Defensive integer parse for per-section page params. Mirrors the shape of
 * `readPageFromUrl` from `$lib/utils/url-pagination` — that helper only
 * reads the canonical `?page=` key, so per-section keys need their own
 * reader. Returns 1 on missing/invalid/<=0 (same default contract).
 */
function readSectionPage(url: URL, key: string): number {
  const raw = url.searchParams.get(key);
  if (raw === null) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function readUrlState(url: URL): UrlState {
  return {
    draftPage: readSectionPage(url, 'draftPage'),
    activePage: readSectionPage(url, 'activePage'),
    completedPage: readSectionPage(url, 'completedPage'),
    search: readSearchFromUrl(url),
  };
}

/**
 * Build backend query string for one section call. Backend defaults
 * (no search) are NEVER sent — keeps the on-the-wire URL clean. `manage`
 * is intentionally NOT sent: the existing service applies the right access
 * mode based on user role regardless, and pre-Phase-4.10b code did the same
 * (preserves behavior — no scope creep).
 */
function buildSectionParams(status: SectionStatus, page: number, search: string): string {
  const params = new URLSearchParams();
  params.set('status', status);
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  if (search !== '') params.set('search', search);
  return params.toString();
}

/**
 * Merge two PaginationMeta blocks into one block representing the combined
 * Beendete (completed + archived) section — recorded as §D20.
 *
 * Both calls fire at the same `?completedPage=N` index, so `page`/`limit`
 * are taken from one (they are equal by construction). `total` is the
 * arithmetic sum (item count across both statuses). `totalPages` is `max`
 * — one status may run out before the other; navigating past its last page
 * still produces a valid view (one half empty). hasNext/hasPrev derive
 * from the merged page/totalPages.
 *
 * Trade-off: items-per-displayed-page is NOT constant across pages when
 * the two sub-totals differ (e.g. 30 completed + 5 archived at limit=20:
 * page 1 shows 25 items, page 2 shows 10). Acceptable per §D20 plan-text:
 * single shared pagination cursor under "Beendete" is the user-facing
 * contract; the visible item count varies but no item is hidden.
 */
function mergeBeendetePagination(
  completed: PaginationMeta,
  archived: PaginationMeta,
): PaginationMeta {
  const totalPages = Math.max(completed.totalPages, archived.totalPages);
  const total = completed.total + archived.total;
  const page = completed.page;
  const limit = completed.limit;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

function buildCurrentUser(
  user: { id?: number; role?: string; hasFullAccess?: boolean } | null,
): CurrentUser {
  return {
    userId: user?.id ?? 0,
    role: (user?.role ?? 'employee') as UserRole,
    hasFullAccess: user?.hasFullAccess ?? false,
  };
}

function toSafeArray<T>(data: T[] | null): T[] {
  return Array.isArray(data) ? data : [];
}

interface SectionResults {
  permissionDenied: boolean;
  draftSurveys: Survey[];
  draftPagination: PaginationMeta;
  activeSurveys: Survey[];
  activePagination: PaginationMeta;
  completedSurveys: Survey[];
  completedPagination: PaginationMeta;
  templates: SurveyTemplate[];
  departments: Department[];
  teams: Team[];
  areas: Area[];
}

/**
 * Fire all 8 SSR calls in parallel — 4 paginated section fetches + 4
 * non-paginated reference lookups (templates, departments, teams, areas).
 * Reference data fires alongside the primary fetches per the kvp 4.5b
 * pattern: minor wasted bandwidth on the 403 path in exchange for one
 * round-trip latency on the success path.
 *
 * If ANY of the four primary calls returns 403, treat as overall denied.
 * All four share the same `@RequirePermission(SURVEY_MANAGE, 'canRead')`
 * gate, so a partial denial would indicate backend inconsistency — safer
 * to render `<PermissionDenied />` than show partial data.
 */
async function fetchAllSections(
  token: string,
  fetchFn: typeof fetch,
  urlState: UrlState,
): Promise<SectionResults> {
  // No explicit generic on Promise.all — heterogeneous tuple type is
  // inferred from each callee's typed return. Mirrors the kvp 4.5b pattern.
  const [draft, active, completed, archived, templates, departments, teams, areas] =
    await Promise.all([
      apiFetchPaginatedWithPermission<Survey>(
        `/surveys?${buildSectionParams('draft', urlState.draftPage, urlState.search)}`,
        token,
        fetchFn,
      ),
      apiFetchPaginatedWithPermission<Survey>(
        `/surveys?${buildSectionParams('active', urlState.activePage, urlState.search)}`,
        token,
        fetchFn,
      ),
      apiFetchPaginatedWithPermission<Survey>(
        `/surveys?${buildSectionParams('completed', urlState.completedPage, urlState.search)}`,
        token,
        fetchFn,
      ),
      apiFetchPaginatedWithPermission<Survey>(
        `/surveys?${buildSectionParams('archived', urlState.completedPage, urlState.search)}`,
        token,
        fetchFn,
      ),
      apiFetch<SurveyTemplate[]>('/surveys/templates', token, fetchFn),
      apiFetch<Department[]>('/departments', token, fetchFn),
      apiFetch<Team[]>('/teams', token, fetchFn),
      apiFetch<Area[]>('/areas', token, fetchFn),
    ]);

  const permissionDenied =
    draft.permissionDenied ||
    active.permissionDenied ||
    completed.permissionDenied ||
    archived.permissionDenied;

  return {
    permissionDenied,
    draftSurveys: permissionDenied ? [] : draft.data,
    draftPagination: draft.pagination,
    activeSurveys: permissionDenied ? [] : active.data,
    activePagination: active.pagination,
    // §D20: concat completed-then-archived in stable order. Empty slices on
    // either side are fine — the merged total/totalPages account for them.
    completedSurveys: permissionDenied ? [] : [...completed.data, ...archived.data],
    completedPagination: mergeBeendetePagination(completed.pagination, archived.pagination),
    templates: toSafeArray(templates),
    departments: toSafeArray(departments),
    teams: toSafeArray(teams),
    areas: toSafeArray(areas),
  };
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const { user, activeAddons, orgScope } = await parent();
  requireAddon(activeAddons, 'surveys');

  // Defense-in-depth Layer-1 (ADR-045): block direct URL access for users
  // who can't manage surveys. The route group `(shared)/+layout.server.ts`
  // already authenticates; this redirect adds the role/lead check.
  if (!canManageSurveys(user?.role, user?.hasFullAccess === true, orgScope.isAnyLead)) {
    redirect(302, '/surveys');
  }

  const urlState = readUrlState(url);
  const sections = await fetchAllSections(token, fetch, urlState);

  return {
    permissionDenied: sections.permissionDenied,
    draftSurveys: sections.draftSurveys,
    draftPagination: sections.draftPagination,
    activeSurveys: sections.activeSurveys,
    activePagination: sections.activePagination,
    completedSurveys: sections.completedSurveys,
    completedPagination: sections.completedPagination,
    templates: sections.templates,
    departments: sections.departments,
    teams: sections.teams,
    areas: sections.areas,
    currentUser: buildCurrentUser(user),
    ...urlState,
  };
};
