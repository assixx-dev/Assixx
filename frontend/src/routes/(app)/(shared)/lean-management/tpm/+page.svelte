<script lang="ts">
  /**
   * TPM Admin Dashboard - Page Component
   * @module lean-management/tpm/+page
   *
   * Phase 4.11b (2026-05-06): URL-state-driven. Every search / page interaction
   * maps to a SvelteKit `goto()` call — no client-side fetching, no `$state`
   * shadows of the SSR list. The load function re-runs on every URL change.
   *
   * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Per-Page Definition of Done"
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { showSuccessAlert, showErrorAlert } from '$lib/stores/toast';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import ConfirmModal from '$design-system/components/confirm-modal/ConfirmModal.svelte';

  import { deletePlan as apiDeletePlan, logApiError } from './_admin/api';
  import { createTpmMessages } from './_admin/constants';
  import PlanOverview from './_admin/PlanOverview.svelte';

  import type { PageData } from './$types';
  import type { TpmPlan } from './_admin/types';

  // =============================================================================
  // SSR DATA — single source of truth, no `$state` shadows of the list
  // =============================================================================

  const { data }: { data: PageData } = $props();
  const permissionDenied = $derived(data.permissionDenied);

  // Hierarchy labels from layout data inheritance (A6)
  const labels = $derived(data.hierarchyLabels);
  const messages = $derived(createTpmMessages(labels));

  const plans = $derived(data.plans);
  const pagination = $derived(data.pagination);
  const totalPlans = $derived(pagination.total);
  const urlState = $derived(data.urlState);

  // Permission-based UI (ADR-020): employees see buttons only if they have the specific permission
  const permissions = $derived(data.permissions);
  const canWrite = $derived(permissions?.plans.canWrite === true);
  const canDelete = $derived(permissions?.plans.canDelete === true);

  // =============================================================================
  // URL NAVIGATION — every interaction maps to goto()
  // =============================================================================

  const BASE_PATH = '/lean-management/tpm';

  /** Anchor href for a specific page number — used by anchor pagination. */
  function pageHref(page: number): string {
    return resolve(buildPaginatedHref(BASE_PATH, { page, search: urlState.search }));
  }

  /** Build the next URL by spreading current URL state and applying overrides. */
  function navigate(updates: { page?: number; search?: string }): void {
    void goto(
      resolve(
        buildPaginatedHref(BASE_PATH, {
          page: updates.page ?? 1,
          search: updates.search ?? urlState.search,
        }),
      ),
      { keepFocus: true, noScroll: true },
    );
  }

  // =============================================================================
  // SEARCH — debounced URL update (300ms, mirrors work-orders pattern)
  // =============================================================================

  let searchInput = $derived(urlState.search);
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  function handleSearchChange(value: string): void {
    searchInput = value;
    if (searchDebounce !== null) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      navigate({ search: searchInput.trim() });
    }, 300);
  }

  function handleSearchSubmit(): void {
    if (searchDebounce !== null) clearTimeout(searchDebounce);
    navigate({ search: searchInput.trim() });
  }

  // =============================================================================
  // DELETE MODAL — local UI state, mutation flow uses invalidateAll
  // =============================================================================

  let showDeleteModal = $state(false);
  let deleteTarget = $state<TpmPlan | null>(null);
  let submitting = $state(false);

  function handleDeleteRequest(plan: TpmPlan): void {
    deleteTarget = plan;
    showDeleteModal = true;
  }

  function closeDeleteModal(): void {
    showDeleteModal = false;
    deleteTarget = null;
  }

  async function confirmDelete(): Promise<void> {
    if (deleteTarget === null) return;
    const targetUuid = deleteTarget.uuid;
    submitting = true;
    try {
      await apiDeletePlan(targetUuid);
      showSuccessAlert(messages.SUCCESS_DELETED);
      closeDeleteModal();
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('confirmDelete', err);
      showErrorAlert(err instanceof Error ? err.message : messages.ERROR_DELETE_FAILED);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{messages.PAGE_TITLE}</title>
</svelte:head>

{#if permissionDenied}
  <PermissionDenied addonName="das TPM-System" />
{:else}
  <div class="container">
    <!-- Stats (1 card now — active count dropped per Known Limitation #13;
         it would have counted only the loaded page (B1 dishonest UI)). -->
    <div class="grid grid-cols-1 gap-6 md:items-start">
      <div class="card-stat card-stat--sm">
        <div class="card-stat__icon">
          <i class="fas fa-clipboard-list"></i>
        </div>
        <div class="card-stat__content">
          <div class="card-stat__value">{totalPlans}</div>
          <div class="card-stat__label">{messages.STAT_TOTAL_PLANS}</div>
        </div>
      </div>
    </div>

    <!-- Plan table (full width) -->
    <div class="mt-6">
      <div class="mb-4 flex items-center justify-end gap-2">
        <a
          href={resolve('/lean-management/tpm/gesamtansicht')}
          class="btn btn-secondary"
        >
          <i class="fas fa-table mr-2"></i>
          {messages.BTN_GESAMTANSICHT}
        </a>
        {#if canWrite}
          <a
            href={resolve('/lean-management/tpm/plan/new')}
            class="btn btn-secondary"
          >
            <i class="fas fa-plus mr-2"></i>
            {messages.BTN_NEW_PLAN}
          </a>
        {/if}
      </div>
      <div class="card">
        <div class="card__header">
          <h2 class="card__title">{messages.STAT_TOTAL_PLANS}</h2>
        </div>
        <div class="card__body">
          <PlanOverview
            {messages}
            {plans}
            {pagination}
            intervalMatrix={data.intervalMatrix}
            searchValue={searchInput}
            {canDelete}
            {pageHref}
            onsearch={handleSearchChange}
            onsearchsubmit={handleSearchSubmit}
            ondelete={handleDeleteRequest}
          />
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Confirmation Modal (only for users with canDelete permission) -->
  {#if canDelete}
    <ConfirmModal
      show={showDeleteModal}
      id="tpm-plan-delete-modal"
      title={messages.DELETE_CONFIRM_TITLE}
      confirmLabel={messages.BTN_DELETE}
      {submitting}
      onconfirm={confirmDelete}
      oncancel={closeDeleteModal}
    >
      {messages.DELETE_CONFIRM_MESSAGE}
      {#if deleteTarget !== null}
        <br /><br />
        <strong>{deleteTarget.name}</strong>
      {/if}
    </ConfirmModal>
  {/if}
{/if}
