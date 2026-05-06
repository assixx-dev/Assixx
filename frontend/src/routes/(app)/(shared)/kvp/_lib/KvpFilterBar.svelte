<script lang="ts">
  /**
   * KVP Filter Bar — All filter controls for the KVP suggestions list
   * (Phase 4.5b URL-driven state).
   *
   * Pre-Phase-4.5b this component mutated `kvpState.set*Filter()` and
   * called an `onfilterchange` callback that triggered a client-side
   * `loadSuggestionsData()`. Post-4.5b every filter value is read from
   * `data.*` props (URL-driven) and every change emits `navigate(...)`
   * which goto()s the new URL — the SSR load reruns automatically.
   *
   * Removed in 4.5b (per masterplan §D9 / Q3 sign-off + §D10):
   *   - Asset-filter dropdown (`assetFilter` state, `'asset'` view toggle).
   *   - Manage-view toggle (`'manage'` filter — no backend equivalent).
   *   - Department-filter dropdown (silent backend no-op — `?departmentId=`
   *     was stripped by Zod since `ListSuggestionsQuerySchema` doesn't
   *     declare it; use the "department" view toggle instead, which maps
   *     to `?orgLevel=department`).
   */

  import { onClickOutsideDropdown } from '$lib/actions/click-outside';
  import { DEFAULT_HIERARCHY_LABELS, type HierarchyLabels } from '$lib/types/hierarchy-labels';

  import { createFilterOptions, STATUS_FILTER_OPTIONS, type FilterToggleValue } from './constants';
  import { debounce } from './utils';

  import type { KvpCategory, UserTeamWithAssets } from './types';

  /**
   * Override shape passed to the parent's `onnavigate()` callback. Mirrors
   * the `FilterOverrides` interface in `+page.svelte` — duplicated locally
   * to avoid a circular import. Each value is either the URL-emittable form
   * or `undefined` to clear the filter (sentinel mapping happens in this
   * component's handlers, not in the parent's `navigateFilters()`).
   */
  type StatusUrlValue = 'new' | 'in_review' | 'approved' | 'implemented' | 'rejected' | 'archived';
  type OrgLevelUrlValue = 'company' | 'department' | 'area' | 'team';

  interface NavigateOverrides {
    search?: string;
    status?: StatusUrlValue | undefined;
    orgLevel?: OrgLevelUrlValue | undefined;
    categoryId?: number | undefined;
    customCategoryId?: number | undefined;
    teamId?: number | undefined;
    mineOnly?: 'true' | undefined;
  }

  /** Incoming prop shape — includes `'all'` sentinels for the no-filter state. */
  type StatusInputValue = StatusUrlValue | 'all';
  type OrgLevelInputValue = OrgLevelUrlValue | 'all';

  interface Props {
    userOrganizations: UserTeamWithAssets[];
    categories: KvpCategory[];
    labels?: HierarchyLabels;
    /** Search input value (URL-driven). */
    search: string;
    /** Status dropdown value — `'all'` is the no-filter sentinel. */
    status: StatusInputValue;
    /** orgLevel dropdown / view-toggle value — `'all'` is the no-filter sentinel. */
    orgLevel: OrgLevelInputValue;
    /** Selected global-category id (mutex with `customCategoryId`). */
    categoryId: number | null;
    /** Selected custom-category id (mutex with `categoryId`). */
    customCategoryId: number | null;
    /** Selected team id (URL-driven). */
    teamId: number | null;
    /** "Only my suggestions" toggle (URL-driven). */
    mineOnly: boolean;
    /**
     * Parent navigates to a new URL with the provided filter overrides.
     * Page resets to 1 on every call (default — not emitted into the URL).
     * Each unspecified key inherits the current URL value; explicit
     * `undefined` clears that filter.
     */
    onnavigate: (overrides: NavigateOverrides) => void;
  }

  const {
    userOrganizations,
    categories,
    labels = DEFAULT_HIERARCHY_LABELS,
    search,
    status,
    orgLevel,
    categoryId,
    customCategoryId,
    teamId,
    mineOnly,
    onnavigate,
  }: Props = $props();

  const filterOptions = $derived(createFilterOptions(labels));

  // ==========================================================================
  // VIEW-TOGGLE STATE (derived from URL state; mutex by design)
  //
  // The view toggle decomposes into URL primitives at navigation time:
  //   'all'        → no orgLevel, no mineOnly, status≠archived
  //   'mine'       → mineOnly=true
  //   'team'       → orgLevel=team
  //   'department' → orgLevel=department
  //   'company'    → orgLevel=company
  //   'archived'   → status=archived
  //
  // Multiple URL flags can be set simultaneously (e.g. mineOnly=true AND
  // orgLevel=team) but the toggle is mutex — `currentView` picks the most
  // specific match in priority order: archived > mineOnly > orgLevel > all.
  // ==========================================================================

  const currentView = $derived<FilterToggleValue>(
    status === 'archived' ? 'archived'
    : mineOnly ? 'mine'
    : orgLevel === 'team' ? 'team'
    : orgLevel === 'department' ? 'department'
    : orgLevel === 'company' ? 'company'
    : 'all',
  );

  // ==========================================================================
  // DROPDOWN UI STATE — local-only (controls open/closed; not URL-persistent).
  // ==========================================================================

  let activeDropdown = $state<string | null>(null);

  function toggleDropdown(dropdownId: string) {
    activeDropdown = activeDropdown === dropdownId ? null : dropdownId;
  }

  function closeAllDropdowns() {
    activeDropdown = null;
  }

  // ==========================================================================
  // DERIVED DISPLAY TEXT — read from URL state via lookup, no $state shadow.
  // ==========================================================================

  const statusDisplayText = $derived(
    STATUS_FILTER_OPTIONS.find((o) => o.value === (status === 'all' ? '' : status))?.label ??
      'Alle Status',
  );

  /**
   * Selected category dropdown label. Composite (`source:id`) lookup against
   * the categories list passed via props. Falls back to the no-filter label
   * when neither id is set or the id no longer exists (e.g. category was
   * soft-deleted between load and render).
   */
  const categoryDisplayText = $derived.by(() => {
    if (categoryId !== null) {
      const cat = categories.find((c) => c.source === 'global' && c.id === categoryId);
      return cat?.name ?? 'Alle Kategorien';
    }
    if (customCategoryId !== null) {
      const cat = categories.find((c) => c.source === 'custom' && c.id === customCategoryId);
      return cat?.name ?? 'Alle Kategorien';
    }
    return 'Alle Kategorien';
  });

  const teamDisplayText = $derived(
    teamId === null ?
      `Alle ${labels.team}`
    : (userOrganizations.find((t) => t.teamId === teamId)?.teamName ?? `Alle ${labels.team}`),
  );

  // ==========================================================================
  // HANDLERS — every change emits a `navigate()` call; no local state mutation.
  // ==========================================================================

  /**
   * View-toggle button → URL primitives. Decomposed into a small lookup
   * table so each call has linear control flow (keeps cyclomatic +
   * cognitive complexity under the budget).
   *
   * Each row resets `orgLevel` + `mineOnly` and conditionally touches
   * `status` (only when entering / leaving the archived view).
   */
  const VIEW_TO_OVERRIDES: Record<
    FilterToggleValue,
    { orgLevel: NavigateOverrides['orgLevel']; mineOnly: NavigateOverrides['mineOnly'] }
  > = {
    all: { orgLevel: undefined, mineOnly: undefined },
    mine: { orgLevel: undefined, mineOnly: 'true' },
    team: { orgLevel: 'team', mineOnly: undefined },
    department: { orgLevel: 'department', mineOnly: undefined },
    company: { orgLevel: 'company', mineOnly: undefined },
    archived: { orgLevel: undefined, mineOnly: undefined },
  };

  function handleViewChange(view: FilterToggleValue): void {
    const base = VIEW_TO_OVERRIDES[view];
    const overrides: NavigateOverrides = {
      orgLevel: base.orgLevel,
      mineOnly: base.mineOnly,
    };
    // Status touches only at the archived boundary — preserve the user's
    // dropdown selection otherwise.
    if (view === 'archived') overrides.status = 'archived';
    else if (status === 'archived') overrides.status = undefined;
    onnavigate(overrides);
  }

  function handleStatusSelect(value: string): void {
    closeAllDropdowns();
    onnavigate({ status: value === '' ? undefined : (value as StatusUrlValue) });
  }

  /**
   * Category-dropdown click handler. The dropdown emits `source:id` strings
   * that map to one of the two backend params (mutex). Selecting "Alle
   * Kategorien" clears both.
   */
  function handleCategorySelect(source: 'global' | 'custom' | null, id: number | null): void {
    closeAllDropdowns();
    if (source === null) {
      onnavigate({ categoryId: undefined, customCategoryId: undefined });
      return;
    }
    if (source === 'global') {
      onnavigate({ categoryId: id ?? undefined, customCategoryId: undefined });
      return;
    }
    onnavigate({ categoryId: undefined, customCategoryId: id ?? undefined });
  }

  function handleTeamSelect(value: number | null): void {
    closeAllDropdowns();
    onnavigate({ teamId: value ?? undefined });
  }

  /**
   * Search debounce mirrors the `manage-assets` reference impl
   * (300 ms). `keepFocus: true` is set in the parent's `goto()` call so the
   * input keeps focus across the SSR load.
   */
  const debouncedSearchNavigate = debounce((term: unknown) => {
    onnavigate({ search: term as string });
  }, 300);

  function handleSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    debouncedSearchNavigate(target.value);
  }

  // Capture-phase click-outside: works inside modals (bypasses stopPropagation).
  $effect(() => onClickOutsideDropdown(closeAllDropdowns));
</script>

<div class="card mb-6">
  <div class="card__header">
    <h3 class="card__title">
      <i class="fas fa-filter mr-2"></i>
      Filter & Anzeige
    </h3>
    <div class="kvp-filter-row mt-6">
      <!-- Ansichts-Filter -->
      <div class="form-field">
        <span class="form-field__label">Ansicht</span>
        <div
          class="toggle-group mt-2"
          id="kvpFilter"
        >
          {#each filterOptions as option (option.value)}
            <button
              type="button"
              class="toggle-group__btn"
              class:active={currentView === option.value}
              data-value={option.value}
              onclick={() => {
                handleViewChange(option.value);
              }}
              title={option.title}
            >
              <i class="fas {option.icon}"></i>
              {option.label}
            </button>
          {/each}
        </div>
      </div>

      <!-- Status Filter -->
      <div class="form-field">
        <span class="form-field__label">Status</span>
        <div
          class="dropdown mt-2"
          data-dropdown="status"
        >
          <button
            type="button"
            class="dropdown__trigger"
            class:active={activeDropdown === 'status'}
            onclick={() => {
              toggleDropdown('status');
            }}
          >
            <span>{statusDisplayText}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div
            class="dropdown__menu"
            class:active={activeDropdown === 'status'}
          >
            {#each STATUS_FILTER_OPTIONS as option (option.value)}
              <button
                type="button"
                class="dropdown__option"
                data-action="select-status"
                data-value={option.value}
                onclick={() => {
                  handleStatusSelect(option.value);
                }}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Category Filter -->
      <div class="form-field">
        <span class="form-field__label">Kategorie</span>
        <div
          class="dropdown mt-2"
          data-dropdown="category"
        >
          <button
            type="button"
            class="dropdown__trigger"
            class:active={activeDropdown === 'category'}
            onclick={() => {
              toggleDropdown('category');
            }}
          >
            <span>{categoryDisplayText}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div
            class="dropdown__menu"
            class:active={activeDropdown === 'category'}
          >
            <button
              type="button"
              class="dropdown__option"
              data-action="select-category"
              data-value=""
              onclick={() => {
                handleCategorySelect(null, null);
              }}
            >
              Alle Kategorien
            </button>
            {#each categories as category (`${category.source}:${String(category.id)}`)}
              <button
                type="button"
                class="dropdown__option"
                data-action="select-category"
                data-value={`${category.source}:${String(category.id)}`}
                onclick={() => {
                  handleCategorySelect(category.source, category.id);
                }}
              >
                {category.name}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Team Filter -->
      <div class="form-field">
        <span class="form-field__label">{labels.team}</span>
        <div
          class="dropdown mt-2"
          data-dropdown="team"
        >
          <button
            type="button"
            class="dropdown__trigger"
            class:active={activeDropdown === 'team'}
            onclick={() => {
              toggleDropdown('team');
            }}
          >
            <span>{teamDisplayText}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div
            class="dropdown__menu"
            class:active={activeDropdown === 'team'}
          >
            <button
              type="button"
              class="dropdown__option"
              onclick={() => {
                handleTeamSelect(null);
              }}
            >
              Alle {labels.team}
            </button>
            {#each userOrganizations as team (team.teamId)}
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  handleTeamSelect(team.teamId);
                }}
              >
                {team.teamName}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Suche -->
      <div class="form-field kvp-search-field">
        <span class="form-field__label">Suche</span>
        <div class="search-input mt-2">
          <i class="search-input__icon fas fa-search"></i>
          <input
            type="search"
            class="search-input__field"
            placeholder="Vorschläge durchsuchen..."
            value={search}
            oninput={handleSearchInput}
          />
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  [data-dropdown='status'] .dropdown__trigger {
    width: auto;
    min-width: 180px;
  }

  [data-dropdown='status'] .dropdown__menu {
    min-width: 180px;
    left: auto;
    right: auto;
  }

  .kvp-filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-4);
    align-items: flex-end;
  }

  .kvp-search-field {
    width: 220px;
  }

  /*
   * Align search-input height & font with sibling .dropdown__trigger in the
   * same .kvp-filter-row. Default search-input enforces a 44px touch target
   * (a11y standard) and uses a hardcoded 0.938rem font — both diverge from
   * .dropdown__trigger which derives size from --form-field-padding-y/x +
   * --form-field-font-size. Scoped override keeps the 44px default intact
   * for the ~20 other pages that use search-input outside a filter-row context.
   * Both elements already share --radius-xl + --spacing-3 horizontal padding.
   */
  .kvp-search-field :global(.search-input) {
    min-height: auto;
  }

  .kvp-search-field :global(.search-input__field) {
    padding: var(--form-field-padding-y) 0;
    font-size: var(--form-field-font-size);
  }
</style>
