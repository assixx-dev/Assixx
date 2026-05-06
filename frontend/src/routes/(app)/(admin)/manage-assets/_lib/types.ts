// =============================================================================
// MANAGE MACHINES - TYPE DEFINITIONS
// =============================================================================

/**
 * Team info for list display (embedded in Asset for badge display)
 */
export interface AssetTeamInfo {
  id: number;
  name: string;
}

/**
 * Asset entity with all properties
 */
export interface Asset {
  id: number;
  uuid: string;
  name: string;
  model?: string;
  manufacturer?: string;
  serialNumber?: string;
  assetNumber?: string;
  departmentId?: number;
  departmentName?: string;
  areaId?: number;
  areaName?: string;
  location?: string;
  assetType?: AssetType;
  status: AssetStatus;
  purchaseDate?: string;
  installationDate?: string;
  warrantyUntil?: string;
  lastMaintenance?: string;
  nextMaintenance?: string;
  operatingHours?: number;
  productionCapacity?: string;
  energyConsumption?: string;
  manualUrl?: string;
  qrCode?: string;
  notes?: string;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
  // Teams assigned to this asset (for list display with badges)
  teams?: AssetTeamInfo[];
  // Availability info (next relevant entry from asset_availability table)
  availabilityStatus?: string;
  availabilityStart?: string;
  availabilityEnd?: string;
  availabilityNotes?: string;
}

/**
 * Asset type options
 */
export type AssetType =
  | 'production'
  | 'packaging'
  | 'quality_control'
  | 'logistics'
  | 'utility'
  | 'other';

/**
 * Asset status options
 */
export type AssetStatus = 'operational' | 'maintenance' | 'repair' | 'standby' | 'decommissioned';

/**
 * Department entity
 */
export interface Department {
  id: number;
  name: string;
  description?: string;
  areaId?: number;
}

/**
 * Area entity
 */
export interface Area {
  id: number;
  name: string;
  description?: string;
  type?: string;
}

/**
 * Form data for asset creation/update
 */
export interface AssetFormData {
  name: string;
  model?: string;
  manufacturer?: string;
  serialNumber?: string;
  departmentId?: number;
  areaId?: number;
  assetType?: string;
  status: string;
  operatingHours?: number;
  nextMaintenance?: string;
}

/**
 * Asset status filter types — Phase 4.4b: aligned 1:1 with backend
 * `?status=` enum (`assets/dto/list-assets-query.dto.ts:AssetStatusEnum`)
 * plus `'all'` as the no-filter sentinel.
 *
 * Pre-Phase-4.4b this set included `'cleaning'` and `'other'`, which never
 * existed in the backend enum and silently filtered to zero matches in the
 * client-side filter. Greenfield (CLAUDE.md): drift removed without a
 * migration shim. `'decommissioned'` is now the canonical end-of-life
 * status (see `STATUS_LABELS` in `_lib/constants.ts`).
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.4b (D5)
 */
export type AssetStatusFilter = 'all' | AssetStatus;

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  data?: T;
  success?: boolean;
}

/**
 * Team entity
 */
export interface Team {
  id: number;
  name: string;
  description?: string;
  departmentId?: number;
  departmentName?: string;
}

/**
 * Asset team assignment (from API response)
 */
export interface AssetTeam {
  id: number;
  teamId: number;
  teamName: string;
  departmentId?: number;
  departmentName?: string;
  isPrimary: boolean;
  assignedAt?: string;
  notes?: string;
}

// Phase 4.4b (2026-05-05): `PaginationPageItem` (the ellipsis-aware
// page-button UI item type) was removed. Server-driven pagination
// renders one anchor per page via `Array.from({length: totalPages})`
// in `+page.svelte` — the simpler shape from the §4.1b reference impl.
// The previous ellipsis helper (`getVisiblePages`) capped the visible
// window at 5 pages; with realistic tenant volumes (≤ 100 assets, page
// size 25 → ≤ 4 pages) the window cap was unreachable, so the helper
// was pure complexity without payoff. If a tenant ever lands > 10 pages
// the simple list still renders correctly — we revisit windowing only
// when real data demands it.
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.4b
// @see frontend/src/routes/(app)/(shared)/manage-employees/+page.svelte (reference impl)
