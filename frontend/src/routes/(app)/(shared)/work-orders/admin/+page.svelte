<script lang="ts">
  /**
   * Work Orders (Admin) — Alle Aufträge
   * @module shared/work-orders/admin/+page
   *
   * Phase 4.7b (2026-05-06): URL-state-driven pagination. Filter / page / search
   * interactions map to `goto()`. Mutations (create, edit, archive, restore,
   * assign) call `invalidateAll()` after success — SvelteKit re-runs the load
   * on the SAME URL so the user stays on the page they were viewing.
   *
   * Adds the search input (was missing pre-Phase-4.7b — backend has supported
   * `?search=` since changelog 1.2.0).
   *
   * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Per-Page Definition of Done"
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { showSuccessAlert, showErrorAlert } from '$lib/stores/toast';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import ConfirmModal from '$design-system/components/confirm-modal/ConfirmModal.svelte';

  import {
    createWorkOrder,
    updateWorkOrder,
    archiveWorkOrder,
    restoreWorkOrder,
    assignUsers,
    uploadPhoto,
    logApiError,
  } from '../_lib/api';
  import { MESSAGES, STATUS_FILTER_OPTIONS, PRIORITY_FILTER_OPTIONS } from '../_lib/constants';

  import AdminWorkOrderTable from './_lib/AdminWorkOrderTable.svelte';
  import AssignUserModal from './_lib/AssignUserModal.svelte';
  import EditWorkOrderModal from './_lib/EditWorkOrderModal.svelte';

  import type { PageData } from './$types';
  import type {
    CreateWorkOrderPayload,
    UpdateWorkOrderPayload,
    WorkOrderListItem,
  } from '../_lib/types';

  // =============================================================================
  // SSR DATA — single source of truth, no `$state` shadows of the list
  // =============================================================================

  const { data }: { data: PageData } = $props();

  const permissionDenied = $derived(data.permissionDenied);
  const workOrders = $derived(data.workOrders);
  const pagination = $derived(data.pagination);
  const stats = $derived(data.stats);
  const eligibleUsers = $derived(data.eligibleUsers);
  const urlState = $derived(data.urlState);
  const hasWorkOrders = $derived(workOrders.length > 0);

  // =============================================================================
  // URL NAVIGATION — every interaction maps to goto()
  // =============================================================================

  const BASE_PATH = '/work-orders/admin';

  function navigate(updates: Record<string, string>): void {
    const next: Record<string, unknown> = {
      page: 1,
      search: urlState.search,
      status: urlState.status,
      priority: urlState.priority,
      isActive: urlState.isActive === 'active' ? '' : urlState.isActive,
      overdue: urlState.overdue ? 'true' : '',
      ...updates,
    };
    void goto(resolve(buildPaginatedHref(BASE_PATH, next)), {
      keepFocus: true,
      noScroll: true,
    });
  }

  function pageHref(page: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page,
        search: urlState.search,
        status: urlState.status,
        priority: urlState.priority,
        isActive: urlState.isActive === 'active' ? '' : urlState.isActive,
        overdue: urlState.overdue ? 'true' : '',
      }),
    );
  }

  // =============================================================================
  // SEARCH INPUT — debounced URL update (Beta-correctness gap closure)
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

  // =============================================================================
  // MODAL STATE
  // =============================================================================

  let showEditModal = $state(false);
  let showAssignModal = $state(false);
  let showArchiveConfirm = $state(false);
  let editingItem = $state<WorkOrderListItem | null>(null);
  let assigningItem = $state<WorkOrderListItem | null>(null);
  let archivingItem = $state<WorkOrderListItem | null>(null);
  let submitting = $state(false);
  let pendingFiles = $state<File[] | null>(null);

  function openCreateModal(): void {
    editingItem = null;
    showEditModal = true;
  }

  function openEditModal(item: WorkOrderListItem): void {
    editingItem = item;
    showEditModal = true;
  }

  function openAssignModal(item: WorkOrderListItem): void {
    assigningItem = item;
    showAssignModal = true;
  }

  function openArchiveConfirm(item: WorkOrderListItem): void {
    archivingItem = item;
    showArchiveConfirm = true;
  }

  function closeAllModals(): void {
    showEditModal = false;
    showAssignModal = false;
    showArchiveConfirm = false;
    editingItem = null;
    assigningItem = null;
    archivingItem = null;
    pendingFiles = null;
  }

  // =============================================================================
  // MUTATION HANDLERS — all end with invalidateAll() to re-run the SSR load
  // on the SAME URL (preserves page/filter/search position).
  // =============================================================================

  async function uploadPendingFiles(woUuid: string): Promise<void> {
    if (pendingFiles === null || pendingFiles.length === 0) return;
    for (const file of pendingFiles) {
      try {
        await uploadPhoto(woUuid, file);
      } catch (err: unknown) {
        logApiError('uploadPhoto', err);
        showErrorAlert(`Fehler beim Hochladen von ${file.name}`);
      }
    }
  }

  async function handleSaveWorkOrder(
    payload: CreateWorkOrderPayload | UpdateWorkOrderPayload,
  ): Promise<void> {
    submitting = true;
    try {
      let woUuid: string;
      if (editingItem !== null) {
        await updateWorkOrder(editingItem.uuid, payload);
        woUuid = editingItem.uuid;
        showSuccessAlert(MESSAGES.SUCCESS_UPDATED);
      } else {
        const created = await createWorkOrder(payload as CreateWorkOrderPayload);
        woUuid = created.uuid;
        showSuccessAlert(MESSAGES.SUCCESS_CREATED);
      }
      await uploadPendingFiles(woUuid);
      closeAllModals();
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('saveWorkOrder', err);
      showErrorAlert(editingItem !== null ? MESSAGES.ERROR_UPDATE : MESSAGES.ERROR_CREATE);
    } finally {
      submitting = false;
    }
  }

  async function handleAssignUsers(userUuids: string[]): Promise<void> {
    if (assigningItem === null) return;
    submitting = true;
    try {
      await assignUsers(assigningItem.uuid, { userUuids });
      showSuccessAlert(MESSAGES.ASSIGNEES_SUCCESS_ADD);
      closeAllModals();
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('assignUsers', err);
      showErrorAlert(MESSAGES.ASSIGNEES_ERROR_ADD);
    } finally {
      submitting = false;
    }
  }

  async function handleArchive(): Promise<void> {
    if (archivingItem === null) return;
    submitting = true;
    try {
      await archiveWorkOrder(archivingItem.uuid);
      showSuccessAlert(MESSAGES.ARCHIVE_SUCCESS);
      closeAllModals();
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('archiveWorkOrder', err);
      showErrorAlert(MESSAGES.ARCHIVE_ERROR);
    } finally {
      submitting = false;
    }
  }

  async function handleRestore(item: WorkOrderListItem): Promise<void> {
    submitting = true;
    try {
      await restoreWorkOrder(item.uuid);
      showSuccessAlert(MESSAGES.RESTORE_SUCCESS);
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('restoreWorkOrder', err);
      showErrorAlert(MESSAGES.RESTORE_ERROR);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{MESSAGES.PAGE_TITLE_ADMIN}</title>
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
          {MESSAGES.HEADING_ADMIN}
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
              for="work-orders-search-admin"
            >
              <i
                class="fas fa-search search-input__icon"
                aria-hidden="true"
              ></i>
              <input
                id="work-orders-search-admin"
                type="search"
                class="search-input__field"
                placeholder="Auftrag suchen ..."
                value={searchInput}
                oninput={handleSearchInput}
                aria-label="Arbeitsaufträge durchsuchen"
              />
            </label>
          </form>

          <!-- Is-Active toggle (Aktive / Archiviert / Alle) -->
          <div class="toggle-group">
            <button
              type="button"
              class="toggle-group__btn"
              class:active={urlState.isActive === 'active'}
              onclick={() => {
                navigate({ isActive: '' });
              }}
            >
              <i class="fas fa-clipboard-check"></i>
              {MESSAGES.FILTER_ACTIVE}
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={urlState.isActive === 'archived'}
              onclick={() => {
                navigate({ isActive: 'archived' });
              }}
            >
              <i class="fas fa-archive"></i>
              {MESSAGES.FILTER_ARCHIVED}
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={urlState.isActive === 'all'}
              onclick={() => {
                navigate({ isActive: 'all' });
              }}
            >
              <i class="fas fa-list"></i>
              {MESSAGES.FILTER_ALL}
            </button>
          </div>

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

          <!-- Overdue toggle (cross-cutting filter) -->
          <div class="toggle-group">
            <button
              type="button"
              class="toggle-group__btn"
              class:active={urlState.overdue}
              onclick={() => {
                navigate({ overdue: urlState.overdue ? '' : 'true' });
              }}
              aria-pressed={urlState.overdue}
            >
              <i class="fas fa-exclamation-triangle"></i>
              {MESSAGES.STAT_OVERDUE}
            </button>
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
              {MESSAGES.EMPTY_DESCRIPTION_ADMIN}
            </p>
          </div>
        {:else}
          <AdminWorkOrderTable
            items={workOrders}
            onedit={openEditModal}
            onarchive={openArchiveConfirm}
            onrestore={handleRestore}
            onassign={openAssignModal}
          />

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

  <!-- FAB: Create Work Order -->
  <button
    type="button"
    class="btn-float"
    aria-label={MESSAGES.BTN_CREATE}
    onclick={openCreateModal}
  >
    <i class="fas fa-plus"></i>
  </button>

  <!-- Edit/Create Modal -->
  <EditWorkOrderModal
    show={showEditModal}
    workOrder={editingItem}
    {eligibleUsers}
    {submitting}
    attachmentFiles={pendingFiles}
    onclose={closeAllModals}
    onsave={handleSaveWorkOrder}
    onfileschange={(files: File[] | null) => {
      pendingFiles = files;
    }}
  />

  <!-- Assign Users Modal -->
  <AssignUserModal
    show={showAssignModal}
    workOrder={assigningItem}
    {eligibleUsers}
    {submitting}
    onclose={closeAllModals}
    onsave={handleAssignUsers}
  />

  <!-- Archive Confirmation -->
  <ConfirmModal
    show={showArchiveConfirm && archivingItem !== null}
    id="work-order-archive-confirm-modal"
    title={MESSAGES.ARCHIVE_CONFIRM_TITLE}
    variant="warning"
    icon="fa-archive"
    confirmLabel={MESSAGES.BTN_ARCHIVE}
    {submitting}
    onconfirm={() => void handleArchive()}
    oncancel={() => {
      showArchiveConfirm = false;
      archivingItem = null;
    }}
  >
    {#if archivingItem !== null}
      <strong>{archivingItem.title}</strong><br />
    {/if}
    {MESSAGES.ARCHIVE_CONFIRM_TEXT}
  </ConfirmModal>
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
