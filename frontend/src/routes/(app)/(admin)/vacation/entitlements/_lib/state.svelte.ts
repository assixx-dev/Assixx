// =============================================================================
// VACATION ENTITLEMENTS — REACTIVE STATE (Svelte 5 Runes)
// Employee selection, balance display, entitlement form, add-days modal.
//
// Search + pagination are URL-driven (Phase 5.2.1, §D26) — they are NOT
// shadowed in this state module. `+page.server.ts` is the single source of
// truth via SvelteKit's `data` prop; `+page.svelte` reads `data.search` /
// `data.pagination` directly and updates them via `goto()`.
// =============================================================================

import type { EmployeeListItem, VacationBalance } from './types';

// ─── Data ───────────────────────────────────────────────────────────

let employees = $state<EmployeeListItem[]>([]);
let selectedEmployee = $state<EmployeeListItem | null>(null);
let balance = $state<VacationBalance | null>(null);
let selectedYear = $state(new Date().getFullYear());

// ─── UI ─────────────────────────────────────────────────────────────

let isLoading = $state(false);
let isLoadingBalance = $state(false);

// Modals
let showEntitlementForm = $state(false);
let showAddDaysModal = $state(false);

// ─── Methods ────────────────────────────────────────────────────────

function selectEmployee(emp: EmployeeListItem) {
  selectedEmployee = emp;
  balance = null;
}

function clearSelection() {
  selectedEmployee = null;
  balance = null;
  showEntitlementForm = false;
  showAddDaysModal = false;
}

function openEntitlementForm() {
  showEntitlementForm = true;
}

function closeEntitlementForm() {
  showEntitlementForm = false;
}

function openAddDaysModal() {
  showAddDaysModal = true;
}

function closeAddDaysModal() {
  showAddDaysModal = false;
}

function reset() {
  employees = [];
  selectedEmployee = null;
  balance = null;
  selectedYear = new Date().getFullYear();
  isLoading = false;
  isLoadingBalance = false;
  showEntitlementForm = false;
  showAddDaysModal = false;
}

export const entitlementsState = {
  // Data getters
  get employees() {
    return employees;
  },
  get selectedEmployee() {
    return selectedEmployee;
  },
  get balance() {
    return balance;
  },
  get selectedYear() {
    return selectedYear;
  },

  // Data setters
  setEmployees: (data: EmployeeListItem[]) => {
    employees = data;
  },
  setBalance: (data: VacationBalance | null) => {
    balance = data;
  },
  setSelectedYear: (year: number) => {
    selectedYear = year;
    balance = null;
  },

  // UI getters
  get isLoading() {
    return isLoading;
  },
  get isLoadingBalance() {
    return isLoadingBalance;
  },
  get showEntitlementForm() {
    return showEntitlementForm;
  },
  get showAddDaysModal() {
    return showAddDaysModal;
  },

  // UI setters
  setLoading: (val: boolean) => {
    isLoading = val;
  },
  setLoadingBalance: (val: boolean) => {
    isLoadingBalance = val;
  },

  // Employee selection
  selectEmployee,
  clearSelection,

  // Modals
  openEntitlementForm,
  closeEntitlementForm,
  openAddDaysModal,
  closeAddDaysModal,

  // Global
  reset,
};
