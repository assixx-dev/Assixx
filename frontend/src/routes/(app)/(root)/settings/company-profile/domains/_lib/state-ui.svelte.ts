/**
 * Tenant Domains — UI State (Svelte 5 Runes)
 *
 * Modal open/close, in-flight action ID, currently-open instructions panel ID.
 * No backend state lives here — see `state-data.svelte.ts` for that. This split
 * is per the v0.3.4 D24 review: keeping UI state separate makes the §5.4.1
 * "modal open/close isolation" unit test trivial without dragging in the
 * domains list.
 *
 * Svelte 5 `$state` is module-scoped (singleton across imports), so the
 * modal/in-flight state is automatically shared between `+page.svelte` and
 * the child components (`AddDomainModal`, `DomainRow`) without prop drilling.
 *
 * **Instructions panel — single source of truth = `data.domains` (ADR-049
 * amendment 2026-05-04):** the previous implementation cached
 * `{id, domain, instructions}` here as a one-shot snapshot from the
 * `POST /domains` response. That broke after page reload / SPA navigation /
 * "Schließen" — the token was unrecoverable. The backend now emits
 * `verificationInstructions` for every non-verified row on every GET, so this
 * module only needs the row's ID; the page renders the panel by looking up
 * the row in `data.domains` and reading `row.verificationInstructions`. The
 * net effect: no flicker between `openInstructionsFor(id)` and `invalidateAll`,
 * no token loss, no stale in-memory copy.
 *
 * @see masterplan §5.1 + §5.4.1 (modal-open-close isolation test)
 * @see docs/infrastructure/adr/ADR-049-tenant-domain-verification.md
 */

// --- Add-domain modal state ---

let addModalOpen = $state(false);
let addModalDomain = $state(''); // controlled-input value
let addModalSubmitting = $state(false);

// --- In-flight action tracker ---
//
// Single ID at a time — UI assumption: only one row's verify/primary/remove
// action can be in-flight concurrently. The DomainRow disables action buttons
// when its own id matches `pendingActionId`. Cheaper + simpler than a per-row
// flag map.

let pendingActionId = $state<string | null>(null);

// --- Open instructions panel (just an ID) ---
//
// Identifies which domain row's TXT instructions are currently surfaced.
// `null` = no panel open. Set via `openInstructionsFor(id)` after add-success
// or when the user clicks "TXT anzeigen" on a pending row; cleared by
// `closeInstructions()` on the panel's "Schließen" button. The panel renders
// only while the referenced row exists in `data.domains` AND has
// `status !== 'verified'` (auto-dismiss after successful verify) — that
// guard lives in `+page.svelte`, not here, so this module stays free of
// any cross-coupling to `state-data`.

let openInstructionsId = $state<string | null>(null);

// --- Add-modal getters/setters ---

export function getAddModalOpen(): boolean {
  return addModalOpen;
}

export function getAddModalDomain(): string {
  return addModalDomain;
}

export function setAddModalDomain(value: string): void {
  addModalDomain = value;
}

export function getAddModalSubmitting(): boolean {
  return addModalSubmitting;
}

export function setAddModalSubmitting(value: boolean): void {
  addModalSubmitting = value;
}

export function openAddModal(): void {
  addModalOpen = true;
  addModalDomain = '';
  addModalSubmitting = false;
}

/**
 * Close the modal AND reset its form state. Svelte 5 `$state` is NOT
 * automatically reset on unmount — without this, re-opening the modal
 * would surface the previous input value. This is the contract pinned by
 * the §5.4.1 "modal open/close isolation" unit test.
 */
export function closeAddModal(): void {
  addModalOpen = false;
  addModalDomain = '';
  addModalSubmitting = false;
}

// --- Pending-action getters/setters ---

export function getPendingActionId(): string | null {
  return pendingActionId;
}

export function setPendingActionId(id: string | null): void {
  pendingActionId = id;
}

// --- Instructions-panel getters/setters ---

export function getOpenInstructionsId(): string | null {
  return openInstructionsId;
}

export function openInstructionsFor(id: string): void {
  openInstructionsId = id;
}

export function closeInstructions(): void {
  openInstructionsId = null;
}
