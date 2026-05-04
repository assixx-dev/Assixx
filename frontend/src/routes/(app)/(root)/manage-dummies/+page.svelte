<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import { showSuccessAlert, showErrorAlert } from '$lib/utils';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import { createDummy, deleteDummy, logApiError, updateDummy } from './_lib/api';
  import { createDummyMessages } from './_lib/constants';
  import DeleteConfirmModal from './_lib/DeleteConfirmModal.svelte';
  import DummyFormModal from './_lib/DummyFormModal.svelte';
  import DummyTable from './_lib/DummyTable.svelte';
  import SearchBar from './_lib/SearchBar.svelte';
  import StatusFilterTabs from './_lib/StatusFilterTabs.svelte';

  import type { PageData } from './$types';
  import type {
    CreateDummyPayload,
    DummyFormData,
    DummyUser,
    UpdateDummyPayload,
  } from './_lib/types';

  // ============================================================================
  // SSR DATA — URL is the single source of truth for page / search / status.
  // FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §3.2: there is NO client `$state`
  // shadow copy of these — every change goes through `goto()` → load re-run.
  // ============================================================================

  const { data }: { data: PageData } = $props();

  const labels = $derived(data.hierarchyLabels);
  const messages = $derived(createDummyMessages(labels));

  const dummies = $derived(data.dummies);
  const teams = $derived(data.teams);
  const pagination = $derived(data.pagination);
  const searchTerm = $derived(data.search);
  const statusFilter = $derived(data.statusFilter);

  // ============================================================================
  // MODAL CLIENT STATE — only modal open/close + submit lock are local.
  // ============================================================================

  let showFormModal = $state(false);
  let formMode = $state<'create' | 'edit'>('create');
  let editingDummy = $state<DummyUser | null>(null);
  let submitting = $state(false);

  let showDeleteModal = $state(false);
  let deletingDummy = $state<DummyUser | null>(null);

  // ============================================================================
  // URL HELPERS
  // ============================================================================

  const BASE_PATH = '/manage-dummies';

  /**
   * Build an href for a target page, preserving current search + status.
   * Used by both numbered page links and prev/next buttons.
   * `buildPaginatedHref` skips defaults (page=1 / search='' / undefined),
   * so canonical first-page URLs are clean (`/manage-dummies` with no query).
   */
  function pageHref(targetPage: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page: targetPage,
        search: searchTerm,
        isActive: statusFilter === 'all' ? undefined : String(statusFilter),
      }),
    );
  }

  /**
   * Navigate to a new filter/search state. Page resets to 1 (the default,
   * so it's not emitted into the URL — `?page=1` would be redundant).
   */
  function navigateFilters(next: { search?: string; statusFilter?: number | 'all' }): void {
    const nextSearch = next.search ?? searchTerm;
    const nextStatus = next.statusFilter ?? statusFilter;
    const href = resolve(
      buildPaginatedHref(BASE_PATH, {
        // page omitted → resets to 1
        search: nextSearch,
        isActive: nextStatus === 'all' ? undefined : String(nextStatus),
      }),
    );
    void goto(href, { keepFocus: true });
  }

  function handleStatusFilter(value: number | 'all'): void {
    navigateFilters({ statusFilter: value });
  }

  function handleSearch(term: string): void {
    // SearchBar already debounces (300 ms) — see `_lib/SearchBar.svelte`.
    navigateFilters({ search: term });
  }

  // ============================================================================
  // MODAL HANDLERS — mutations call `invalidateAll()` to retrigger the load
  // function so the current page re-fetches with the same URL state.
  // ============================================================================

  function openCreateModal(): void {
    formMode = 'create';
    editingDummy = null;
    showFormModal = true;
  }

  function openEditModal(dummy: DummyUser): void {
    formMode = 'edit';
    editingDummy = dummy;
    showFormModal = true;
  }

  function openDeleteModal(dummy: DummyUser): void {
    deletingDummy = dummy;
    showDeleteModal = true;
  }

  function closeFormModal(): void {
    showFormModal = false;
    editingDummy = null;
  }

  function closeDeleteModal(): void {
    showDeleteModal = false;
    deletingDummy = null;
  }

  async function handleSave(formData: DummyFormData): Promise<void> {
    submitting = true;
    try {
      if (formMode === 'edit' && editingDummy !== null) {
        const payload: UpdateDummyPayload = {
          displayName: formData.displayName,
          teamIds: formData.teamIds,
          isActive: formData.isActive,
        };
        if (formData.password !== '') {
          payload.password = formData.password;
        }
        await updateDummy(editingDummy.uuid, payload);
        showSuccessAlert('Dummy-Benutzer aktualisiert');
      } else {
        const payload: CreateDummyPayload = {
          displayName: formData.displayName,
          password: formData.password,
          teamIds: formData.teamIds.length > 0 ? formData.teamIds : undefined,
        };
        await createDummy(payload);
        showSuccessAlert('Dummy-Benutzer erstellt');
      }
      closeFormModal();
      // Retrigger the SSR load on the SAME URL (preserves ?page / ?search).
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('saveDummy', err);
      showErrorAlert('Fehler beim Speichern');
    } finally {
      submitting = false;
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (deletingDummy === null) return;
    submitting = true;
    try {
      await deleteDummy(deletingDummy.uuid);
      showSuccessAlert('Dummy-Benutzer wurde gelöscht');
      closeDeleteModal();
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('deleteDummy', err);
      showErrorAlert('Fehler beim Löschen');
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{messages.PAGE_TITLE}</title>
</svelte:head>

<div class="container">
  <div class="card">
    <div class="card__header">
      <h2 class="card__title">
        <i class="fas fa-desktop mr-2"></i>
        {messages.HEADING}
      </h2>
      <p class="mt-2 text-(--color-text-secondary)">
        {messages.HEADING_SUBTITLE}
      </p>

      <div
        class="mt-6 flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between"
      >
        <StatusFilterTabs
          activeFilter={statusFilter}
          onfilter={handleStatusFilter}
        />
        <div class="max-w-80">
          <SearchBar
            value={searchTerm}
            onsearch={handleSearch}
          />
        </div>
      </div>
    </div>

    <div class="card__body">
      {#if dummies.length === 0}
        <div class="empty-state">
          <div class="empty-state__icon">
            <i class="fas fa-desktop"></i>
          </div>
          <h3 class="empty-state__title">{messages.EMPTY_TITLE}</h3>
          <p class="empty-state__description">
            {messages.EMPTY_DESCRIPTION}
          </p>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!data.tenantVerified}
            title={data.tenantVerified ? undefined : (
              'Verifiziere zuerst Deine Firmen-Domain unter /settings/company-profile/domains.'
            )}
            onclick={openCreateModal}
          >
            <i class="fas fa-plus mr-1"></i>
            Dummy-Benutzer erstellen
          </button>
        </div>
      {:else}
        <DummyTable
          {messages}
          {dummies}
          onedit={openEditModal}
          ondelete={openDeleteModal}
        />

        <!-- Pagination — URL-driven, anchor-based for native back/forward + right-click support -->
        {#if pagination.totalPages > 1}
          <nav
            class="pagination mt-6"
            aria-label="Seitennavigation"
          >
            {#if pagination.hasPrev}
              <a
                class="pagination__btn pagination__btn--prev"
                href={pageHref(pagination.page - 1)}
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

            {#if pagination.hasNext}
              <a
                class="pagination__btn pagination__btn--next"
                href={pageHref(pagination.page + 1)}
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
        {/if}
      {/if}
    </div>
  </div>
</div>

<!-- FAB: Create Dummy -->
<button
  type="button"
  class="btn-float"
  disabled={!data.tenantVerified}
  title={data.tenantVerified ?
    messages.BTN_CREATE
  : 'Verifiziere zuerst Deine Firmen-Domain unter /settings/company-profile/domains.'}
  aria-label={data.tenantVerified ?
    messages.BTN_CREATE
  : `${messages.BTN_CREATE} (deaktiviert: Domain nicht verifiziert)`}
  onclick={openCreateModal}
>
  <i class="fas fa-plus"></i>
</button>

<!-- Form Modal (Create/Edit) -->
<DummyFormModal
  show={showFormModal}
  mode={formMode}
  dummy={editingDummy}
  {teams}
  {submitting}
  onclose={closeFormModal}
  onsave={(formData: DummyFormData) => {
    void handleSave(formData);
  }}
/>

<!-- Delete Confirmation -->
<DeleteConfirmModal
  show={showDeleteModal}
  {submitting}
  oncancel={closeDeleteModal}
  onconfirm={() => {
    void handleDeleteConfirm();
  }}
/>
