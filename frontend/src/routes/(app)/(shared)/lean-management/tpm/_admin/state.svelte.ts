// =============================================================================
// TPM ADMIN STATE — STUBBED (§D14/§D19)
// =============================================================================
//
// Phase 4.11b (2026-05-06): the URL-state migration on `/lean-management/tpm`
// moved every reactive concern (currentPage, statusFilter, searchQuery, ...)
// into URL state. Modal state (delete confirmation) moved into the page
// component as local `$state`. The composed `tpmState` singleton + its data /
// UI sub-modules are no longer reachable from production code.
//
// Per §D19 the file is stubbed instead of deleted (harness blocks `rm`).
// User follow-up: `git rm frontend/src/routes/(app)/(shared)/lean-management/
// tpm/_admin/{state.svelte.ts,state-data.svelte.ts,state-ui.svelte.ts}`.
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Spec Deviations" D14, D19

export {};
