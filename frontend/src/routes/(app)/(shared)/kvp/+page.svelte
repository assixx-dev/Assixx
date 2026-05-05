<script lang="ts">
  /**
   * KVP (Suggestions) — Page Component (Phase 4.5b URL-driven state)
   * @module kvp/+page
   *
   * Mirrors the §4.1b `manage-employees` and §4.4b `manage-assets` reference
   * impls per FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.5b. URL holds
   * pagination + search + every filter — there is NO `$state` shadow of
   * these. Mutations call `invalidateAll()` to retrigger the load on the
   * same URL, so all filter params are preserved across mutations.
   *
   * `kvpState` is now read-only for `currentUser`, `categories`,
   * `departments`, `statistics`, and modal/photo UI flags. The suggestions
   * list is consumed directly from `data.suggestions` (no kvpState mirror).
   * Filter state lives in the URL and is read from `data.*` props.
   */
  import { untrack } from 'svelte';

  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { notificationStore } from '$lib/stores/notification.store.svelte';
  import { showErrorAlert } from '$lib/utils';
  import { getApiClient } from '$lib/utils/api-client';
  import { createLogger } from '$lib/utils/logger';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import KvpCreateModal from './_lib/KvpCreateModal.svelte';
  import KvpFilterBar from './_lib/KvpFilterBar.svelte';
  import KvpSuggestionCard from './_lib/KvpSuggestionCard.svelte';
  import { kvpState } from './_lib/state.svelte';

  import type { PageData } from './$types';
  import type { CurrentUser } from './_lib/types';

  const log = createLogger('KvpPage');
  void log;
  const apiClient = getApiClient();

  // =============================================================================
  // SSR DATA — URL is the single source of truth for pagination + filter state.
  // FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.5b: there is NO client `$state`
  // shadow of these — every change goes through `goto()` → load re-run.
  // =============================================================================

  const { data }: { data: PageData } = $props();

  // Hierarchy labels from layout data inheritance
  const labels = $derived(data.hierarchyLabels);

  // SSR data via $derived — updates when invalidateAll() / goto() reruns load.
  // `suggestions` already represents the current page slice (server-paginated).
  const suggestions = $derived(data.suggestions);
  const pagination = $derived(data.pagination);
  const ssrCategories = $derived(data.categories);
  const ssrDepartments = $derived(data.departments);
  const ssrStatistics = $derived(data.statistics);
  const ssrCurrentUser = $derived<CurrentUser | null>(data.currentUser);
  const ssrUserOrganizations = $derived(data.userOrganizations);
  const permissionDenied = $derived(data.permissionDenied);
  const showStats = $derived(data.showStats);

  // Hard-Gate flag (ADR-037 Amendment 2026-04-26 + Masterplan §3.4 v0.6.0):
  // when no KVP master is reachable for the user's org scope, the backend
  // refuses POST /kvp. Disable the create button instead of letting the user
  // open the modal and hit a 400 after filling it in.
  const canCreateKvp = $derived(data.approvalConfig.hasConfigForUser);
  // Admin/root see a direct link to /settings/approvals in the no-master
  // banner so the fix path is one click away. Employees and leads see the
  // warning but no link — they can't self-service this.
  const isAdminOrRoot = $derived(
    ssrCurrentUser?.role === 'admin' || ssrCurrentUser?.role === 'root',
  );
  // Master display names, pre-resolved server-side (handles nullable
  // first_name/last_name + email fallback). Joined with comma when multiple
  // masters cover the user's scope. Empty when no master is reachable —
  // info banner is mutually exclusive with the warning banner via
  // canCreateKvp gate. The server-load fallback (+page.server.ts) already
  // guarantees masters: [] on null fetch, so no runtime nullish guard needed.
  const masters = $derived(data.approvalConfig.masters);
  const masterNames = $derived(masters.map((m) => m.displayName).join(', '));

  // Sync read-only SSR data to the state store. The suggestions list is no
  // longer mirrored here (Phase 4.5b) — the page reads it directly from
  // `data.suggestions` above. Filters likewise live in the URL, not in
  // `kvpState`. We still seed user/categories/departments/statistics so the
  // create-modal + KvpFilterBar dropdowns continue to work.
  // IMPORTANT: Use untrack to prevent infinite loop — setUser calls
  // updateEffectiveRole which reads $state, creating a circular dependency.
  $effect(() => {
    const user = ssrCurrentUser;
    const cats = ssrCategories;
    const deps = ssrDepartments;
    const stats = ssrStatistics;

    untrack(() => {
      if (user !== null) {
        kvpState.setUser(user);
      }
      kvpState.setCategories(cats);
      kvpState.setDepartments(deps);
      if (stats !== null) {
        kvpState.setStatistics(stats);
      }
      kvpState.setLoading(false);
    });
  });

  // ==========================================================================
  // URL HELPERS — single source of truth for page / search / every filter.
  // `buildPaginatedHref` skips defaults (page=1 / search='' / null / 'all'),
  // so canonical first-page URLs stay clean (`/kvp`).
  // ==========================================================================

  const BASE_PATH = '/kvp';

  /**
   * Snapshot of all current filter values needed to build a sibling href.
   * Centralised so `pageHref` and `navigateFilters` stay in sync — change
   * the URL contract here once instead of in two places.
   */
  function currentFilterSnapshot(): Record<string, unknown> {
    return {
      search: data.search,
      status: data.status === 'all' ? undefined : data.status,
      orgLevel: data.orgLevel === 'all' ? undefined : data.orgLevel,
      categoryId: data.categoryId ?? undefined,
      customCategoryId: data.customCategoryId ?? undefined,
      teamId: data.teamId ?? undefined,
      mineOnly: data.mineOnly ? 'true' : undefined,
    };
  }

  /**
   * Build an href for a target page, preserving every active filter.
   * `buildPaginatedHref` skips defaults (page=1 / search='' / undefined),
   * so canonical first-page URLs stay clean.
   */
  function pageHref(targetPage: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page: targetPage,
        ...currentFilterSnapshot(),
      }),
    );
  }

  /**
   * Filter overrides applied on top of the current URL snapshot. Each key
   * mirrors a backend query param verbatim (§D5 — no FE-side aliasing).
   * Each value is either the URL-emittable form or `undefined` to clear the
   * filter. Callers handle their own sentinel mapping (e.g. `'all'` → clear)
   * so this module never branches on it — keeps `navigateFilters` trivial
   * and complies with the `complexity` / `cognitive-complexity` budgets.
   */
  interface FilterOverrides {
    search?: string;
    status?: PageData['status'] | undefined;
    orgLevel?: PageData['orgLevel'] | undefined;
    categoryId?: number | undefined;
    customCategoryId?: number | undefined;
    teamId?: number | undefined;
    mineOnly?: 'true' | undefined;
  }

  /**
   * Navigate to a new filter combination. Page resets to 1 (default — not
   * emitted into the URL). Each unspecified key inherits the current URL
   * value via spread merge; explicit `undefined` clears the filter.
   * `keepFocus: true` preserves the search input cursor on debounced
   * navigation.
   */
  function navigateFilters(overrides: FilterOverrides): void {
    const merged: Record<string, unknown> = {
      ...currentFilterSnapshot(),
      ...overrides,
    };
    void goto(resolve(buildPaginatedHref(BASE_PATH, merged)), { keepFocus: true });
  }

  // ==========================================================================
  // SUGGESTION ACTIONS
  // ==========================================================================

  function viewSuggestion(uuid: string, isConfirmed: boolean) {
    if (!isConfirmed) {
      void apiClient.post(`/kvp/${uuid}/confirm`, {}).then(() => {
        notificationStore.decrementCount('kvp');
      });
    }
    void goto(resolve(`/kvp-detail?uuid=${uuid}`));
  }

  // ==========================================================================
  // CREATE MODAL
  // ==========================================================================

  function handleOpenCreateModal() {
    const user = kvpState.currentUser;
    if (user === null) return;

    if (ssrUserOrganizations.length === 0) {
      showErrorAlert(
        'Sie wurden keinem Team zugeordnet. Bitte wenden Sie sich an Ihren Administrator.',
      );
      return;
    }

    kvpState.openCreateModal();
  }

  function handleCloseCreateModal(): void {
    kvpState.closeCreateModal();
  }

  /**
   * Retrigger SSR load on the SAME URL — preserves every active filter and
   * the current `?page=N`. Mirror of the §4.4b `manage-assets` mutation
   * pattern.
   */
  async function handleModalSuccess(): Promise<void> {
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>KVP System - Assixx</title>
</svelte:head>

{#if permissionDenied}
  <PermissionDenied addonName="das KVP-Modul" />
{:else}
  <div class="container">
    <!-- Hard-Gate banner (ADR-037 Amendment 2026-04-26): mutually exclusive.
         No master in scope → warning + admin deep-link to /settings/approvals.
         Master(s) present → info banner with display names so the employee
         knows who their suggestion will be routed to. -->
    {#if !canCreateKvp}
      <div class="alert alert--warning mb-4">
        <i class="fas fa-exclamation-triangle"></i>
        Für deinen Bereich ist kein KVP-Master konfiguriert.
        {#if isAdminOrRoot}
          <a href={resolve('/settings/approvals')}>Jetzt einrichten →</a>
        {/if}
      </div>
    {:else if masters.length > 0}
      <div class="alert alert--info mb-4">
        <i class="fas fa-info-circle"></i>
        {masters.length === 1 ? 'Dein KVP-Master:' : 'Deine KVP-Master:'}
        {masterNames}
      </div>
    {/if}

    <!-- Statistics Overview (Admin, Root, Team Lead) -->
    {#if showStats}
      <div class="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div class="card-stat">
          <div class="card-stat__icon">
            <i class="fas fa-lightbulb"></i>
          </div>
          <div class="card-stat__content">
            <div class="card-stat__value">{kvpState.formattedStats.total}</div>
            <div class="card-stat__label">Gesamt Vorschläge</div>
          </div>
        </div>
        <div class="card-stat">
          <div class="card-stat__icon">
            <i class="fas fa-hourglass-half"></i>
          </div>
          <div class="card-stat__content">
            <div class="card-stat__value">
              {kvpState.formattedStats.inReview}
            </div>
            <div class="card-stat__label">In Bearbeitung</div>
          </div>
        </div>
        <div class="card-stat card-stat--success">
          <div class="card-stat__icon">
            <i class="fas fa-thumbs-up"></i>
          </div>
          <div class="card-stat__content">
            <div class="card-stat__value">
              {kvpState.formattedStats.approved}
            </div>
            <div class="card-stat__label">Genehmigt</div>
          </div>
        </div>
        <div class="card-stat">
          <div class="card-stat__icon">
            <i class="fas fa-check-circle"></i>
          </div>
          <div class="card-stat__content">
            <div class="card-stat__value">
              {kvpState.formattedStats.implemented}
            </div>
            <div class="card-stat__label">Umgesetzt</div>
          </div>
        </div>
        <div class="card-stat">
          <div class="card-stat__icon">
            <i class="fas fa-users"></i>
          </div>
          <div class="card-stat__content">
            <div class="card-stat__value">
              {kvpState.formattedStats.teamTotal > 0 ?
                `${kvpState.formattedStats.teamTotal} / ${kvpState.formattedStats.total}`
              : 'Kontaktieren Sie Ihren Teamleiter'}
            </div>
            <div class="card-stat__label">Team / Gesamt</div>
          </div>
        </div>
        <div
          class="card-stat"
          class:card-stat--success={kvpState.formattedStats.implementationRate >= 50}
          class:card-stat--warning={kvpState.formattedStats.implementationRate >= 25 &&
            kvpState.formattedStats.implementationRate < 50}
          class:card-stat--danger={kvpState.formattedStats.implementationRate > 0 &&
            kvpState.formattedStats.implementationRate < 25}
        >
          <div class="card-stat__icon">
            <i class="fas fa-chart-line"></i>
          </div>
          <div class="card-stat__content">
            <div class="card-stat__value">
              {kvpState.formattedStats.teamTotal > 0 ?
                `${kvpState.formattedStats.implementationRate}%`
              : 'Kontaktieren Sie Ihren Teamleiter'}
            </div>
            <div class="card-stat__label">Umsetzungsrate Team</div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Main Card -->
    <div class="card">
      <div class="card__header flex items-center justify-between">
        <div>
          <h2 class="card-title">KVP-Vorschläge</h2>
          <p class="text-secondary">
            Kontinuierlicher Verbesserungsprozess - Ihre Ideen für bessere Ablaeufe
          </p>
        </div>
      </div>

      <div class="card-body">
        <!-- Filter Bar — every value comes from URL state via `data.*` props.
             Callbacks emit `navigateFilters(...)` which goto()s the new URL
             and triggers the SSR load. -->
        <KvpFilterBar
          userOrganizations={ssrUserOrganizations}
          categories={ssrCategories}
          {labels}
          search={data.search}
          status={data.status}
          orgLevel={data.orgLevel}
          categoryId={data.categoryId}
          customCategoryId={data.customCategoryId}
          teamId={data.teamId}
          mineOnly={data.mineOnly}
          onnavigate={navigateFilters}
        />

        <!-- Suggestions Grid -->
        {#if suggestions.length === 0}
          <div class="empty-state">
            <div class="empty-state__icon">
              <i class="fas fa-inbox"></i>
            </div>
            <h3 class="empty-state__title">Keine Vorschläge gefunden</h3>
            <p class="empty-state__description">
              Ändern Sie Ihre Filter oder erstellen Sie einen neuen Vorschlag
            </p>
          </div>
        {:else}
          <div
            class="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[repeat(auto-fill,minmax(350px,1fr))]"
          >
            {#each suggestions as suggestion (suggestion.id)}
              <KvpSuggestionCard
                {suggestion}
                {labels}
                onclick={() => {
                  viewSuggestion(suggestion.uuid, suggestion.isConfirmed === true);
                }}
              />
            {/each}
          </div>
        {/if}

        <!-- Pagination — URL-driven, anchor-based for native back/forward + right-click support -->
        {#if pagination.totalPages > 1}
          <nav
            class="pagination"
            id="kvp-pagination"
            aria-label="Seitennavigation"
          >
            {#if pagination.hasPrev}
              <a
                class="pagination__btn pagination__btn--prev"
                href={pageHref(pagination.page - 1)}
                rel="prev"
              >
                <i class="fas fa-chevron-left"></i> Zurück
              </a>
            {:else}
              <button
                type="button"
                class="pagination__btn pagination__btn--prev"
                disabled
              >
                <i class="fas fa-chevron-left"></i> Zurück
              </button>
            {/if}

            <div class="pagination__pages">
              {#each Array.from({ length: pagination.totalPages }, (_: unknown, i: number) => i + 1) as page (page)}
                {#if page === pagination.page}
                  <span
                    class="pagination__page pagination__page--active"
                    aria-current="page"
                  >
                    {page}
                  </span>
                {:else}
                  <a
                    class="pagination__page"
                    href={pageHref(page)}
                  >
                    {page}
                  </a>
                {/if}
              {/each}
            </div>

            <span class="pagination__info">
              Seite {pagination.page} von {pagination.totalPages} ({pagination.total} Einträge)
            </span>

            {#if pagination.hasNext}
              <a
                class="pagination__btn pagination__btn--next"
                href={pageHref(pagination.page + 1)}
                rel="next"
              >
                Weiter <i class="fas fa-chevron-right"></i>
              </a>
            {:else}
              <button
                type="button"
                class="pagination__btn pagination__btn--next"
                disabled
              >
                Weiter <i class="fas fa-chevron-right"></i>
              </button>
            {/if}
          </nav>
        {/if}
      </div>
    </div>
  </div>

  <!-- Floating Add Button -->
  <button
    type="button"
    class="btn-float"
    aria-label={canCreateKvp ?
      'Neuen Vorschlag erstellen'
    : 'Für deinen Bereich ist kein KVP-Master konfiguriert'}
    title={canCreateKvp ?
      'Neuen Vorschlag erstellen'
    : 'Kein KVP-Master für deinen Bereich konfiguriert. Bitte wende dich an deinen Administrator.'}
    disabled={!canCreateKvp}
    onclick={handleOpenCreateModal}
  >
    <i class="fas fa-plus"></i>
  </button>

  <!-- Create KVP Modal -->
  {#if kvpState.showCreateModal}
    <KvpCreateModal
      onclose={handleCloseCreateModal}
      onsuccess={handleModalSuccess}
      hierarchyLabels={labels}
    />
  {/if}
{/if}
