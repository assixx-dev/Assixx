// =============================================================================
// MANAGE DEPARTMENTS - UTILITY FUNCTIONS
// =============================================================================

import { STATUS_BADGE_CLASSES, STATUS_LABELS, FORM_DEFAULTS } from './constants';

import type {
  Area,
  Department,
  DepartmentHallEntry,
  FormIsActiveStatus,
  IsActiveStatus,
} from './types';

// =============================================================================
// STATUS HELPERS
// =============================================================================

/** Get status badge class based on isActive value */
export function getStatusBadgeClass(isActive: IsActiveStatus): string {
  return STATUS_BADGE_CLASSES[isActive];
}

/** Get status label for display */
export function getStatusLabel(isActive: IsActiveStatus): string {
  return STATUS_LABELS[isActive];
}

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

/** Get area display name */
export function getAreaDisplay(areaName: string | null | undefined): string {
  return areaName ?? 'Keine Zuordnung';
}

/** Get department lead display name */
export function getLeadDisplay(leadName: string | null | undefined): string {
  return leadName ?? '-';
}

/** Get team count display text */
export function getTeamCountText(count: number, teamLabel: string): string {
  return `${count} ${teamLabel}`;
}

// =============================================================================
// DROPDOWN HELPERS
// =============================================================================

/** Get selected area name for dropdown trigger */
export function getSelectedAreaName(areaId: number | null, areas: Area[]): string {
  if (areaId === null) return 'Keine Zuordnung';
  const area = areas.find((a) => a.id === areaId);
  return area?.name ?? 'Keine Zuordnung';
}

// =============================================================================
// FORM HELPERS
// =============================================================================

/** Get hall display text — replaces previous count-based version (1:1 model). */
export function getHallDisplayText(hall: DepartmentHallEntry | null | undefined): string {
  return hall?.name ?? '— keine Zuordnung —';
}

/**
 * Build tooltip text for hall badge — single hall (1:1 model after migration
 * 20260505221345432_simplify-department-hall-1to1).
 */
export function getHallTooltip(hall: DepartmentHallEntry | null | undefined): string {
  return hall?.name ?? 'Keine zugeordnet';
}

/** Populate form from department data (for edit mode). 1:1 hall model. */
export function populateFormFromDepartment(department: Department): {
  name: string;
  description: string;
  areaId: number | null;
  departmentLeadId: number | null;
  departmentDeputyLeadId: number | null;
  hallId: number | null;
  isActive: FormIsActiveStatus;
} {
  const hallId = department.hall?.id ?? department.hallId ?? null;
  return {
    name: department.name,
    description: department.description ?? '',
    areaId: department.areaId ?? null,
    departmentLeadId: department.departmentLeadId ?? null,
    departmentDeputyLeadId: department.departmentDeputyLeadId ?? null,
    hallId,
    isActive: department.isActive === 4 ? 0 : department.isActive,
  };
}

/** Get default form values for new department */
export function getDefaultFormValues(): typeof FORM_DEFAULTS {
  return { ...FORM_DEFAULTS };
}
