<script lang="ts">
  /**
   * TPM Card Management Page
   * @module lean-management/tpm/cards/[uuid]/+page
   *
   * The [uuid] param is the plan UUID.
   * Phase 4.11b (2026-05-06): URL-state-driven. Search input + pagination
   * block ADDED — both were absent pre-migration (cards silently truncated
   * at hardcoded `limit=50`).
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
    createCard as apiCreateCard,
    updateCard as apiUpdateCard,
    deleteCard as apiDeleteCard,
    checkDuplicate as apiCheckDuplicate,
    logApiError,
  } from '../../_admin/api';
  import { createTpmMessages } from '../../_admin/constants';

  import CardForm from './_lib/CardForm.svelte';
  import CardList from './_lib/CardList.svelte';
  import DuplicateWarning from './_lib/DuplicateWarning.svelte';

  import type { PageData } from './$types';
  import type {
    TpmCard,
    CreateCardPayload,
    UpdateCardPayload,
    CardStatus,
    IntervalType,
    CardRole,
  } from '../../_admin/types';

  type StatusFilterValue = CardStatus | '';
  type IntervalFilterValue = IntervalType | '';
  type RoleFilterValue = CardRole | '';

  // ===========================================================================
  // SSR DATA
  // ===========================================================================

  const { data }: { data: PageData } = $props();
  const permissionDenied = $derived(data.permissionDenied);

  const labels = $derived(data.hierarchyLabels);
  const messages = $derived(createTpmMessages(labels));

  const cards = $derived(data.cards);
  const pagination = $derived(data.pagination);
  const urlState = $derived(data.urlState);
  const totalCards = $derived(pagination.total);

  // ===========================================================================
  // URL NAVIGATION
  // ===========================================================================

  const basePath = $derived(`/lean-management/tpm/cards/${data.planUuid}`);

  function buildHref(updates: {
    page?: number;
    search?: string;
    status?: StatusFilterValue;
    intervalType?: IntervalFilterValue;
    cardRole?: RoleFilterValue;
  }): string {
    return resolve(
      buildPaginatedHref(basePath, {
        page: updates.page ?? 1,
        search: updates.search ?? urlState.search,
        status: updates.status ?? urlState.status,
        intervalType: updates.intervalType ?? urlState.intervalType,
        cardRole: updates.cardRole ?? urlState.cardRole,
      }),
    );
  }

  function pageHref(page: number): string {
    return resolve(
      buildPaginatedHref(basePath, {
        page,
        search: urlState.search,
        status: urlState.status,
        intervalType: urlState.intervalType,
        cardRole: urlState.cardRole,
      }),
    );
  }

  function navigate(updates: {
    page?: number;
    search?: string;
    status?: StatusFilterValue;
    intervalType?: IntervalFilterValue;
    cardRole?: RoleFilterValue;
  }): void {
    void goto(buildHref(updates), { keepFocus: true, noScroll: true });
  }

  function handleFilterChange(updates: {
    status?: StatusFilterValue;
    intervalType?: IntervalFilterValue;
    cardRole?: RoleFilterValue;
  }): void {
    navigate({ ...updates, page: 1 });
  }

  // ===========================================================================
  // SEARCH — debounced URL update (300ms, mirrors work-orders pattern)
  // ===========================================================================

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

  // ===========================================================================
  // FORM STATE — local UI state, mutations use invalidateAll
  // ===========================================================================

  let showForm = $state(false);
  let editingCard = $state<TpmCard | null>(null);
  let submitting = $state(false);

  // Delete confirmation
  let showDeleteModal = $state(false);
  let deleteTarget = $state<TpmCard | null>(null);

  // Duplicate warning
  let showDuplicateWarning = $state(false);
  let duplicateCards = $state<TpmCard[]>([]);
  let pendingPayload = $state<CreateCardPayload | null>(null);

  const isCreateMode = $derived(editingCard === null);
  const formHeading = $derived(
    isCreateMode ? messages.CARD_CREATE_TITLE : messages.CARD_EDIT_TITLE,
  );

  function openCreateForm(): void {
    editingCard = null;
    showForm = true;
  }

  function openEditForm(card: TpmCard): void {
    editingCard = card;
    showForm = true;
  }

  function closeForm(): void {
    showForm = false;
    editingCard = null;
  }

  // ===========================================================================
  // CARD CRUD
  // ===========================================================================

  async function handleCreate(payload: CreateCardPayload): Promise<void> {
    try {
      const result = await apiCheckDuplicate({
        planUuid: payload.planUuid,
        title: payload.title,
        intervalType: payload.intervalType,
      });

      if (result.hasDuplicate) {
        duplicateCards = result.existingCards;
        pendingPayload = payload;
        showDuplicateWarning = true;
        return;
      }
    } catch (err: unknown) {
      // Duplicate check failure is non-blocking — proceed with create
      logApiError('checkDuplicate', err);
    }

    await executeCreate(payload);
  }

  async function executeCreate(payload: CreateCardPayload): Promise<void> {
    submitting = true;
    try {
      await apiCreateCard(payload);
      showSuccessAlert(messages.SUCCESS_CARD_CREATED);
      closeForm();
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('createCard', err);
      const msg = err instanceof Error ? err.message : messages.ERROR_CARD_CREATE;
      showErrorAlert(msg);
    } finally {
      submitting = false;
    }
  }

  async function handleUpdate(payload: UpdateCardPayload): Promise<void> {
    if (editingCard === null) return;
    submitting = true;
    try {
      await apiUpdateCard(editingCard.uuid, payload);
      showSuccessAlert(messages.SUCCESS_CARD_UPDATED);
      closeForm();
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('updateCard', err);
      const msg = err instanceof Error ? err.message : messages.ERROR_CARD_UPDATE;
      showErrorAlert(msg);
    } finally {
      submitting = false;
    }
  }

  // ===========================================================================
  // DELETE
  // ===========================================================================

  function handleDeleteRequest(card: TpmCard): void {
    deleteTarget = card;
    showDeleteModal = true;
  }

  async function confirmDelete(): Promise<void> {
    if (deleteTarget === null) return;
    const targetUuid = deleteTarget.uuid;
    deleteTarget = null;
    showDeleteModal = false;
    submitting = true;
    try {
      await apiDeleteCard(targetUuid);
      showSuccessAlert(messages.SUCCESS_CARD_DELETED);
      await invalidateAll();
    } catch (err: unknown) {
      logApiError('deleteCard', err);
      const msg = err instanceof Error ? err.message : messages.ERROR_CARD_DELETE;
      showErrorAlert(msg);
    } finally {
      submitting = false;
    }
  }

  function cancelDelete(): void {
    showDeleteModal = false;
    deleteTarget = null;
  }

  // ===========================================================================
  // DUPLICATE WARNING
  // ===========================================================================

  async function handleDuplicateContinue(): Promise<void> {
    showDuplicateWarning = false;
    const payload = pendingPayload;
    pendingPayload = null;
    duplicateCards = [];
    if (payload !== null) {
      await executeCreate(payload);
    }
  }

  function handleDuplicateCancel(): void {
    showDuplicateWarning = false;
    pendingPayload = null;
    duplicateCards = [];
  }

  const pageRange = $derived(
    Array.from({ length: pagination.totalPages }, (_: unknown, i: number) => i + 1),
  );
</script>

<svelte:head>
  <title>{messages.CARD_PAGE_TITLE}</title>
</svelte:head>

{#if permissionDenied}
  <PermissionDenied addonName="das TPM-System" />
{:else if data.plan !== null}
  <div class="container">
    <!-- Header -->
    <div class="mb-6">
      <div class="mb-4">
        <button
          type="button"
          class="btn btn-light"
          onclick={() => {
            void goto(resolve(`/lean-management/tpm/board/${data.planUuid}`));
          }}
        >
          <i class="fas fa-arrow-left mr-2"></i>Zurück zum Board
        </button>
      </div>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-bold text-(--color-text-primary)">
            <i class="fas fa-th"></i>
            {messages.CARD_PAGE_HEADING}
          </h1>
          <p class="mt-1 text-sm text-(--color-text-secondary)">
            {data.plan.assetName ?? '—'} — {data.plan.name}
          </p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => {
              void goto(resolve(`/lean-management/tpm/board/${data.planUuid}`));
            }}
          >
            <i class="fas fa-th-large mr-2"></i>{messages.BTN_VIEW_BOARD}
          </button>
          {#if !showForm}
            <button
              type="button"
              class="btn btn-primary"
              onclick={openCreateForm}
            >
              <i class="fas fa-plus"></i>
              {messages.BTN_NEW_CARD}
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex flex-col gap-6">
      <!-- Card Form (inline panel) -->
      {#if showForm}
        <div class="card">
          <div class="card__header">
            <h2 class="card__title">{formHeading}</h2>
          </div>
          <div class="card__body">
            <CardForm
              card={editingCard}
              planUuid={data.planUuid}
              planBaseWeekday={data.plan.baseWeekday}
              locations={data.locations}
              {isCreateMode}
              {submitting}
              oncreate={handleCreate}
              onupdate={handleUpdate}
              oncancel={closeForm}
            />
          </div>
        </div>
      {/if}

      <!-- Card List -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title">
            Karten ({totalCards})
          </h2>
        </div>
        <div class="card__body">
          <!-- Search bar — Phase 4.11b: backend search supported since 1.2.0 (Phase 1.2a-B B-4) -->
          <form
            class="mb-4 max-w-md"
            role="search"
            onsubmit={handleSearchSubmit}
          >
            <label
              class="search-input"
              for="tpm-cards-search"
            >
              <i
                class="fas fa-search search-input__icon"
                aria-hidden="true"
              ></i>
              <input
                id="tpm-cards-search"
                type="search"
                class="search-input__field"
                placeholder="Karte suchen ..."
                value={searchInput}
                oninput={handleSearchInput}
                aria-label="Karten durchsuchen"
              />
            </label>
          </form>

          <CardList
            {cards}
            {totalCards}
            statusFilter={urlState.status}
            intervalFilter={urlState.intervalType}
            roleFilter={urlState.cardRole}
            onfilterchange={handleFilterChange}
            onedit={openEditForm}
            ondelete={handleDeleteRequest}
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
                {#each pageRange as page (page)}
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
              Zeige {cards.length} von {pagination.total} Karten
            </span>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Confirmation Modal -->
  <ConfirmModal
    show={showDeleteModal && deleteTarget !== null}
    id="tpm-card-delete-modal"
    title={messages.CARD_DELETE_TITLE}
    confirmLabel={messages.BTN_DELETE}
    {submitting}
    onconfirm={confirmDelete}
    oncancel={cancelDelete}
  >
    {messages.CARD_DELETE_MESSAGE}
    {#if deleteTarget !== null}
      <br /><br />
      <strong>{deleteTarget.cardCode}</strong> — {deleteTarget.title}
    {/if}
  </ConfirmModal>

  <!-- Duplicate Warning Modal -->
  {#if showDuplicateWarning}
    <DuplicateWarning
      {messages}
      existingCards={duplicateCards}
      oncontinue={handleDuplicateContinue}
      oncancel={handleDuplicateCancel}
    />
  {/if}
{/if}
