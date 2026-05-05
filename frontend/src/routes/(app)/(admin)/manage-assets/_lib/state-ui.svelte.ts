// =============================================================================
// MANAGE ASSETS - UI STATE MODULE (modal/form lifecycle only)
// =============================================================================
//
// Phase 4.4b (2026-05-05): `loading`, `error`, `currentStatusFilter`,
// `currentSearchQuery`, `searchOpen` (and their setters) were removed.
// Pagination, search, and status filter are URL-driven via the Phase-2
// helpers (`readPageFromUrl` / `readSearchFromUrl` / `readFilterFromUrl`)
// — there is NO `$state` shadow of these. `loading` was always `true` on
// mount with no consumer flipping it back; `error` was checked in the
// template but never set. Both were dead state.
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.4b

/** Creates UI lifecycle state — modal open/close, edit/delete IDs, submit flag. */
export function createUIState() {
  let submitting = $state(false);
  let showAssetModal = $state(false);
  let showDeleteModal = $state(false);
  let currentEditId = $state<number | null>(null);
  let deleteAssetId = $state<number | null>(null);

  return {
    get submitting() {
      return submitting;
    },
    get showAssetModal() {
      return showAssetModal;
    },
    get showDeleteModal() {
      return showDeleteModal;
    },
    get currentEditId() {
      return currentEditId;
    },
    get deleteAssetId() {
      return deleteAssetId;
    },
    setSubmitting: (v: boolean) => {
      submitting = v;
    },
    setShowAssetModal: (v: boolean) => {
      showAssetModal = v;
    },
    setShowDeleteModal: (v: boolean) => {
      showDeleteModal = v;
    },
    setCurrentEditId: (v: number | null) => {
      currentEditId = v;
    },
    setDeleteAssetId: (v: number | null) => {
      deleteAssetId = v;
    },
  };
}

export type UIState = ReturnType<typeof createUIState>;
