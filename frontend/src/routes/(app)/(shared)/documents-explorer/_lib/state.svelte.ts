// =============================================================================
// DOCUMENTS EXPLORER — STATE AGGREGATOR (Phase 4.9b URL-driven)
// =============================================================================
//
// Post-Phase-4.9b: data state (documents/category/search/sort/conversationId)
// is server-driven via SSR; this module owns ONLY the pieces that don't fit
// the URL contract:
//   - `currentUser` (mutable ref, refreshed when the upload modal opens so
//     hasFullAccess / role / teamId / departmentId are fresh on submit)
//   - `uiState` aggregation (modals, view mode, sort dropdown — `state-ui`)
//   - mutation cross-cutters (delete / edit / upload submit flows)
//   - preview navigation (receives `documents: Document[]` from the page —
//     no longer reads `dataState.filteredDocuments` because that singleton
//     was deleted; component holds the SSR list as `data.documents`)
//
// `markAsRead` triggers `invalidateAll()` after the API call so the
// per-document `isRead` flip surfaces in the next SSR snapshot — no
// optimistic in-memory shadow list to keep in sync (was the core liability
// of the pre-4.9b `state-data.svelte.ts:loadDocuments` workaround).
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.9b §D14

import { invalidateAll } from '$app/navigation';

import { notificationStore } from '$lib/stores/notification.store.svelte';
import { showErrorAlert, showSuccessAlert, showWarningAlert } from '$lib/stores/toast';
import { createLogger } from '$lib/utils/logger';
import { handleSessionExpired, isSessionExpiredError } from '$lib/utils/session-expired.js';
import { fetchCurrentUser as fetchSharedUser } from '$lib/utils/user-service';

import {
  deleteDocument as apiDeleteDocument,
  markDocumentAsRead as apiMarkAsRead,
  updateDocument as apiUpdateDocument,
  uploadDocument as apiUploadDocument,
} from './api';
import { MESSAGES } from './constants';
import { uiState } from './state-ui.svelte';
import {
  buildUploadFormData,
  canDeleteDocument,
  canEditDocument,
  canSeeActions,
  canUpload,
  downloadDocument,
  validateUploadData,
} from './utils';

import type { CurrentUser, Document, EditData, UploadData } from './types';

const log = createLogger('DocExplorerState');

// =============================================================================
// CURRENT USER — single mutable ref, synced from SSR + refreshable on upload.
// Module-level $state is allowed in `.svelte.ts` files (Svelte 5 universal
// reactivity rune); behaves like a singleton across page navigations.
// =============================================================================

let currentUser = $state<CurrentUser | null>(null);

/**
 * Initialise from SSR. Called via `$effect` in `+page.svelte` whenever
 * `data.currentUser` changes (typically once per session). Idempotent: a
 * non-null current ref is preserved across re-runs so a fresh `loadCurrentUser`
 * (called by upload-modal-open) is not clobbered by a stale SSR snapshot.
 */
function initFromSSR(user: { id: number; role: string } | null): void {
  if (currentUser === null && user !== null) {
    currentUser = {
      id: user.id,
      tenantId: 0,
      role: user.role,
    };
  }
}

/**
 * Refresh the user ref via the shared user service — called when the upload
 * modal opens so the validator sees fresh `hasFullAccess`, `teamId`,
 * `departmentId` for the category gate (`validateUserForCategory` in utils).
 */
async function loadCurrentUser(): Promise<void> {
  const result = await fetchSharedUser();
  currentUser = result.user;
}

// =============================================================================
// MARK AS READ — fire-and-forget API + invalidateAll. The pre-4.9b version
// did an optimistic local mutation of `allDocuments`; with server-driven
// pagination, `invalidateAll()` re-fetches the current page instead — the
// `isRead` flip arrives via the next SSR snapshot.
// =============================================================================

async function markAsRead(documentId: number): Promise<void> {
  try {
    await apiMarkAsRead(documentId);
    notificationStore.decrementCount('documents');
    await invalidateAll();
  } catch (err: unknown) {
    log.error({ err }, 'Error marking as read');
    if (isSessionExpiredError(err)) handleSessionExpired();
  }
}

// =============================================================================
// PREVIEW NAVIGATION — operates on the page's `documents` array (SSR-driven,
// passed in by the component since the dataState singleton was deleted).
// =============================================================================

function handlePreviewOpen(doc: Document): void {
  uiState.openPreview(doc);
  if (!doc.isRead) void markAsRead(doc.id);
}

function navigatePreviewPrev(documents: Document[]): void {
  const current = uiState.selectedDocument;
  if (current === null || documents.length <= 1) return;
  const idx = documents.findIndex((d) => d.id === current.id);
  if (idx === -1) return;
  const prevDoc = documents[idx === 0 ? documents.length - 1 : idx - 1];
  uiState.openPreview(prevDoc);
  if (!prevDoc.isRead) void markAsRead(prevDoc.id);
}

function navigatePreviewNext(documents: Document[]): void {
  const current = uiState.selectedDocument;
  if (current === null || documents.length <= 1) return;
  const idx = documents.findIndex((d) => d.id === current.id);
  if (idx === -1) return;
  const nextDoc = documents[idx === documents.length - 1 ? 0 : idx + 1];
  uiState.openPreview(nextDoc);
  if (!nextDoc.isRead) void markAsRead(nextDoc.id);
}

// =============================================================================
// DELETE
// =============================================================================

function handleDeleteDocument(doc: Document, e: MouseEvent): void {
  e.stopPropagation();
  if (!canDeleteDocument(doc, currentUser)) {
    showWarningAlert('Sie haben keine Berechtigung, dieses Dokument zu löschen');
    return;
  }
  uiState.openDeleteModal(doc);
}

async function confirmDeleteDocument(): Promise<void> {
  const doc = uiState.deletingDocument;
  if (doc === null) return;

  uiState.setDeleteSubmitting(true);
  try {
    await apiDeleteDocument(doc.id);
    showSuccessAlert('Dokument erfolgreich gelöscht');
    uiState.closeDeleteConfirmModal();
    await invalidateAll();
  } catch (err: unknown) {
    log.error({ err }, 'Delete failed');
    showErrorAlert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
  } finally {
    uiState.setDeleteSubmitting(false);
  }
}

// =============================================================================
// EDIT
// =============================================================================

function handleEditClick(doc: Document, e: MouseEvent): void {
  e.stopPropagation();
  if (!canEditDocument(doc, currentUser)) {
    showWarningAlert('Sie haben keine Berechtigung, dieses Dokument zu bearbeiten');
    return;
  }
  uiState.openEditModal(doc);
}

async function handleEditSubmit(data: EditData): Promise<void> {
  if (uiState.editingDocument === null) return;
  if (!data.documentName.trim()) {
    showWarningAlert('Bitte geben Sie einen Dokumentnamen ein');
    return;
  }

  uiState.setEditSubmitting(true);
  try {
    await apiUpdateDocument(uiState.editingDocument.id, data);
    showSuccessAlert('Dokument erfolgreich aktualisiert');
    uiState.closeEditModal();
    await invalidateAll();
  } catch (err: unknown) {
    log.error({ err }, 'Update failed');
    showErrorAlert(err instanceof Error ? err.message : 'Aktualisieren fehlgeschlagen');
  } finally {
    uiState.setEditSubmitting(false);
  }
}

// =============================================================================
// UPLOAD
// =============================================================================

function handleUploadOpen(): void {
  uiState.openUploadModal();
  void loadCurrentUser();
}

async function handleUploadSubmit(data: UploadData): Promise<void> {
  const result = validateUploadData(data, currentUser);
  if (!result.valid) {
    if (result.type === 'warning') {
      showWarningAlert(result.error);
    } else {
      showErrorAlert(result.error);
    }
    return;
  }

  const { file, category, user, requiresPayroll } = result.data;
  const formData = buildUploadFormData(
    file,
    category,
    user,
    data.docName,
    data.description,
    data.tags,
    requiresPayroll ? data.salaryYear : undefined,
    requiresPayroll ? data.salaryMonth : undefined,
  );

  if (formData === null) {
    showErrorAlert('Ungültige Kategorie');
    return;
  }

  try {
    await apiUploadDocument(formData);
    showSuccessAlert(MESSAGES.UPLOAD_SUCCESS);
    uiState.closeUploadModal();
    await invalidateAll();
  } catch (err: unknown) {
    log.error({ err }, 'Upload failed');
    showErrorAlert(err instanceof Error ? err.message : MESSAGES.ERROR_UPLOAD_FAILED);
  }
}

// =============================================================================
// DOWNLOAD
// =============================================================================

function handleDownloadClick(doc: Document, e: MouseEvent): void {
  e.stopPropagation();
  downloadDocument(doc);
}

// =============================================================================
// PERMISSION HELPERS — exposed so component can derive button visibility
// without re-importing utils.
// =============================================================================

function showUploadButton(user: CurrentUser | null): boolean {
  return canUpload(user?.role ?? null);
}

function showActions(user: CurrentUser | null): boolean {
  return canSeeActions(user?.role ?? null);
}

// =============================================================================
// PUBLIC API
// =============================================================================

export const docExplorerState = {
  // ---------------------------------------------------------------------------
  // CURRENT USER
  // ---------------------------------------------------------------------------
  get currentUser() {
    return currentUser;
  },

  // ---------------------------------------------------------------------------
  // UI STATE DELEGATES (modals, view mode, sort dropdown)
  // ---------------------------------------------------------------------------
  get viewMode() {
    return uiState.viewMode;
  },
  get sortDropdownOpen() {
    return uiState.sortDropdownOpen;
  },
  get selectedDocument() {
    return uiState.selectedDocument;
  },
  get showPreviewModal() {
    return uiState.showPreviewModal;
  },
  get showUploadModal() {
    return uiState.showUploadModal;
  },
  get showEditModal() {
    return uiState.showEditModal;
  },
  get editingDocument() {
    return uiState.editingDocument;
  },
  get editSubmitting() {
    return uiState.editSubmitting;
  },
  get showDeleteConfirmModal() {
    return uiState.showDeleteConfirmModal;
  },
  get deletingDocument() {
    return uiState.deletingDocument;
  },
  get deleteSubmitting() {
    return uiState.deleteSubmitting;
  },

  // ---------------------------------------------------------------------------
  // UI METHODS
  // ---------------------------------------------------------------------------
  setViewMode: uiState.setViewMode,
  loadSavedViewMode: uiState.loadSavedViewMode,
  setSortDropdownOpen: uiState.setSortDropdownOpen,
  toggleSortDropdown: uiState.toggleSortDropdown,
  closePreview: uiState.closePreview,
  closeUploadModal: uiState.closeUploadModal,
  closeEditModal: uiState.closeEditModal,
  closeDeleteConfirmModal: uiState.closeDeleteConfirmModal,

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------
  initFromSSR,
  loadCurrentUser,

  // ---------------------------------------------------------------------------
  // CROSS-CUTTING OPERATIONS
  // ---------------------------------------------------------------------------
  handlePreviewOpen,
  navigatePreviewPrev,
  navigatePreviewNext,
  handleDeleteDocument,
  confirmDeleteDocument,
  handleEditClick,
  handleEditSubmit,
  handleUploadOpen,
  handleUploadSubmit,
  handleDownloadClick,
  downloadDocument,

  // ---------------------------------------------------------------------------
  // PERMISSION HELPERS
  // ---------------------------------------------------------------------------
  showUploadButton,
  showActions,
};
