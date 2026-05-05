// =============================================================================
// KVP - AGGREGATED STATE (Svelte 5 Runes)
//
// Phase 4.5b (FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.5b): the suggestions
// list and every filter value live in the URL — `+page.server.ts` reads them
// and the page passes them as props. This aggregate now exposes only the
// state still needed by client-side flows:
//   - User identity + effective role (for role-switch UX)
//   - Reference data caches (categories, departments, statistics)
//   - Modal + photo UI flags (KvpCreateModal lifecycle)
//
// Removed in 4.5b (per masterplan §D9 / Q3 sign-off):
//   - filterState facade (currentFilter, statusFilter, categoryFilter, …,
//     setFilter, setStatusFilter, …)
//   - badgeCounts derived (per Q2 Option C — counts were always meaningless;
//     UI never rendered them)
// =============================================================================

import { dataState } from './state-data.svelte';
import { uiState } from './state-ui.svelte';
import { userState } from './state-user.svelte';

// Re-export sub-states for direct access
export { dataState, uiState, userState };

/** Reset all sub-states */
function resetAll(): void {
  userState.reset();
  dataState.reset();
  uiState.reset();
}

/**
 * Aggregated KVP state — provides unified access to the still-relevant
 * sub-states. For granular access, import sub-states directly.
 *
 * NOTE: filter / pagination state is NOT here — read it from `data.*` props
 * in `+page.svelte` (URL-driven per Phase 4.5b).
 */
export const kvpState = {
  // User
  get currentUser() {
    return userState.currentUser;
  },
  get effectiveRole() {
    return userState.effectiveRole;
  },
  get isAdmin() {
    return userState.isAdmin;
  },
  get isEmployee() {
    return userState.isEmployee;
  },
  setUser: userState.setUser,
  updateEffectiveRole: userState.updateEffectiveRole,

  // Data
  get suggestions() {
    return dataState.suggestions;
  },
  get categories() {
    return dataState.categories;
  },
  get departments() {
    return dataState.departments;
  },
  get statistics() {
    return dataState.statistics;
  },
  get formattedStats() {
    return dataState.formattedStats;
  },
  setSuggestions: dataState.setSuggestions,
  setCategories: dataState.setCategories,
  setDepartments: dataState.setDepartments,
  setStatistics: dataState.setStatistics,
  getCategoryById: dataState.getCategoryById,
  getDepartmentById: dataState.getDepartmentById,

  // UI
  get showCreateModal() {
    return uiState.showCreateModal;
  },
  get selectedPhotos() {
    return uiState.selectedPhotos;
  },
  get isLoading() {
    return uiState.isLoading;
  },
  get isSubmitting() {
    return uiState.isSubmitting;
  },
  openCreateModal: uiState.openCreateModal,
  closeCreateModal: uiState.closeCreateModal,
  addPhoto: uiState.addPhoto,
  removePhoto: uiState.removePhoto,
  clearPhotos: uiState.clearPhotos,
  setLoading: uiState.setLoading,
  setSubmitting: uiState.setSubmitting,

  // Global
  reset: resetAll,
};
