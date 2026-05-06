/**
 * Vacation Entitlements — Frontend Type Definitions
 * Mirrors backend vacation.types.ts for entitlements + balance.
 */

// ─── API response types ─────────────────────────────────────────────

export interface VacationEntitlement {
  id: string;
  userId: number;
  year: number;
  totalDays: number;
  carriedOverDays: number;
  additionalDays: number;
  carryOverExpiresAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VacationBalance {
  year: number;
  totalDays: number;
  carriedOverDays: number;
  effectiveCarriedOver: number;
  additionalDays: number;
  availableDays: number;
  usedDays: number;
  remainingDays: number;
  pendingDays: number;
  projectedRemaining: number;
}

/** Simplified employee info for the entitlements list */
export interface EmployeeListItem {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  position: string | null;
  employeeNumber?: string;
  teamNames?: string[];
}

// ─── Create / Update payloads ───────────────────────────────────────

export interface CreateEntitlementPayload {
  userId: number;
  year: number;
  totalDays: number;
  carriedOverDays: number;
  additionalDays: number;
  carryOverExpiresAt?: string;
}

export interface AddDaysPayload {
  year: number;
  days: number;
}

// ─── SSR page data ──────────────────────────────────────────────────

/**
 * Pagination block (mirrors `PaginationMeta` from `$lib/server/api-fetch.ts`).
 * Inlined here so this file stays the single source of truth for the page
 * contract — same convention as `manage-employees/_lib/types.ts` post-§4.1b.
 */
export interface VacationEntitlementsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface VacationEntitlementsPageData {
  permissionDenied: boolean;
  employees: EmployeeListItem[];
  pagination: VacationEntitlementsPagination;
  search: string;
  currentYear: number;
}
