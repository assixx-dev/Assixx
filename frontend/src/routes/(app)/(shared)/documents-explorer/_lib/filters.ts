/**
 * @deprecated DELETED in Phase 4.9b (Session 10b, 2026-05-06). The backend
 * now performs all filtering (`?accessScope=`/`?search=`) and sorting
 * (`?sort=` server-side dispatch via `buildDocumentsOrderByClause`, 4.9a),
 * so the FE-only `applyAllFilters` pipeline + `calculateCategoryCounts` +
 * `calculateStats` are no longer reachable. Sidebar count badges dropped
 * per W3 / Known Limitation #11. Page-level stats now read from
 * `pagination.total` (server-authoritative).
 *
 * This file is empty pending `git rm` by the user (CLAUDE.md: "Permission
 * denied for any git or rm commands. Tell user to do it!").
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.9b §D14 (legacy `_lib` cleanup)
 */
export {};
