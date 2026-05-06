// =============================================================================
// Manage Dummies — TYPE DEFINITIONS
// =============================================================================

// =============================================================================
// DOMAIN ENTITIES
// =============================================================================

/** Dummy user as returned by the API (camelCase) */
export interface DummyUser {
  uuid: string;
  email: string;
  displayName: string;
  employeeNumber: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  teamIds: number[];
  teamNames: string[];
  departmentIds: number[];
  departmentNames: string[];
  areaIds: number[];
  areaNames: string[];
}

/** Team for multi-select dropdown */
export interface Team {
  id: number;
  name: string;
  departmentName: string | null;
}

// =============================================================================
// FORM DATA
// =============================================================================

/** Form state for create/edit modal */
export interface DummyFormData {
  displayName: string;
  password: string;
  passwordConfirm: string;
  teamIds: number[];
  isActive: number;
}

/** Validation result from form validation */
export interface ValidationErrors {
  displayName?: string;
  password?: string;
  passwordConfirm?: string;
}

// =============================================================================
// API PAYLOADS
// =============================================================================

/** Payload for POST /dummy-users */
export interface CreateDummyPayload {
  displayName: string;
  password: string;
  teamIds?: number[];
}

/** Payload for PUT /dummy-users/:uuid */
export interface UpdateDummyPayload {
  displayName?: string;
  password?: string;
  teamIds?: number[];
  isActive?: number;
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================
//
// FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §3.2 (2026-05-04):
// `PaginatedDummies` removed. The server load (`+page.server.ts`) now uses
// `PaginatedResult<DummyUser>` from `$lib/server/api-fetch.ts` directly —
// canonical ADR-007 envelope shape `{ data: T[], pagination: { page, limit,
// total, totalPages, hasNext, hasPrev } }`. No re-export here because the
// page-level types are derived through `./$types`.
