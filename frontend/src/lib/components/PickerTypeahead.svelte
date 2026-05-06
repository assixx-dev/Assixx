<!--
  PickerTypeahead — debounced typeahead for `/users` (and any list endpoint
  with the same `?search=&limit=&page=&...` contract).

  Replaces the pre-Phase-4.12 `&limit=100` band-aid (Audit B2/B3) that
  silently truncated the 101st candidate. Pattern: 250 ms debounce on
  keystrokes, single backend round-trip per stable term, no client-side
  full-list cache (`apiClient.get` invoked with `skipCache: true`).

  Designed as the single component for all 6 picker call sites:
  - manage-areas: admin lead, root lead, deputy variants
  - manage-departments: admin lead, root lead, deputy variants
  - manage-teams: team lead, deputy lead, team-member assignment (multi)

  Modes:
  - `multiple={false}` (default) — value: PickerOption | null, selection
    closes the dropdown and replaces the current pick.
  - `multiple={true}` — value: PickerOption[], selection appends + clears
    the input but keeps the dropdown open for further picks. Picked
    entries are filtered out of subsequent suggestion lists.

  ARIA: combobox pattern (input has role="combobox", listbox below has
  role="listbox", options have role="option", aria-activedescendant tracks
  keyboard focus). Click-outside detection uses the existing capture-phase
  action so the picker works inside modals (which stopPropagation their
  bubble-phase clicks).

  @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.12
-->
<script lang="ts">
  import { onClickOutsideDropdown } from '$lib/actions/click-outside';
  import { apiClient } from '$lib/utils/api-client';
  import { createLogger } from '$lib/utils/logger';

  import {
    addToSelected,
    buildPickerSearchQuery,
    createDebouncedFunction,
    defaultFormatOption,
    filterSuggestions,
    isOptionSelected,
    mapToPickerOption,
    removeFromSelected,
    type PickerOption,
    type PickerUserRecord,
  } from './picker-typeahead-helpers';

  const log = createLogger('PickerTypeahead');

  // ─── Props ────────────────────────────────────────────────────────────────
  interface Props {
    /** Backend endpoint, e.g. `/users`. No leading API base — `apiClient`
     *  prepends `/api/v2`. */
    endpoint?: string;
    /** Call-site filters merged into every search request (`role`,
     *  `position`, `isActive`). Empty values are skipped (R5). */
    searchParams?: Readonly<Record<string, string>>;
    /** Bindable selection. `multiple={false}` ⇒ `PickerOption | null`;
     *  `multiple={true}` ⇒ `PickerOption[]`. */
    value?: PickerOption | PickerOption[] | null;
    /** Switches between single-select (default) and multi-select chip
     *  list. */
    multiple?: boolean;
    /** Cap on multi-select size. Ignored in single mode. */
    maxSelected?: number;
    placeholder?: string;
    /** ARIA label for the input (use when no visible label is rendered). */
    ariaLabel?: string;
    /** id of a `<label for="...">` element wrapping the picker. Renders
     *  as `aria-labelledby` on the combobox input. */
    labelledBy?: string;
    disabled?: boolean;
    required?: boolean;
    /** ms between last keystroke and the fetch. Default 250 (§4.12). */
    debounceMs?: number;
    /** Backend `limit` per fetch. Default 20 (§4.12). */
    pageSize?: number;
    /** Override the default "FirstName LastName" / email formatter. */
    formatOption?: (raw: PickerUserRecord) => { label: string; sublabel?: string };
    /** Localised user-facing strings. Defaults are German (matches the
     *  pickers' existing call sites). */
    placeholderText?: string;
    loadingText?: string;
    noResultsText?: string;
    errorText?: string;
    /** Multi-mode only — text shown in the chip area when no chips yet. */
    emptySelectionText?: string;
  }

  /* eslint-disable prefer-const -- Svelte $bindable() requires let */
  let {
    endpoint = '/users',
    searchParams = {},
    value = $bindable(null),
    multiple = false,
    maxSelected,
    placeholder,
    ariaLabel,
    labelledBy,
    disabled = false,
    required = false,
    debounceMs = 250,
    pageSize = 20,
    formatOption = defaultFormatOption,
    placeholderText = 'Suchen…',
    loadingText = 'Suche läuft…',
    noResultsText = 'Keine Treffer',
    errorText = 'Suche fehlgeschlagen',
    emptySelectionText = 'Niemand ausgewählt',
  }: Props = $props();
  /* eslint-enable prefer-const */

  // ─── Local UI state ───────────────────────────────────────────────────────
  let inputValue = $state('');
  let isOpen = $state(false);
  let isLoading = $state(false);
  let hasError = $state(false);
  let suggestions = $state<PickerOption[]>([]);
  let activeIndex = $state(-1);
  /** Monotonically incremented per fetch — discards stale responses
   *  when keystrokes overlap (last-write-wins). */
  let requestSeq = 0;
  /** Stable id prefix for ARIA attributes (one combobox per instance). */
  const instanceId = $props.id();

  const visibleSuggestions = $derived(filterSuggestions(suggestions, value, multiple));

  // ─── Fetch path ───────────────────────────────────────────────────────────

  async function runSearch(term: string): Promise<void> {
    requestSeq += 1;
    const seq = requestSeq;
    isLoading = true;
    hasError = false;

    const qs = buildPickerSearchQuery(term, searchParams, pageSize);
    const url = `${endpoint}?${qs}`;

    try {
      // skipCache: typeahead must always reflect fresh backend state
      // (newly-created users in another tab/session must show up).
      // Endpoint-keyed caching could otherwise serve a stale list for
      // the same exact term.
      const records = await apiClient.get<PickerUserRecord[]>(url, { skipCache: true });
      if (seq !== requestSeq) {
        // A newer request started — drop this response on the floor.
        return;
      }
      const mapped =
        Array.isArray(records) ? records.map((r) => mapToPickerOption(r, formatOption)) : [];
      suggestions = mapped;
      activeIndex = mapped.length > 0 ? 0 : -1;
    } catch (err: unknown) {
      if (seq !== requestSeq) return;
      log.warn({ err, endpoint, term }, 'Picker search failed');
      suggestions = [];
      activeIndex = -1;
      hasError = true;
    } finally {
      if (seq === requestSeq) {
        isLoading = false;
      }
    }
  }

  // Capture `debounceMs` at component creation — runtime-changing the
  // delay would invalidate the timer handle pattern in
  // `createDebouncedFunction`. Parents pass it once via $props and never
  // mutate it. The svelte-ignore acknowledges the intentional capture.
  // svelte-ignore state_referenced_locally
  const debounced = createDebouncedFunction((term: string) => {
    void runSearch(term);
  }, debounceMs);

  // ─── Event handlers ───────────────────────────────────────────────────────

  function handleInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    inputValue = target.value;
    isOpen = true;
    debounced.call(inputValue);
  }

  function handleFocus(): void {
    if (disabled) return;
    isOpen = true;
    // Trigger an initial search so the dropdown isn't empty on focus.
    // Cancel pending input-debounce so this fetch is the only one.
    debounced.cancel();
    void runSearch(inputValue);
  }

  /** Read the current multi-mode selection as a typed array.
   *  Centralises the Array.isArray narrow so handlers stay terse.
   *  TS ts-plugin treats the cast as redundant (`any[]` flows into
   *  `readonly PickerOption[]`); the narrow itself is still load-bearing. */
  function currentMultiArray(): readonly PickerOption[] {
    return multiple && Array.isArray(value) ? value : [];
  }

  function selectOption(option: PickerOption): void {
    if (multiple) {
      value = addToSelected(currentMultiArray(), option, maxSelected);
      // Stay open for further picks; clear the input so the user can
      // type the next name from scratch.
      inputValue = '';
      debounced.cancel();
      void runSearch('');
    } else {
      value = option;
      inputValue = '';
      isOpen = false;
      debounced.cancel();
    }
  }

  function removeChip(id: number): void {
    if (!multiple) {
      value = null;
      return;
    }
    value = removeFromSelected(currentMultiArray(), id);
  }

  // Per-key handlers extracted from handleKeydown so the dispatcher stays
  // under the SonarJS cognitive-complexity budget (max 10) and the
  // ESLint complexity rule (max 10). Each helper owns one concern.

  function moveActive(delta: 1 | -1): void {
    if (visibleSuggestions.length === 0) return;
    isOpen = true;
    if (delta === 1) {
      activeIndex = (activeIndex + 1) % visibleSuggestions.length;
    } else {
      activeIndex = activeIndex <= 0 ? visibleSuggestions.length - 1 : activeIndex - 1;
    }
  }

  function commitActive(): void {
    if (!isOpen) return;
    if (activeIndex < 0 || activeIndex >= visibleSuggestions.length) return;
    selectOption(visibleSuggestions[activeIndex]);
  }

  function closeMenu(): void {
    if (!isOpen) return;
    isOpen = false;
    inputValue = '';
    debounced.cancel();
  }

  /** Backspace on empty input removes the last chip (multi-mode only). */
  function popLastChip(): boolean {
    if (!multiple || inputValue !== '') return false;
    const arr = currentMultiArray();
    if (arr.length === 0) return false;
    removeChip(arr[arr.length - 1].id);
    return true;
  }

  /** Per-key dispatch table — keeps handleKeydown's complexity low.
   *  Each entry returns true when it consumed the event (preventDefault
   *  is then applied centrally). Map (not object literal) so the
   *  KeyboardEvent.key strings — which must be PascalCase verbatim —
   *  don't trip the camelCase naming-convention lint rule. */
  const keyHandlers: ReadonlyMap<string, () => boolean> = new Map([
    [
      'ArrowDown',
      (): boolean => {
        if (visibleSuggestions.length === 0) return false;
        moveActive(1);
        return true;
      },
    ],
    [
      'ArrowUp',
      (): boolean => {
        if (visibleSuggestions.length === 0) return false;
        moveActive(-1);
        return true;
      },
    ],
    [
      'Enter',
      (): boolean => {
        if (!isOpen || activeIndex < 0) return false;
        commitActive();
        return true;
      },
    ],
    [
      'Escape',
      (): boolean => {
        if (!isOpen) return false;
        closeMenu();
        return true;
      },
    ],
    ['Backspace', (): boolean => popLastChip()],
  ]);

  function handleKeydown(event: KeyboardEvent): void {
    if (disabled) return;
    if (keyHandlers.get(event.key)?.() === true) {
      event.preventDefault();
    }
  }

  // Capture-phase click-outside (modal-safe — see click-outside.ts header).
  $effect(() => {
    return onClickOutsideDropdown(() => {
      if (isOpen) {
        isOpen = false;
      }
    });
  });

  // Cancel pending debounce on unmount to prevent late state updates.
  $effect(() => {
    return () => {
      debounced.cancel();
    };
  });

  // ─── Derived helpers for ARIA ─────────────────────────────────────────────
  const listboxId = `${instanceId}-listbox`;
  const activeOptionId = $derived(
    activeIndex >= 0 ? `${instanceId}-option-${activeIndex}` : undefined,
  );
  const singleSelected: PickerOption | null = $derived.by(() => {
    if (multiple) return null;
    if (value === null) return null;
    if (Array.isArray(value)) return null;
    return value;
  });
  const multiSelected: readonly PickerOption[] = $derived.by(() => {
    if (!multiple) return [];
    if (!Array.isArray(value)) return [];
    return value;
  });
  const placeholderActual = $derived(placeholder ?? placeholderText);
</script>

<div
  class="picker-typeahead dropdown"
  class:picker-typeahead--multi={multiple}
  class:picker-typeahead--disabled={disabled}
>
  {#if multiple}
    <div
      class="picker-typeahead__chips"
      role="list"
      aria-label="Ausgewählte Einträge"
    >
      {#each multiSelected as opt (opt.id)}
        <span
          class="picker-typeahead__chip badge badge--info"
          role="listitem"
        >
          <span class="picker-typeahead__chip-label">{opt.label}</span>
          <button
            type="button"
            class="picker-typeahead__chip-remove"
            aria-label={`${opt.label} entfernen`}
            {disabled}
            onclick={() => {
              removeChip(opt.id);
            }}
          >
            <i
              class="fas fa-times"
              aria-hidden="true"
            ></i>
          </button>
        </span>
      {/each}
      {#if multiSelected.length === 0}
        <span class="picker-typeahead__chip-empty">{emptySelectionText}</span>
      {/if}
    </div>
  {/if}

  <div class="picker-typeahead__input-wrap">
    {#if !multiple && singleSelected !== null && inputValue === ''}
      <span
        class="picker-typeahead__single-display badge badge--info"
        role="status"
      >
        <span class="picker-typeahead__chip-label">{singleSelected.label}</span>
        <button
          type="button"
          class="picker-typeahead__chip-remove"
          aria-label={`${singleSelected.label} entfernen`}
          {disabled}
          onclick={() => {
            value = null;
          }}
        >
          <i
            class="fas fa-times"
            aria-hidden="true"
          ></i>
        </button>
      </span>
    {/if}

    <input
      type="text"
      class="form-field__control picker-typeahead__input"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={isOpen}
      aria-controls={listboxId}
      aria-activedescendant={activeOptionId}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-required={required}
      aria-busy={isLoading}
      placeholder={placeholderActual}
      {disabled}
      value={inputValue}
      autocomplete="off"
      oninput={handleInput}
      onfocus={handleFocus}
      onkeydown={handleKeydown}
    />
  </div>

  <ul
    id={listboxId}
    class="dropdown__menu picker-typeahead__menu"
    class:active={isOpen}
    role="listbox"
    aria-busy={isLoading}
  >
    {#if isLoading && visibleSuggestions.length === 0}
      <li class="dropdown__option dropdown__option--disabled">
        <span class="spinner-ring spinner-ring--sm mr-2"></span>
        {loadingText}
      </li>
    {:else if hasError}
      <li
        class="dropdown__option dropdown__option--disabled"
        role="alert"
      >
        <i class="fas fa-exclamation-triangle mr-2"></i>
        {errorText}
      </li>
    {:else if visibleSuggestions.length === 0}
      <li class="dropdown__option dropdown__option--disabled">
        {noResultsText}
      </li>
    {:else}
      {#each visibleSuggestions as opt, i (opt.id)}
        {@const selectedAlready = !multiple && isOptionSelected(value, opt.id)}
        <li
          id={`${instanceId}-option-${i}`}
          class="dropdown__option picker-typeahead__option"
          class:picker-typeahead__option--active={i === activeIndex}
          class:picker-typeahead__option--selected={selectedAlready}
          role="option"
          aria-selected={selectedAlready}
        >
          <button
            type="button"
            class="picker-typeahead__option-btn"
            {disabled}
            onclick={() => {
              selectOption(opt);
            }}
            onmouseenter={() => {
              activeIndex = i;
            }}
          >
            <span class="picker-typeahead__option-label">{opt.label}</span>
            {#if opt.sublabel !== undefined && opt.sublabel !== ''}
              <span class="picker-typeahead__option-sublabel">{opt.sublabel}</span>
            {/if}
          </button>
        </li>
      {/each}
    {/if}
  </ul>
</div>

<style>
  /* Component-scoped overlay on top of the design-system dropdown
     primitives. Keeps the multi-select chip area, single-select inline
     badge, and option two-line layout without forking the dropdown CSS. */

  .picker-typeahead {
    position: relative;
    width: 100%;
  }

  .picker-typeahead--disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .picker-typeahead__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-1, 0.25rem);
    margin-bottom: var(--spacing-2, 0.5rem);
    padding: var(--spacing-1, 0.25rem);
    min-height: calc(var(--spacing-6, 1.5rem) + 2 * var(--spacing-1, 0.25rem));
  }

  .picker-typeahead__chip,
  .picker-typeahead__single-display {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-1, 0.25rem);
  }

  .picker-typeahead__chip-empty {
    color: var(--color-text-secondary, oklch(45% 0 0));
    font-style: italic;
  }

  .picker-typeahead__chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    cursor: pointer;
    padding: 0 var(--spacing-1, 0.25rem);
    color: inherit;
    font-size: 0.75em;
    line-height: 1;
  }

  .picker-typeahead__chip-remove:hover:not(:disabled) {
    color: var(--color-danger, oklch(60% 0.2 25));
  }

  .picker-typeahead__input-wrap {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .picker-typeahead__single-display {
    flex-shrink: 0;
  }

  .picker-typeahead__input {
    flex: 1;
    min-width: 8rem;
  }

  .picker-typeahead__menu {
    /* Width matches input wrap rather than dropdown__trigger */
    width: 100%;
    max-height: 16rem;
    overflow-y: auto;
  }

  .picker-typeahead__option {
    /* Reset list styles — the design-system dropdown__option assumes a
       button child, but we wrap in <li> for listbox semantics. */
    padding: 0;
  }

  .picker-typeahead__option-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.125rem;
    width: 100%;
    background: transparent;
    cursor: pointer;
    padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
    text-align: left;
    color: inherit;
  }

  .picker-typeahead__option-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .picker-typeahead__option--active .picker-typeahead__option-btn {
    background: var(--color-primary-bg, oklch(95% 0.05 250));
  }

  .picker-typeahead__option--selected .picker-typeahead__option-btn {
    font-weight: 600;
  }

  .picker-typeahead__option-label {
    font-size: 0.875rem;
  }

  .picker-typeahead__option-sublabel {
    color: var(--color-text-secondary, oklch(45% 0 0));
    font-size: 0.75rem;
  }
</style>
