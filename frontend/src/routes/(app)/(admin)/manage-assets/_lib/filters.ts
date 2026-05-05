// =============================================================================
// MANAGE ASSETS - FILTERS REMOVED (Phase 4.4b, 2026-05-05)
// =============================================================================
//
// Pre-Phase-4.4b this module exported `filterByStatus`, `filterBySearch`,
// and `applyAllFilters` for client-side filtering of `assetState.allAssets`
// in `+page.svelte`. With server-driven pagination
// (FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.4b) every filter is forwarded
// as a backend query param (`?status=…`, `?search=…`) and the backend
// returns the page slice directly via the ADR-007 envelope.
//
// The file is intentionally kept (not deleted) as a redirect signpost in
// case any future code attempts to re-import the helpers — TypeScript will
// reject `applyAllFilters is not exported` cleanly. Safe to delete in a
// follow-up housekeeping PR (Phase 5.2 cleanup).
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.4b (Session 7d)
// @see frontend/src/routes/(app)/(shared)/manage-employees/+page.server.ts (reference impl)

export {};
