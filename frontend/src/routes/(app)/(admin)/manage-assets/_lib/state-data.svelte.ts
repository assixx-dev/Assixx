// =============================================================================
// MANAGE ASSETS - DATA STATE MODULE (reference data only)
// =============================================================================
//
// Phase 4.4b (2026-05-05): `allAssets` / `filteredAssets` (and their setters)
// were removed. Server-driven pagination puts the asset page slice in
// `+page.server.ts` → `data.assets` (PageData prop) — there is NO client
// `$state` shadow of the asset list. Reference data (departments, areas,
// teams, hierarchy labels) is still mirrored here because the form modal
// (`AssetFormModal.svelte`) consumes it via `assetState.allAreas` etc.
//
// @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.4b

import { DEFAULT_HIERARCHY_LABELS, type HierarchyLabels } from '$lib/types/hierarchy-labels';

import type { Department, Area, Team } from './types';

/**
 * Creates reference-data state (departments, areas, teams, labels) consumed
 * by the form modal. The asset list itself is no longer mirrored here —
 * pages read it directly from the SSR `data` prop.
 */
export function createDataState() {
  let allDepartments = $state<Department[]>([]);
  let allAreas = $state<Area[]>([]);
  let allTeams = $state<Team[]>([]);
  let labels = $state(DEFAULT_HIERARCHY_LABELS);

  return {
    get allDepartments() {
      return allDepartments;
    },
    get allAreas() {
      return allAreas;
    },
    get allTeams() {
      return allTeams;
    },
    get labels() {
      return labels;
    },
    setDepartments: (v: Department[]) => {
      allDepartments = v;
    },
    setAreas: (v: Area[]) => {
      allAreas = v;
    },
    setTeams: (v: Team[]) => {
      allTeams = v;
    },
    setLabels: (v: HierarchyLabels) => {
      labels = v;
    },
  };
}

export type DataState = ReturnType<typeof createDataState>;
