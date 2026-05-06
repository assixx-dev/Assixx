// =============================================================================
// DOCUMENTS EXPLORER — MUTATION API (Phase 4.9b: fetchers removed)
// =============================================================================
//
// Pre-Phase-4.9b this file held:
//   - `fetchDocuments` / `fetchChatFolders` / `fetchChatAttachments` —
//     consumed by `state-data.svelte.ts:loadDocuments|...`. All three are
//     now SSR-loaded by `+page.server.ts` via the URL contract; the legacy
//     fetchers are dead and removed (mirrors §D14 cleanup discipline used
//     in 4.5b/4.6/4.7b/4.8b).
//   - `getCurrentUser()` — kept (called by upload-modal-open via
//     `state.svelte.ts:loadCurrentUser`). Delegates to the shared user
//     service to dedupe with `/users/me` callers app-wide.
//
// Mutations stay client-side (apiClient) — they trigger `invalidateAll()`
// in `state.svelte.ts` to refresh the SSR snapshot.
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.9b §D14

import { getApiClient } from '$lib/utils/api-client';
import { fetchCurrentUser as fetchSharedUser } from '$lib/utils/user-service';

import type {
  ApiResponse,
  CurrentUser,
  Document,
  UpdateDocumentData,
  UploadFormData,
} from './types';

const apiClient = getApiClient();

// =============================================================================
// MARK AS READ
// =============================================================================

/**
 * Mark a document as read. The pre-4.9b version was paired with an
 * optimistic in-memory `allDocuments` mutation — post-4.9b the caller
 * (`state.svelte.ts:markAsRead`) follows up with `invalidateAll()` so the
 * `isRead` flip arrives via the next SSR snapshot.
 */
export async function markDocumentAsRead(documentId: number): Promise<void> {
  await apiClient.post(`/documents/${documentId}/read`, {});
}

// =============================================================================
// DELETE / UPDATE
// =============================================================================

export async function deleteDocument(documentId: number): Promise<void> {
  await apiClient.delete(`/documents/${documentId}`);
}

/**
 * Update a document (filename / category / tags). Backend uses PUT and
 * expects `filename` (NOT `documentName` — the FE-facing form field name);
 * the field-mapping below is the long-standing FE↔BE adapter.
 */
export async function updateDocument(
  documentId: number,
  data: UpdateDocumentData,
): Promise<Document> {
  const backendData: Record<string, unknown> = {};
  if (data.documentName !== undefined) {
    backendData.filename = data.documentName;
  }
  if (data.category !== undefined) {
    backendData.category = data.category;
  }
  if (data.tags !== undefined) {
    backendData.tags = data.tags;
  }

  const result = await apiClient.put(`/documents/${documentId}`, backendData);

  // Tolerant unwrap — backend has historically used multiple shapes here.
  if (result !== null && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if ('id' in obj) {
      return obj as unknown as Document;
    }
    if ('data' in obj && obj.data !== null && typeof obj.data === 'object') {
      return obj.data as unknown as Document;
    }
  }

  throw new Error('Invalid response format from updateDocument API');
}

// =============================================================================
// UPLOAD
// =============================================================================

/**
 * Build the multipart payload for `/documents` POST. Backend expects
 * `document` (singular) as the file field — see `documents.controller.ts`
 * `@UploadedFile()` decorator (ADR-042 multipart pipeline).
 */
function buildUploadPayload(formData: UploadFormData): FormData {
  const data = new FormData();
  data.append('document', formData.file);
  data.append('accessScope', formData.accessScope);
  data.append('category', formData.category);

  // Optional fields — append only if defined (backend tolerates absence).
  const optionalFields: [string, string | number | undefined | null][] = [
    ['documentName', formData.documentName],
    ['description', formData.description],
    ['ownerUserId', formData.ownerUserId],
    ['targetTeamId', formData.targetTeamId],
    ['targetDepartmentId', formData.targetDepartmentId],
    ['salaryYear', formData.salaryYear],
    ['salaryMonth', formData.salaryMonth],
  ];

  for (const [key, value] of optionalFields) {
    if (value !== null && value !== undefined) {
      data.append(key, String(value));
    }
  }

  if (formData.tags !== undefined && formData.tags.length > 0) {
    data.append('tags', JSON.stringify(formData.tags));
  }

  return data;
}

/**
 * Upload a document.
 *
 * Uses XMLHttpRequest (not `fetch`) because the upload progress event is
 * the simplest way to drive the frontend progress bar — `fetch` upload
 * progress requires the (still-uncoupled) Streams API and a request body
 * stream, which is not worth the complexity here.
 *
 * Auth: `withCredentials = true` ensures the HttpOnly `accessToken` cookie
 * (ADR-046 §"3-cookie invariant") is sent with the upload, mirroring
 * `apiClient`'s `credentials: 'include'`. Same-origin browsers send cookies
 * even without this flag, but setting it explicitly future-proofs against
 * cross-origin deployment (e.g. CDN-hosted frontend) and matches the rest
 * of the codebase.
 */
export async function uploadDocument(
  formData: UploadFormData,
  onProgress?: (progress: number) => void,
): Promise<Document> {
  const data = buildUploadPayload(formData);
  const xhr = new XMLHttpRequest();

  return await new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress !== undefined) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText) as ApiResponse<Document>;
          resolve(response.data ?? (response as unknown as Document));
        } catch {
          reject(new Error('Invalid response format'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}: Upload fehlgeschlagen`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Netzwerkfehler beim Upload'));
    });

    xhr.open('POST', '/api/v2/documents');
    xhr.withCredentials = true;
    xhr.send(data);
  });
}

// =============================================================================
// USER INFO
// =============================================================================

/**
 * Get current user info — delegates to the shared user service (prevents
 * duplicate `/users/me` calls from independent module-singletons).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const result = await fetchSharedUser();
  return result.user;
}
