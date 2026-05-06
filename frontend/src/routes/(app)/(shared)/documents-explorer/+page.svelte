<script lang="ts">
  /**
   * Documents Explorer — Page Component (Phase 4.9b URL-driven state)
   *
   * URL is the single source of truth for `?page` / `?search` / `?accessScope`
   * / `?sort` / `?conversationId`. Server load (`+page.server.ts`) reads them,
   * the backend filters/sorts/paginates, and SSR data flows back as
   * `data.documents` + `data.pagination`. No client-side filter / sort.
   *
   * Pagination block + sidebar / sort dropdown / search input → `goto()`
   * navigation; mutations → `invalidateAll()` (re-runs load on the same URL).
   *
   * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.9b §D18 (W1/W2/W3)
   * @see docs/how-to/HOW-TO-FIX-MANAGE-PAGINATION.md "Phase 2 — Server-Driven"
   */
  import { onMount, untrack } from 'svelte';

  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import ChatFoldersList from './_lib/ChatFoldersList.svelte';
  import { CATEGORY_LABELS, MESSAGES, SORT_OPTIONS } from './_lib/constants';
  import DeleteConfirmModal from './_lib/DeleteConfirmModal.svelte';
  import DocumentGridView from './_lib/DocumentGridView.svelte';
  import DocumentListView from './_lib/DocumentListView.svelte';
  import EditModal from './_lib/EditModal.svelte';
  import FolderSidebar from './_lib/FolderSidebar.svelte';
  import PreviewModal from './_lib/PreviewModal.svelte';
  import { docExplorerState } from './_lib/state.svelte';
  import UploadModal from './_lib/UploadModal.svelte';

  import type { PageData } from './$types';
  import type { AccessScopeFilter, SortValue } from './+page.server';
  import type { DocumentCategory } from './_lib/types';

  // ==========================================================================
  // SSR DATA — single source of truth, $derived re-runs on every URL change
  // ==========================================================================

  const { data }: { data: PageData } = $props();

  const permissionDenied = $derived(data.permissionDenied);
  const documents = $derived(data.documents);
  const pagination = $derived(data.pagination);
  const chatFolders = $derived(data.chatFolders);
  const currentUser = $derived(data.currentUser ?? null);

  // URL-driven state (server load already normalised against allow-lists)
  const searchQuery = $derived(data.search);
  const accessScope = $derived(data.accessScope);
  const currentSort = $derived(data.sort);
  const conversationId = $derived(data.conversationId);

  /**
   * URL `accessScope` ↔ existing `DocumentCategory` enum: the two unions are
   * value-identical (server allow-list mirrors `DocumentCategory` verbatim —
   * see §D5), but TypeScript treats them as nominally distinct. Cast is
   * mechanical, not semantic — verified against `_lib/types.ts:DocumentCategory`.
   */
  const currentCategory = $derived(accessScope as DocumentCategory);
  const isViewingChatFolders = $derived(currentCategory === 'chat' && conversationId === null);

  const selectedChatFolderName = $derived.by(() => {
    if (conversationId === null) return null;
    const folder = chatFolders.find((f) => f.conversationId === conversationId);
    if (folder === undefined) return null;
    return folder.isGroup && folder.groupName !== null ? folder.groupName : folder.participantName;
  });

  const chatFoldersTotalCount = $derived(
    chatFolders.reduce((sum, f) => sum + f.attachmentCount, 0),
  );

  /**
   * Stats: `total` is authoritative (server `pagination.total`). `unread` is
   * a best-effort client count over the LOADED page only — full-tenant unread
   * needs a dedicated count endpoint (§D18 W3 / Known Limitation #11).
   */
  const stats = $derived({
    total: pagination.total,
    unread: documents.filter((d) => !d.isRead).length,
  });

  const currentSortLabel = $derived(
    SORT_OPTIONS.find((o) => o.value === currentSort)?.label ?? 'Neueste zuerst',
  );

  const showUploadButton = $derived(docExplorerState.showUploadButton(currentUser));
  const showActions = $derived(docExplorerState.showActions(currentUser));

  /** Sync SSR `currentUser` into the state module (modal-driven user lookups). */
  $effect(() => {
    const user = currentUser;
    untrack(() => {
      docExplorerState.initFromSSR(user);
    });
  });

  // ==========================================================================
  // URL NAVIGATION HELPERS — anchor-based pagination + filter→URL goto().
  // Mirrors `manage-dummies` / `blackboard` reference impls.
  // ==========================================================================

  const BASE_PATH = '/documents-explorer';

  /**
   * Build href for target page, preserving search / accessScope / sort /
   * conversationId. Defaults are skipped by `buildPaginatedHref` so the
   * canonical first-page URL is clean (`/documents-explorer`).
   */
  function pageHref(targetPage: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page: targetPage,
        search: searchQuery,
        accessScope: accessScope === 'all' ? undefined : accessScope,
        sort: currentSort === 'newest' ? undefined : currentSort,
        conversationId: conversationId ?? undefined,
      }),
    );
  }

  /**
   * Navigate to a new filter / search / sort / conversation state. Page
   * always resets to 1 (the default — never emitted into the URL).
   */
  async function navigateFilters(next: {
    search?: string;
    accessScope?: AccessScopeFilter;
    sort?: SortValue;
    /** `null` clears the conversationId param; `undefined` keeps the current one. */
    conversationId?: number | null;
  }): Promise<void> {
    const nextSearch = next.search ?? searchQuery;
    const nextScope = next.accessScope ?? accessScope;
    const nextSort = next.sort ?? currentSort;
    const nextConvId = next.conversationId !== undefined ? next.conversationId : conversationId;
    const href = resolve(
      buildPaginatedHref(BASE_PATH, {
        // page omitted → resets to 1 (default, not emitted)
        search: nextSearch,
        accessScope: nextScope === 'all' ? undefined : nextScope,
        sort: nextSort === 'newest' ? undefined : nextSort,
        conversationId: nextConvId ?? undefined,
      }),
    );
    await goto(href, { keepFocus: true, replaceState: true, noScroll: true });
  }

  // ==========================================================================
  // FILTER / SEARCH / SORT / CHAT-FOLDER HANDLERS
  // ==========================================================================

  /**
   * Search debounce — 250 ms before firing the URL update. Keeps focus on
   * the input (`keepFocus: true` in `goto`), so typing across re-runs feels
   * native. Matches the `SearchBar` debounce duration used elsewhere.
   */
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function onSearchInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const value = input.value;
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      void navigateFilters({ search: value });
    }, 250);
  }

  function clearSearch(): void {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    void navigateFilters({ search: '' });
  }

  /**
   * Sidebar category click. Resets `conversationId` to null so leaving the
   * chat scope does not leave a stale `?conversationId=N` orphan in the URL.
   */
  function navigateToCategory(category: DocumentCategory): void {
    void navigateFilters({ accessScope: category, conversationId: null });
  }

  /** Breadcrumb back-arrow inside a chat conversation: drop conversationId only. */
  function backToFolders(): void {
    void navigateFilters({ conversationId: null });
  }

  /** ChatFoldersList row click → enter that conversation's docs. */
  function loadChatConversation(convId: number): void {
    void navigateFilters({ conversationId: convId });
  }

  function setSort(option: SortValue): void {
    docExplorerState.setSortDropdownOpen(false);
    void navigateFilters({ sort: option });
  }

  // ==========================================================================
  // DOM-DEPENDENT EFFECTS
  // ==========================================================================

  /** Close sort dropdown on outside click. */
  $effect(() => {
    if (docExplorerState.sortDropdownOpen) {
      const handleOutsideClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;
        const el = document.getElementById('sort-dropdown');
        if (el !== null && !el.contains(target)) {
          docExplorerState.setSortDropdownOpen(false);
        }
      };
      document.addEventListener('click', handleOutsideClick, true);
      return () => {
        document.removeEventListener('click', handleOutsideClick, true);
      };
    }
  });

  /** Global keyboard handler for preview navigation. Passes current page docs. */
  function handleKeydown(e: KeyboardEvent): void {
    if (docExplorerState.showPreviewModal) {
      if (e.key === 'ArrowLeft') docExplorerState.navigatePreviewPrev(documents);
      else if (e.key === 'ArrowRight') docExplorerState.navigatePreviewNext(documents);
    }
  }

  /** Preview index inside the current page (server-paginated subset). */
  const previewIndex = $derived.by(() => {
    const current = docExplorerState.selectedDocument;
    if (current === null) return -1;
    return documents.findIndex((d) => d.id === current.id);
  });

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  onMount(() => {
    docExplorerState.loadSavedViewMode();
  });
</script>

<svelte:head>
  <title>{MESSAGES.PAGE_TITLE}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

{#if permissionDenied}
  <PermissionDenied addonName="die Dokumente" />
{:else}
  <div class="container">
    <div class="card">
      <!-- Card Header -->
      <div class="card__header">
        <div class="mb-4">
          <h2 class="card__title">
            <i class="fas fa-folder-open mr-2"></i>
            Dokumente Explorer
          </h2>
          <p class="mt-2 text-(--color-text-secondary)">Dokumente hochladen und verwalten</p>
        </div>

        <!-- Toolbar -->
        <div class="border-t border-(--border-color) pt-4">
          <div class="flex items-center justify-between gap-4">
            <div class="flex flex-1 items-center gap-3">
              <div class="search-input max-w-md flex-1">
                <i class="search-input__icon fas fa-search"></i>
                <input
                  type="search"
                  id="search-input"
                  class="search-input__field"
                  placeholder="Dokumente durchsuchen..."
                  autocomplete="off"
                  value={searchQuery}
                  oninput={onSearchInput}
                />
                <button
                  type="button"
                  class="search-input__clear"
                  class:hidden={searchQuery === ''}
                  onclick={clearSearch}
                  aria-label="Suche löschen"
                >
                  <i class="fas fa-times"></i>
                </button>
              </div>
              {#if showUploadButton}
                <button
                  type="button"
                  id="upload-btn"
                  class="btn btn-upload"
                  onclick={docExplorerState.handleUploadOpen}
                >
                  <i class="fas fa-upload mr-2"></i>
                  Hochladen
                </button>
              {/if}
            </div>

            <div class="flex items-center gap-3">
              <div class="flex gap-1">
                <button
                  type="button"
                  class="action-icon"
                  class:action-icon--active={docExplorerState.viewMode === 'list'}
                  aria-label="Listen-Ansicht"
                  title="Listen-Ansicht"
                  onclick={() => {
                    docExplorerState.setViewMode('list');
                  }}
                >
                  <i class="fas fa-list"></i>
                </button>
                <button
                  type="button"
                  class="action-icon"
                  class:action-icon--active={docExplorerState.viewMode === 'grid'}
                  aria-label="Grid-Ansicht"
                  title="Grid-Ansicht"
                  onclick={() => {
                    docExplorerState.setViewMode('grid');
                  }}
                >
                  <i class="fas fa-th"></i>
                </button>
              </div>

              <div
                class="dropdown"
                id="sort-dropdown"
              >
                <div
                  class="dropdown__trigger gap-2"
                  role="button"
                  tabindex="0"
                  onclick={(e) => {
                    e.stopPropagation();
                    docExplorerState.toggleSortDropdown();
                  }}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') docExplorerState.toggleSortDropdown();
                  }}
                >
                  <span>{currentSortLabel}</span>
                  <i class="fas fa-chevron-down"></i>
                </div>
                <div
                  class="dropdown__menu"
                  class:active={docExplorerState.sortDropdownOpen}
                >
                  {#each SORT_OPTIONS as option (option.value)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      class="dropdown__option"
                      onclick={() => {
                        setSort(option.value);
                      }}
                    >
                      {option.label}
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Stats — `total` from server pagination (authoritative). -->
          <div class="mt-4 flex items-center gap-6 text-sm">
            <div class="flex items-center gap-2">
              <svg
                class="text-primary-500 h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0
                  01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                ></path>
              </svg>
              <span class="text-content-secondary text-sm">{stats.total} Dokumente</span>
            </div>
            {#if stats.unread > 0}
              <div class="flex items-center gap-2">
                <span class="text-warning-500 text-sm">{stats.unread} Ungelesen</span>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Card Body -->
      <div class="card__body">
        <!-- Breadcrumb Navigation -->
        <nav
          class="breadcrumb mb-2"
          aria-label="Ordnerpfad"
        >
          {#if currentCategory === 'all'}
            <span
              class="breadcrumb__item breadcrumb__item--active"
              aria-current="page"
            >
              <i
                class="fas fa-folder breadcrumb__icon"
                aria-hidden="true"
              ></i>
              {CATEGORY_LABELS.all}
            </span>
          {:else}
            <button
              type="button"
              class="breadcrumb__item"
              onclick={() => {
                navigateToCategory('all');
              }}
            >
              <i
                class="fas fa-folder breadcrumb__icon"
                aria-hidden="true"
              ></i>
              {CATEGORY_LABELS.all}
            </button>
            <span
              class="breadcrumb__separator"
              aria-hidden="true"
            >
              <i class="fas fa-chevron-right"></i>
            </span>
            {#if conversationId !== null && selectedChatFolderName !== null}
              <button
                type="button"
                class="breadcrumb__item"
                onclick={backToFolders}
              >
                {CATEGORY_LABELS[currentCategory]}
              </button>
              <span
                class="breadcrumb__separator"
                aria-hidden="true"
              >
                <i class="fas fa-chevron-right"></i>
              </span>
              <span
                class="breadcrumb__item breadcrumb__item--active"
                aria-current="page"
              >
                <i
                  class="fas fa-comments breadcrumb__icon"
                  aria-hidden="true"
                ></i>
                {selectedChatFolderName}
              </span>
            {:else}
              <span
                class="breadcrumb__item breadcrumb__item--active"
                aria-current="page"
              >
                {CATEGORY_LABELS[currentCategory]}
              </span>
            {/if}
          {/if}
        </nav>

        <div class="flex h-[600px]">
          <!-- Sidebar (W3: count badges dropped — see Known Limitation #11). -->
          <FolderSidebar
            {currentCategory}
            {chatFoldersTotalCount}
            onnavigate={navigateToCategory}
          />

          <!-- Content Area -->
          <div class="flex flex-1 flex-col">
            <div class="flex-1 overflow-y-auto p-2">
              {#if isViewingChatFolders}
                <div class:hidden={docExplorerState.viewMode !== 'list'}>
                  <ChatFoldersList
                    folders={chatFolders}
                    showBackToAll={true}
                    onfolderClick={loadChatConversation}
                    onbackToAll={() => {
                      navigateToCategory('all');
                    }}
                  />
                </div>
              {:else}
                <div class:hidden={docExplorerState.viewMode !== 'list'}>
                  <DocumentListView
                    {documents}
                    {currentUser}
                    {showActions}
                    showBackToFolders={conversationId !== null}
                    onpreview={docExplorerState.handlePreviewOpen}
                    ondownload={docExplorerState.handleDownloadClick}
                    onedit={docExplorerState.handleEditClick}
                    ondelete={docExplorerState.handleDeleteDocument}
                    onbackToFolders={backToFolders}
                  />
                </div>
                <div class:hidden={docExplorerState.viewMode !== 'grid'}>
                  <DocumentGridView
                    {documents}
                    {currentUser}
                    {showActions}
                    onpreview={docExplorerState.handlePreviewOpen}
                    ondownload={docExplorerState.handleDownloadClick}
                    onedit={docExplorerState.handleEditClick}
                    ondelete={docExplorerState.handleDeleteDocument}
                  />
                </div>
              {/if}
            </div>

            <!-- Pagination — URL-driven anchors (W1: NEW in 4.9b — page had
                 no pagination block before; backend `limit=20` was silently
                 capping). Hidden in chat-folder-list view (no docs paginated).
                 Mirrors `blackboard/+page.svelte` block verbatim. -->
            {#if !isViewingChatFolders && pagination.totalPages > 1}
              <nav
                class="mt-4 flex items-center justify-center gap-2"
                aria-label="Seitennavigation"
              >
                <div class="pagination">
                  {#if pagination.hasPrev}
                    <a
                      class="pagination__btn"
                      href={pageHref(pagination.page - 1)}
                      rel="prev"
                      aria-label="Vorherige Seite"
                    >
                      <i class="fas fa-chevron-left"></i>
                    </a>
                  {:else}
                    <button
                      type="button"
                      class="pagination__btn"
                      disabled
                      aria-label="Vorherige Seite"
                    >
                      <i class="fas fa-chevron-left"></i>
                    </button>
                  {/if}

                  {#each Array.from({ length: pagination.totalPages }, (_: unknown, i: number) => i + 1) as p (p)}
                    {#if p === pagination.page}
                      <span
                        class="pagination__btn active"
                        aria-current="page"
                      >
                        {p}
                      </span>
                    {:else}
                      <a
                        class="pagination__btn"
                        href={pageHref(p)}
                      >
                        {p}
                      </a>
                    {/if}
                  {/each}

                  {#if pagination.hasNext}
                    <a
                      class="pagination__btn"
                      href={pageHref(pagination.page + 1)}
                      rel="next"
                      aria-label="Nächste Seite"
                    >
                      <i class="fas fa-chevron-right"></i>
                    </a>
                  {:else}
                    <button
                      type="button"
                      class="pagination__btn"
                      disabled
                      aria-label="Nächste Seite"
                    >
                      <i class="fas fa-chevron-right"></i>
                    </button>
                  {/if}
                </div>
              </nav>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Modals -->
  <PreviewModal
    show={docExplorerState.showPreviewModal}
    document={docExplorerState.selectedDocument}
    onclose={docExplorerState.closePreview}
    ondownload={docExplorerState.downloadDocument}
    onprev={() => {
      docExplorerState.navigatePreviewPrev(documents);
    }}
    onnext={() => {
      docExplorerState.navigatePreviewNext(documents);
    }}
    currentIndex={previewIndex >= 0 ? previewIndex : undefined}
    totalCount={documents.length}
  />

  <UploadModal
    show={docExplorerState.showUploadModal}
    onclose={docExplorerState.closeUploadModal}
    onsubmit={docExplorerState.handleUploadSubmit}
  />

  <EditModal
    show={docExplorerState.showEditModal}
    document={docExplorerState.editingDocument}
    submitting={docExplorerState.editSubmitting}
    onclose={docExplorerState.closeEditModal}
    onsubmit={docExplorerState.handleEditSubmit}
  />

  <DeleteConfirmModal
    show={docExplorerState.showDeleteConfirmModal}
    document={docExplorerState.deletingDocument}
    submitting={docExplorerState.deleteSubmitting}
    onclose={docExplorerState.closeDeleteConfirmModal}
    onconfirm={docExplorerState.confirmDeleteDocument}
  />
{/if}

<style>
  /* Folder Sidebar (child component: FolderSidebar) */
  :global(.folder-item) {
    transition: all 0.2s ease;
    cursor: pointer;

    margin-bottom: 4px;
    border-radius: 6px;

    background: oklch(63.68% 0.0001 263.28 / 12%);
  }

  :global(.folder-item:hover) {
    transform: translateX(2px);
    background: oklch(63.68% 0.0001 263.28 / 30%) !important;
  }

  /* User Info in Tables */
  :global(.data-table .user-info) {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
  }

  :global(.data-table .user-info .user-name) {
    display: inline-block;
    width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.data-table .user-info .badge) {
    flex-shrink: 0;
  }
</style>
