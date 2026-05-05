// =============================================================================
// MANAGE TEAMS - TYPE DEFINITIONS
// =============================================================================

import type { IsActiveStatus, FormIsActiveStatus, StatusFilter } from '@assixx/shared';

export type { IsActiveStatus, FormIsActiveStatus, StatusFilter };

/**
 * Department interface — with area hierarchy + assigned hall.
 *
 * Hall is the department's single (1:1) hall assignment after migration
 * 20260505221345432_simplify-department-hall-1to1. Teams display the hall
 * via `team.department.hallName` derived in the modal.
 */
export interface Department {
  id: number;
  name: string;
  areaId?: number;
  areaName?: string;
  hallId?: number | null;
  hallName?: string | null;
}

/**
 * Badge info for display with tooltip
 * BADGE-INHERITANCE-DISPLAY: Used for showing hierarchy tooltips
 */
export interface BadgeInfo {
  class: string;
  text: string;
  title: string;
}

/**
 * Asset interface
 */
export interface Asset {
  id: number;
  name: string;
  departmentId?: number;
  departmentName?: string;
  status?: string;
}

/**
 * Team member interface
 */
export interface TeamMember {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  position?: string;
  role?: string;
}

/**
 * Admin interface for team lead selection
 */
export interface Admin {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role?: string;
}

/**
 * Hall interface
 */
export interface Hall {
  id: number;
  name: string;
  areaId?: number;
  departmentIds?: number[];
}

/**
 * Team interface - main data model.
 *
 * Hall is inherited transitively from `team.department.hall_id` (1:1 model
 * after migration 20260505221345432_simplify-department-hall-1to1). The
 * backend serialises it as `hallId` + `hallName` for display.
 */
export interface Team {
  id: number;
  name: string;
  description?: string;
  leaderId?: number;
  leaderName?: string;
  departmentId?: number;
  departmentName?: string;
  departmentAreaName?: string;
  teamDeputyLeadId?: number | null;
  teamDeputyLeadName?: string;
  memberCount?: number | string;
  memberNames?: string;
  assetCount?: number | string;
  assetNames?: string;
  hallId?: number | null;
  hallName?: string | null;
  isActive: IsActiveStatus;
  createdAt: string;
  updatedAt: string;
  members?: TeamMember[];
  assets?: Asset[];
}

/**
 * Team form data structure.
 *
 * No hall field — the team's hall is read-only and managed via the parent
 * department's hall assignment.
 */
export interface TeamFormData {
  name: string;
  description: string;
  departmentId: number | null;
  leaderId: number | null;
  memberIds: number[];
  assetIds: number[];
  isActive: FormIsActiveStatus;
}

/**
 * API request payload for creating/updating team
 */
export interface TeamPayload {
  name: string;
  description?: string;
  departmentId?: number | null;
  leaderId?: number | null;
  teamDeputyLeadId?: number | null;
  isActive: FormIsActiveStatus;
}

/**
 * Team details response with relations
 */
export interface TeamDetails {
  members?: { id: number }[];
  assets?: { id: number }[];
}

/**
 * API error with details
 */
export interface ApiErrorWithDetails {
  message?: string;
  code?: string;
  details?: {
    memberCount?: number;
  };
}
