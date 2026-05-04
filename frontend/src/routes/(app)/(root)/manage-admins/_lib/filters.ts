// =============================================================================
// MANAGE ADMINS - FILTER FUNCTIONS (Pure Functions)
// =============================================================================
//
// Phase 4.2 (2026-05-05): `filterByStatus`, `filterBySearch`, and
// `applyAllFilters` were REMOVED. The page now applies status + search
// filters server-side via `?isActive=N` and `?search=...` query params on
// `/users?role=admin` (handled by the backend /users service which already
// supports both filter params after Phase 4.1a — see masterplan §4.1a).
//
// `filterAvailableDepartments` and `filterDepartmentIdsByAreas` are
// PRESERVED — they implement the area↔department dependency logic in the
// AdminFormModal (`AdminOrganizationSection.svelte`) and have nothing to do
// with the page-level admin list filtering.
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.2

import type { Department } from './types';

/**
 * Filter available departments based on selected areas.
 * Hides departments that are already covered by selected areas
 */
export function filterAvailableDepartments(
  allDepartments: Department[],
  selectedAreaIds: number[],
  hasFullAccess: boolean,
): Department[] {
  if (hasFullAccess) return [];

  return allDepartments.filter((dept) => {
    // If department's area is in selected areas, hide it (already covered)
    return !selectedAreaIds.includes(dept.areaId ?? -1);
  });
}

/** Filter department IDs to remove those covered by selected areas */
export function filterDepartmentIdsByAreas(
  departmentIds: number[],
  allDepartments: Department[],
  selectedAreaIds: number[],
): number[] {
  return departmentIds.filter((deptId) => {
    const dept = allDepartments.find((d) => d.id === deptId);
    return !selectedAreaIds.includes(dept?.areaId ?? -1);
  });
}
