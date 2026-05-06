<script lang="ts">
  /**
   * Work Orders — Employee View (Meine Aufträge)
   * @module shared/work-orders/+page
   *
   * Phase 4.7b (2026-05-06): URL-state-driven pagination. Every filter / page /
   * search interaction maps to a SvelteKit `goto()` call — no client-side
   * fetching, no `$state` shadows of the SSR list. The load function re-runs
   * on every URL change.
   *
   * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Per-Page Definition of Done"
   */
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import { MESSAGES, STATUS_FILTER_OPTIONS, PRIORITY_FILTER_OPTIONS } from './_lib/constants';
  import WorkOrderTable from './_lib/WorkOrderTable.svelte';

  import type { PageData } from './$types';

  // =============================================================================
  // SSR DATA — single source of truth, no `$state` shadows of the list
  // =============================================================================

  const { data }: { data: PageData } = $props();

  const permissionDenied = $derived(data.permissionDenied);
  const workOrders = $derived(data.workOrders);
  const pagination = $derived(data.pagination);
  const stats = $derived(data.stats);
  const urlState = $derived(data.urlState);
  const hasWorkOrders = $derived(workOrders.length > 0);

  // =============================================================================
  // URL NAVIGATION — every interaction maps to goto()
  // =============================================================================

  const BASE_PATH = '/work-orders';

  /**
   * Build the next URL by spreading current URL state and applying overrides.
   * Filter / search changes always reset to page 1 (per Per-Page DoD §4
   * "Filter ... re-fetches and resets to page 1").
   */
  function navigate(updates: Record<string, string>): void {
    void goto(
      resolve(
        buildPaginatedHref(BASE_PATH, {
          page: 1,
          search: urlState.search,
          status: urlState.status,
          priority: urlState.priority,
          ...updates,
        }),
      ),
      { keepFocus: true, noScroll: true },
    );
  }

  /** Anchor href for a specific page number — used by anchor pagination. */
  function pageHref(page: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page,
        search: urlState.search,
        status: urlState.status,
        priority: urlState.priority,
      }),
    );
  }

  // =============================================================================
  // SEARCH INPUT — debounced URL update
  // =============================================================================

  // Writable $derived (Svelte 5.21+) — re-derives from URL state on navigation,
  // can be locally reassigned during typing. The debounced navigate() call
  // updates the URL; on the next load() roundtrip, urlState.search matches the
  // typed value and the derivation is a no-op. Replaces the $state + $effect
  // mirror pattern (svelte/prefer-writable-derived).
  let searchInput = $derived(urlState.search);

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  function handleSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    searchInput = target.value;
    if (searchDebounce !== null) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      navigate({ search: searchInput.trim() });
    }, 300);
  }

  function handleSearchSubmit(event: SubmitEvent): void {
    event.preventDefault();
    if (searchDebounce !== null) clearTimeout(searchDebounce);
    navigate({ search: searchInput.trim() });
  }
</script>

<svelte:head>
  <title>{MESSAGES.PAGE_TITLE_EMPLOYEE}</title>
</svelte:head>

{#if permissionDenied}
  <PermissionDenied addonName="die Arbeitsaufträge" />
{:else}
  <div class="container">
    <!-- Header -->
    <div class="card mb-6">
      <div class="card__header">
        <h2 class="card__title">
          <i class="fas fa-clipboard-check mr-2"></i>
          {MESSAGES.HEADING_EMPLOYEE}
        </h2>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="stats-grid mb-6">
      <div class="card-stat card-stat--sm">
        <div class="card-stat__icon"><i class="fas fa-circle"></i></div>
        <span class="card-stat__value">{stats.open}</span>
        <span class="card-stat__label">{MESSAGES.STAT_OPEN}</span>
      </div>
      <div class="card-stat card-stat--sm">
        <div class="card-stat__icon"><i class="fas fa-spinner"></i></div>
        <span class="card-stat__value">{stats.inProgress}</span>
        <span class="card-stat__label">{MESSAGES.STAT_IN_PROGRESS}</span>
      </div>
      <div class="card-stat card-stat--sm">
        <div class="card-stat__icon"><i class="fas fa-check-circle"></i></div>
        <span class="card-stat__value">{stats.completed}</span>
        <span class="card-stat__label">{MESSAGES.STAT_COMPLETED}</span>
      </div>
      <div class="card-stat card-stat--sm">
        <div class="card-stat__icon"><i class="fas fa-check-double"></i></div>
        <span class="card-stat__value">{stats.verified}</span>
        <span class="card-stat__label">{MESSAGES.STAT_VERIFIED}</span>
      </div>
      <div class="card-stat card-stat--sm">
        <div class="card-stat__icon">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <span class="card-stat__value">{stats.overdue}</span>
        <span class="card-stat__label">{MESSAGES.STAT_OVERDUE}</span>
      </div>
      <div class="card-stat card-stat--sm">
        <div class="card-stat__icon"><i class="fas fa-list"></i></div>
        <span class="card-stat__value">{stats.total}</span>
        <span class="card-stat__label">{MESSAGES.STAT_TOTAL}</span>
      </div>
    </div>

    <!-- Filter Bar + Table -->
    <div class="card">
      <div class="card__header">
        <div class="filter-bar">
          <!-- Search input (Phase 4.7b: backend has supported ?search= since 1.2.0) -->
          <form
            class="search-form"
            onsubmit={handleSearchSubmit}
            role="search"
          >
            <label
              class="search-input"
              for="work-orders-search-employee"
            >
              <i
                class="fas fa-search search-input__icon"
                aria-hidden="true"
              ></i>
              <input
                id="work-orders-search-employee"
                type="search"
                class="search-input__field"
                placeholder="Auftrag suchen ..."
                value={searchInput}
                oninput={handleSearchInput}
                aria-label="Arbeitsaufträge durchsuchen"
              />
            </label>
          </form>

          <!-- Status filter -->
          <div class="toggle-group">
            {#each STATUS_FILTER_OPTIONS as opt (opt.value)}
              <button
                type="button"
                class="toggle-group__btn"
                class:active={urlState.status === opt.value}
                onclick={() => {
                  navigate({ status: opt.value });
                }}
              >
                {opt.label}
              </button>
            {/each}
          </div>

          <!-- Priority filter -->
          <div class="toggle-group">
            {#each PRIORITY_FILTER_OPTIONS as opt (opt.value)}
              <button
                type="button"
                class="toggle-group__btn"
                class:active={urlState.priority === opt.value}
                onclick={() => {
                  navigate({ priority: opt.value });
                }}
              >
                {opt.label}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <div class="card__body">
        {#if !hasWorkOrders}
          <div class="empty-state empty-state--in-card">
            <div class="empty-state__icon">
              <i class="fas fa-clipboard-check"></i>
            </div>
            <h3 class="empty-state__title">{MESSAGES.EMPTY_TITLE}</h3>
            <p class="empty-state__description">
              {MESSAGES.EMPTY_DESCRIPTION_EMPLOYEE}
            </p>
          </div>
        {:else}
          <WorkOrderTable items={workOrders} />

          <!-- Pagination — anchor links per Per-Page DoD §4 -->
          {#if pagination.totalPages > 1}
            <nav
              class="pagination mt-6"
              aria-label="Seitennavigation"
            >
              {#if pagination.hasPrev}
                <a
                  href={pageHref(pagination.page - 1)}
                  class="pagination__btn pagination__btn--prev"
                  rel="prev"
                >
                  <i class="fas fa-chevron-left"></i>
                  Zurück
                </a>
              {:else}
                <button
                  type="button"
                  class="pagination__btn pagination__btn--prev"
                  disabled
                >
                  <i class="fas fa-chevron-left"></i>
                  Zurück
                </button>
              {/if}

              <div class="pagination__pages">
                {#each Array.from({ length: pagination.totalPages }, (_: unknown, i: number) => i + 1) as page (page)}
                  <a
                    href={pageHref(page)}
                    class="pagination__page"
                    class:pagination__page--active={page === pagination.page}
                    aria-current={page === pagination.page ? 'page' : undefined}
                  >
                    {page}
                  </a>
                {/each}
              </div>

              {#if pagination.hasNext}
                <a
                  href={pageHref(pagination.page + 1)}
                  class="pagination__btn pagination__btn--next"
                  rel="next"
                >
                  Weiter
                  <i class="fas fa-chevron-right"></i>
                </a>
              {:else}
                <button
                  type="button"
                  class="pagination__btn pagination__btn--next"
                  disabled
                >
                  Weiter
                  <i class="fas fa-chevron-right"></i>
                </button>
              {/if}
            </nav>
            <span class="pagination__info mt-2">
              {MESSAGES.PAGINATION_SHOWING}
              {workOrders.length}
              {MESSAGES.PAGINATION_OF}
              {pagination.total}
              {MESSAGES.PAGINATION_ENTRIES}
            </span>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.75rem;
  }

  @media (width <= 768px) {
    .stats-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (width <= 480px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .filter-bar {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .search-form {
    flex: 1 1 240px;
    min-width: 200px;
    max-width: 360px;
  }
</style>
