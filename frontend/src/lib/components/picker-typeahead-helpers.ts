/**
 * Pure helpers for the PickerTypeahead component.
 *
 * Extracted into a standalone module so the logic can be unit-tested
 * under the `frontend-unit` Vitest project (Node env, no DOM library).
 * The `.svelte` file imports these and adds rendering + lifecycle only.
 *
 * Design intent (FEAT_SERVER_DRIVEN_PAGINATION §4.12 Decision Q3,
 * 2026-05-01): one debounced typeahead drives all 6 picker call sites
 * (5 lead pickers + 1 employee picker). Pattern: `?search=<term>&limit=20`,
 * 250 ms debounce, no client-side full-list cache. Replaces the
 * pre-Phase-4.12 `&limit=100` band-aid that silently truncated the 101st
 * candidate (R6 / Audit B2 / B3).
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.12
 */

/**
 * Minimal user-record shape the picker needs.
 *
 * NOT a re-export of `SafeUserResponse` from the backend — the picker
 * deliberately depends on a narrow subset so it stays a domain-cross-cutting
 * component (consumers in `manage-areas`, `manage-departments`,
 * `manage-teams` each have their own richer User type and pull what they
 * need from `option.raw`).
 */
export interface PickerUserRecord {
  id: number;
  uuid: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  position?: string | null;
  role?: string;
  // Additional fields used by the SearchResultUser-style suggestion row
  // (DS component, see ADR-017 + design-system/primitives/search-input).
  // Populated from /users SafeUserResponse: `username`, `employeeNumber`,
  // `profilePicture`. Optional because EDIT-mode pre-population stubs
  // (pickerOptionFromIdAndName) don't have them — SearchResultUser falls
  // back gracefully (initials, no #empno, no avatar image).
  username?: string;
  employeeNumber?: string | null;
  profilePicture?: string | null;
}

/**
 * UI-ready picker option. The component never re-derives a label inside
 * the render path; consumers can override the formatter to inject role
 * suffixes, position chips, etc.
 */
export interface PickerOption {
  /** Stable identity for `{#each}` keys + dedup. */
  id: number;
  /** Primary text rendered in the chip + suggestion row. */
  label: string;
  /** Optional secondary text (email, role) rendered smaller. */
  sublabel?: string;
  /** Original backend record — consumers pull additional fields from here. */
  raw: PickerUserRecord;
}

/**
 * Default label formatter — "FirstName LastName" with email as sublabel.
 *
 * Falls back to the email when both names are null/empty (rare but valid:
 * fresh OAuth signups before profile completion). Empty-string check uses
 * `?? ''` + `.trim()` so explicit-empty backend values are normalised.
 */
export function defaultFormatOption(raw: PickerUserRecord): {
  label: string;
  sublabel?: string;
} {
  const first = (raw.firstName ?? '').trim();
  const last = (raw.lastName ?? '').trim();
  const composedName = `${first} ${last}`.trim();
  const label = composedName.length > 0 ? composedName : raw.email;
  const sublabel = composedName.length > 0 ? raw.email : undefined;
  return sublabel === undefined ? { label } : { label, sublabel };
}

/**
 * Map a backend record to a `PickerOption` using either the supplied
 * formatter or `defaultFormatOption`.
 */
export function mapToPickerOption(
  raw: PickerUserRecord,
  formatter: (raw: PickerUserRecord) => { label: string; sublabel?: string } = defaultFormatOption,
): PickerOption {
  const { label, sublabel } = formatter(raw);
  return sublabel === undefined ? { id: raw.id, label, raw } : { id: raw.id, label, sublabel, raw };
}

/**
 * Build the `/users` (or any list endpoint) query string for a typeahead
 * fetch.
 *
 * - `term` is trimmed; empty → no `search=` key emitted (lets the picker
 *   open with no input and still get a useful first page of results).
 * - `baseParams` carries call-site filters (`role`, `position`, `isActive`).
 *   Empty values are skipped so the URL stays clean (R5: only emit
 *   non-default params).
 * - `limit` is always emitted (we always want a bounded page).
 */
export function buildPickerSearchQuery(
  term: string,
  baseParams: Readonly<Record<string, string>>,
  limit: number,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(baseParams)) {
    if (value !== '') {
      params.set(key, value);
    }
  }

  const trimmed = term.trim();
  if (trimmed.length > 0) {
    params.set('search', trimmed);
  }

  params.set('limit', String(limit));
  params.set('page', '1');

  return params.toString();
}

/**
 * Append a new option to a multi-select array.
 *
 * - Returns the unchanged input when `option.id` is already selected
 *   (referential equality preserved → Svelte 5 won't re-render the chip
 *   list unnecessarily).
 * - Returns the unchanged input when `maxSelected` is exceeded.
 * - Otherwise returns a fresh array (so `$bindable` mutation triggers
 *   reactivity on the parent).
 */
export function addToSelected(
  current: readonly PickerOption[],
  option: PickerOption,
  maxSelected?: number,
): PickerOption[] {
  if (current.some((o) => o.id === option.id)) {
    return current as PickerOption[];
  }
  if (maxSelected !== undefined && current.length >= maxSelected) {
    return current as PickerOption[];
  }
  return [...current, option];
}

/**
 * Remove an option from a multi-select array by id. Returns the unchanged
 * input when no match — same referential-equality discipline as
 * `addToSelected`.
 */
export function removeFromSelected(current: readonly PickerOption[], id: number): PickerOption[] {
  if (!current.some((o) => o.id === id)) {
    return current as PickerOption[];
  }
  return current.filter((o) => o.id !== id);
}

/**
 * "Is this id already selected?" — works for both single and multi modes.
 *
 * Used to (a) hide already-selected entries from the suggestion list
 * (multi-mode UX) and (b) mark the current single-select option in the
 * dropdown so re-clicking is a no-op rather than a stutter.
 */
/**
 * Custom type guard — `Array.isArray` cannot narrow
 * `T | readonly T[]` because `readonly T[]` is not assignable to
 * `any[]` (TypeScript quirk). This guard makes the narrow explicit so
 * BOTH branches type-check without `as` assertions.
 */
function isPickerOptionArray(
  value: PickerOption | readonly PickerOption[],
): value is readonly PickerOption[] {
  return Array.isArray(value);
}

export function isOptionSelected(
  value: PickerOption | readonly PickerOption[] | null,
  id: number,
): boolean {
  if (value === null) return false;
  if (isPickerOptionArray(value)) {
    return value.some((o) => o.id === id);
  }
  return value.id === id;
}

/**
 * Filter selected options out of a freshly-fetched suggestion list.
 *
 * Multi-mode UX: chosen entries should not reappear in suggestions —
 * removes the dead-click footgun of "I already picked Alice, why is
 * Alice still showing?". Single-mode keeps every result so the user can
 * swap selection in one click.
 */
export function filterSuggestions(
  fetched: readonly PickerOption[],
  value: PickerOption | readonly PickerOption[] | null,
  multiple: boolean,
): PickerOption[] {
  if (!multiple) {
    return fetched as PickerOption[];
  }
  if (value === null || !isPickerOptionArray(value)) {
    return fetched as PickerOption[];
  }
  return fetched.filter((o) => !value.some((sel) => sel.id === o.id));
}

/**
 * Build a PickerOption from `(id, name)` pairs found on entity rows
 * (`area.areaLeadName`, `dept.departmentDeputyLeadName`, `team.leaderName`,
 * etc.). Used by EDIT-mode pre-population so the picker shows the stored
 * selection without a second `/users/:id` round-trip.
 *
 * Returns `null` when `id` is `null/undefined` OR when `label` is missing —
 * the chip cannot render without a label, so a `null` form-state value is
 * the honest representation of "no current selection". Consumers do
 * `formXxx = pickerOptionFromIdAndName(entity.xxxId, entity.xxxName)`.
 *
 * The `raw` record is a stub: `uuid` defaults to `''`, name fields default
 * to `null`, email to `''`. The picker's own search path always re-fetches
 * fresh records, so the stub only has to survive ONE render of the chip
 * (which uses `option.label` directly, not `raw`).
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.12 §D23
 */
/**
 * Internal: build the stub `PickerUserRecord` for `pickerOptionFromIdAndName`.
 * Extracted to keep the public helper under the eslint complexity cap (10).
 */
function buildPickerRaw(id: number, overrides: Partial<PickerUserRecord>): PickerUserRecord {
  return {
    id,
    uuid: overrides.uuid ?? '',
    firstName: overrides.firstName ?? null,
    lastName: overrides.lastName ?? null,
    email: overrides.email ?? '',
    ...(overrides.position !== undefined ? { position: overrides.position } : {}),
    ...(overrides.role !== undefined ? { role: overrides.role } : {}),
  };
}

export function pickerOptionFromIdAndName(
  id: number | null | undefined,
  label: string | null | undefined,
  rawOverrides: Partial<PickerUserRecord> = {},
): PickerOption | null {
  if (id === null || id === undefined) return null;
  if (label === null || label === undefined || label === '') return null;
  return { id, label, raw: buildPickerRaw(id, rawOverrides) };
}

/**
 * Debounce factory for the typeahead's keystroke → fetch path.
 *
 * Returns `{ call, cancel }`:
 * - `call(...args)` (re-)schedules the wrapped function `delayMs` ms in
 *   the future. Successive calls within the window collapse into one.
 * - `cancel()` clears any pending invocation — used on unmount + on
 *   selection (a click resolves the search; the in-flight debounce should
 *   not fire after).
 *
 * Generic over the wrapped function's argument tuple so types flow
 * through to call-sites without `as any` casts. Uses a closed-over
 * `setTimeout` handle (`ReturnType<typeof setTimeout>` for Node + DOM
 * compat — frontend-unit tests run in Node).
 */
export function createDebouncedFunction<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): { call: (...args: A) => void; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | null = null;

  return {
    call(...args: A): void {
      if (handle !== null) {
        clearTimeout(handle);
      }
      handle = setTimeout(() => {
        handle = null;
        fn(...args);
      }, delayMs);
    },
    cancel(): void {
      if (handle !== null) {
        clearTimeout(handle);
        handle = null;
      }
    },
  };
}
