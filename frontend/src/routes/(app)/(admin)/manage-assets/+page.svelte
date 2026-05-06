<script lang="ts">
  /**
   * Manage Assets - Page Component (Phase 4.4b URL-driven state)
   * @module manage-assets/+page
   *
   * Mirrors the §4.1b `manage-employees` reference impl per
   * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.4b. URL holds pagination +
   * search + status-filter state — there is NO `$state` shadow of these.
   * Mutations call `invalidateAll()` to retrigger the load on the same
   * URL, so `?page=N`/`?search=...`/`?status=...` are preserved across
   * mutations.
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import AssetAvailabilityModal from '$lib/asset-availability/AssetAvailabilityModal.svelte';
  import {
    MACHINE_AVAILABILITY_LABELS,
    MACHINE_AVAILABILITY_BADGE_CLASSES,
  } from '$lib/asset-availability/constants';
  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { showSuccessAlert, showErrorAlert } from '$lib/stores/toast';
  import { createLogger } from '$lib/utils/logger';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  const log = createLogger('ManageAssetsPage');

  // Import from _lib/ modules
  import {
    getAssetTeams as apiGetAssetTeams,
    setAssetTeams as apiSetAssetTeams,
    saveAsset as apiSaveAsset,
    deleteAsset as apiDeleteAsset,
    updateAssetAvailability as apiUpdateAssetAvailability,
  } from './_lib/api';
  import AssetFormModal from './_lib/AssetFormModal.svelte';
  import { createMessages } from './_lib/constants';
  import DeleteModals from './_lib/DeleteModals.svelte';
  import { assetState } from './_lib/state.svelte';
  import {
    getEmptyStateTitle,
    getEmptyStateDescription,
    buildAssetFormData,
    populateFormFromAsset,
    getTeamsBadgeData,
    getAreaBadgeData,
    getDepartmentBadgeData,
  } from './_lib/utils';

  import type { AssetAvailabilityStatus } from '$lib/asset-availability/constants';
  import type { PageData } from './$types';
  import type { AssetStatusFilter } from './_lib/types';

  // ============================================================================
  // SSR DATA — URL is the single source of truth for page / search / status.
  // FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.4b: there is NO client `$state`
  // shadow of these — every change goes through `goto()` → load re-run.
  // ============================================================================

  const { data }: { data: PageData } = $props();

  // SSR data via $derived — updates when invalidateAll() / goto() reruns load.
  // `assets` already represents the current page slice (server-paginated).
  const assets = $derived(data.assets);
  const pagination = $derived(data.pagination);
  const searchTerm = $derived(data.search);
  const statusFilter = $derived<AssetStatusFilter>(data.statusFilter);

  // Hierarchy labels via data inheritance (A6) — reactive
  const labels = $derived(data.hierarchyLabels);
  const messages = $derived(createMessages(labels));

  // Sync reference data + labels into the state store for the form modal.
  // The asset list itself is no longer mirrored here (Phase 4.4b) — pages
  // read it directly from `data.assets` above.
  $effect(() => {
    assetState.setLabels(data.hierarchyLabels);
    assetState.setDepartments(data.departments);
    assetState.setAreas(data.areas);
    assetState.setTeams(data.teams);
  });

  // ============================================================================
  // DERIVED VALUES
  // ============================================================================

  const emptyStateTitle = $derived(getEmptyStateTitle(statusFilter, messages));
  const emptyStateDescription = $derived(getEmptyStateDescription(statusFilter, messages));

  // ============================================================================
  // CLIENT STATE — only modal open/close + form fields are local. Pagination,
  // search, and status filter are URL-driven via the helpers below.
  // ============================================================================

  // Search input → URL debouncer. Local-only; URL is the authoritative state.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 300;

  // ============================================================================
  // URL HELPERS — single source of truth for page / search / status
  // ============================================================================

  const BASE_PATH = '/manage-assets';

  /**
   * Build an href for a target page, preserving current search + status.
   * `buildPaginatedHref` skips defaults (page=1 / search='' / undefined),
   * so canonical first-page URLs stay clean (`/manage-assets`).
   */
  function pageHref(targetPage: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page: targetPage,
        search: searchTerm,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    );
  }

  /**
   * Navigate to a new filter/search state. Page resets to 1 (default —
   * not emitted into the URL).
   */
  function navigateFilters(next: { search?: string; statusFilter?: AssetStatusFilter }): void {
    const nextSearch = next.search ?? searchTerm;
    const nextStatus = next.statusFilter ?? statusFilter;
    const href = resolve(
      buildPaginatedHref(BASE_PATH, {
        // page omitted → resets to 1
        search: nextSearch,
        status: nextStatus === 'all' ? undefined : nextStatus,
      }),
    );
    void goto(href, { keepFocus: true });
  }

  function handleStatusToggle(value: AssetStatusFilter): void {
    navigateFilters({ statusFilter: value });
  }

  function handleSearchInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const term = input.value;
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      navigateFilters({ search: term });
    }, SEARCH_DEBOUNCE_MS);
  }

  function clearSearch(): void {
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    navigateFilters({ search: '' });
  }

  // ============================================================================
  // API FUNCTIONS - Level 3: invalidateAll() after mutations
  // ============================================================================

  async function saveAsset() {
    assetState.setSubmitting(true);

    try {
      if (!assetState.formName.trim()) {
        showErrorAlert(messages.ERROR_NAME_REQUIRED);
        assetState.setSubmitting(false);
        return;
      }

      const formData = buildAssetFormData({
        name: assetState.formName,
        model: assetState.formModel,
        manufacturer: assetState.formManufacturer,
        serialNumber: assetState.formSerialNumber,
        departmentId: assetState.formDepartmentId,
        areaId: assetState.formAreaId,
        assetType: assetState.formAssetType,
        status: assetState.formStatus,
        operatingHours: assetState.formOperatingHours,
        nextMaintenance: assetState.formNextMaintenance,
      });

      const savedId = await apiSaveAsset(formData, assetState.currentEditId);

      const teamsChanged =
        assetState.formTeamIds.length !== assetState.currentAssetTeamIds.length ||
        assetState.formTeamIds.some((id) => !assetState.currentAssetTeamIds.includes(id));

      if (teamsChanged) {
        await apiSetAssetTeams(savedId, assetState.formTeamIds);
      }

      showSuccessAlert(assetState.isEditMode ? messages.SUCCESS_UPDATED : messages.SUCCESS_CREATED);
      assetState.closeAssetModal();
      // Retrigger SSR load on the SAME URL (preserves ?page / ?search / ?status).
      await invalidateAll();
    } catch (err: unknown) {
      log.error({ err }, 'Error saving asset');
      showErrorAlert(err instanceof Error ? err.message : messages.ERROR_SAVE_FAILED);
    } finally {
      assetState.setSubmitting(false);
    }
  }

  async function deleteAsset() {
    if (assetState.deleteAssetId === null) return;

    try {
      await apiDeleteAsset(assetState.deleteAssetId);
      showSuccessAlert(messages.SUCCESS_DELETED);
      assetState.closeDeleteModal();
      await invalidateAll();
    } catch (err: unknown) {
      log.error({ err }, 'Error deleting asset');
      showErrorAlert(messages.ERROR_DELETE_FAILED);
    }
  }

  // ============================================================================
  // MODAL HANDLERS
  // ============================================================================

  function openAddModal() {
    assetState.setCurrentEditId(null);
    assetState.resetForm();
    assetState.openAssetModal();
  }

  async function openEditModal(assetId: number) {
    // Asset comes from the current SSR page slice (`data.assets`). If the
    // user navigates pages while a modal is open we never get here — the
    // table only renders rows from the current slice.
    const asset = assets.find((m) => m.id === assetId);
    if (!asset) return;

    assetState.setCurrentEditId(assetId);
    const formState = populateFormFromAsset(asset);

    assetState.setFormName(formState.name);
    assetState.setFormModel(formState.model);
    assetState.setFormManufacturer(formState.manufacturer);
    assetState.setFormSerialNumber(formState.serialNumber);
    assetState.setFormAssetType(formState.assetType);
    assetState.setFormStatus(formState.status);
    assetState.setFormOperatingHours(formState.operatingHours);
    assetState.setFormNextMaintenance(formState.nextMaintenance);
    assetState.setFormAreaId(formState.areaId);
    assetState.setFormDepartmentId(formState.departmentId);

    const assetTeams = await apiGetAssetTeams(assetId);
    const teamIds = assetTeams.map((t) => t.teamId);
    assetState.setFormTeamIds(teamIds);
    assetState.setCurrentAssetTeamIds([...teamIds]);

    assetState.openAssetModal();
  }

  // ============================================================================
  // FORM SUBMIT HANDLER
  // ============================================================================

  function handleFormSubmit(e: Event) {
    e.preventDefault();
    void saveAsset();
  }

  // ============================================================================
  // ASSET AVAILABILITY STATE & HANDLERS
  // ============================================================================

  let showAvailabilityModal = $state(false);
  let availabilityAsset = $state<{ name: string; uuid: string } | null>(null);
  let availabilitySubmitting = $state(false);
  let availabilityStatus = $state<AssetAvailabilityStatus>('maintenance');
  let availabilityStart = $state('');
  let availabilityEnd = $state('');
  let availabilityReason = $state('');
  let availabilityNotes = $state('');

  function openAvailabilityModal(asset: { name: string; uuid: string }): void {
    availabilityAsset = asset;
    availabilityStatus = 'maintenance';
    availabilityStart = '';
    availabilityEnd = '';
    availabilityReason = '';
    availabilityNotes = '';
    showAvailabilityModal = true;
  }

  function closeAvailabilityModal(): void {
    showAvailabilityModal = false;
    availabilityAsset = null;
  }

  function navigateToAvailabilityHistory(uuid: string): void {
    closeAvailabilityModal();
    void goto(resolve('/(app)/(admin)/manage-assets/availability/[uuid]', { uuid }));
  }

  /** Validate availability form, returns error message or null */
  function validateAvailabilityForm(): string | null {
    if (availabilityStatus === 'operational') return null;
    if (availabilityStart === '' || availabilityEnd === '') {
      return 'Start- und Enddatum sind erforderlich';
    }
    if (availabilityEnd < availabilityStart) {
      return 'Bis-Datum muss nach oder gleich Von-Datum sein';
    }
    return null;
  }

  async function saveAvailability(): Promise<void> {
    if (availabilityAsset === null) return;

    const validationError = validateAvailabilityForm();
    if (validationError !== null) {
      showErrorAlert(validationError);
      return;
    }

    availabilitySubmitting = true;
    try {
      await apiUpdateAssetAvailability(availabilityAsset.uuid, {
        availabilityStatus,
        ...(availabilityStart !== '' && { availabilityStart }),
        ...(availabilityEnd !== '' && { availabilityEnd }),
        ...(availabilityReason !== '' && { availabilityReason }),
        ...(availabilityNotes !== '' && { availabilityNotes }),
      });
      showSuccessAlert('Verfügbarkeit aktualisiert');
      closeAvailabilityModal();
      await invalidateAll();
    } catch (err: unknown) {
      log.error({ err }, 'Error saving asset availability');
      const errorMsg = err instanceof Error ? err.message : 'Fehler beim Speichern';
      showErrorAlert(errorMsg);
    } finally {
      availabilitySubmitting = false;
    }
  }

  // ============================================================================
  // OUTSIDE CLICK HANDLERS — form modal dropdowns only.
  //
  // The asset-search dropdown was REMOVED in Phase 4.4b (search is now a
  // URL-driven debounced query — the table itself shows hits, the dropdown
  // was redundant). The remaining dropdown configs are ALL for the form
  // modal (department / area / type / teams) — they keep their outside-
  // click-to-close behaviour unchanged.
  // ============================================================================

  const dropdownConfigs = [
    {
      isOpen: () => assetState.departmentDropdownOpen,
      selector: '#department-dropdown',
      close: () => {
        assetState.setDepartmentDropdownOpen(false);
      },
    },
    {
      isOpen: () => assetState.areaDropdownOpen,
      selector: '#area-dropdown',
      close: () => {
        assetState.setAreaDropdownOpen(false);
      },
    },
    {
      isOpen: () => assetState.typeDropdownOpen,
      selector: '#type-dropdown',
      close: () => {
        assetState.setTypeDropdownOpen(false);
      },
    },
    {
      isOpen: () => assetState.teamsDropdownOpen,
      selector: '#teams-dropdown',
      close: () => {
        assetState.setTeamsDropdownOpen(false);
      },
    },
  ];

  function isAnyDropdownOpen(): boolean {
    return dropdownConfigs.some((config) => config.isOpen());
  }

  function handleOutsideClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    for (const config of dropdownConfigs) {
      if (!config.isOpen()) continue;
      const el = document.querySelector(config.selector);
      if (el !== null && !el.contains(target)) config.close();
    }
  }

  $effect(() => {
    if (isAnyDropdownOpen()) {
      document.addEventListener('click', handleOutsideClick, true);
      return () => {
        document.removeEventListener('click', handleOutsideClick, true);
      };
    }
  });

  // ============================================================================
  // HELPERS
  // ============================================================================

  /** Format ISO date string to German locale (dd.mm.yyyy) */
  function formatDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return `${day}.${month}.${year}`;
  }
</script>

<svelte:head>
  <title>{messages.PAGE_TITLE}</title>
</svelte:head>

{#if data.permissionDenied}
  <PermissionDenied addonName="die Anlagenverwaltung" />
{:else}
  <div class="container">
    <div class="card">
      <div class="card__header">
        <h2 class="card__title">
          <i class="fas fa-cogs mr-2"></i>
          {messages.PAGE_HEADING}
        </h2>
        <p class="mt-2 text-(--color-text-secondary)">
          {messages.PAGE_DESCRIPTION}
        </p>

        <div class="alert alert--info alert--sm mt-4">
          <div class="alert__icon"><i class="fas fa-info-circle"></i></div>
          <div class="alert__content">
            <div class="alert__message">
              TPM-Wartungspläne werden hier nicht angezeigt. Diese Übersicht dient primär für
              außerordentliche Zustände wie ungeplante Reparaturen oder Stillstände.
            </div>
          </div>
        </div>

        <div class="mt-6 flex items-center justify-between gap-4">
          <!-- Status Toggle Group — backend `?status=` enum verbatim (D5). -->
          <div
            class="toggle-group"
            id="asset-status-toggle"
          >
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 'all'}
              onclick={() => {
                handleStatusToggle('all');
              }}
            >
              <i class="fas fa-list"></i>
              {messages.FILTER_ALL}
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 'operational'}
              onclick={() => {
                handleStatusToggle('operational');
              }}
            >
              <i class="fas fa-check-circle"></i>
              {messages.FILTER_OPERATIONAL}
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 'maintenance'}
              onclick={() => {
                handleStatusToggle('maintenance');
              }}
            >
              <i class="fas fa-wrench"></i>
              {messages.FILTER_MAINTENANCE}
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 'repair'}
              onclick={() => {
                handleStatusToggle('repair');
              }}
            >
              <i class="fas fa-tools"></i>
              {messages.FILTER_REPAIR}
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 'standby'}
              onclick={() => {
                handleStatusToggle('standby');
              }}
            >
              <i class="fas fa-pause-circle"></i>
              {messages.FILTER_STANDBY}
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 'decommissioned'}
              onclick={() => {
                handleStatusToggle('decommissioned');
              }}
            >
              <i class="fas fa-power-off"></i>
              {messages.FILTER_DECOMMISSIONED}
            </button>
          </div>

          <!-- Search Input — debounced URL update (300 ms), URL-driven -->
          <div class="search-input max-w-80">
            <i class="search-input__icon fas fa-search"></i>
            <input
              type="search"
              id="asset-search"
              class="search-input__field"
              placeholder={messages.SEARCH_PLACEHOLDER}
              autocomplete="off"
              value={searchTerm}
              oninput={handleSearchInput}
            />
            <button
              class="search-input__clear"
              class:search-input__clear--visible={searchTerm.length > 0}
              type="button"
              aria-label="Suche löschen"
              onclick={clearSearch}
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="card__body">
        {#if assets.length === 0}
          <div
            id="assets-empty"
            class="empty-state"
          >
            <div class="empty-state__icon"><i class="fas fa-cogs"></i></div>
            <h3 class="empty-state__title">{emptyStateTitle}</h3>
            <p class="empty-state__description">{emptyStateDescription}</p>
            {#if statusFilter === 'all' && searchTerm === ''}
              <button
                type="button"
                class="btn btn-primary"
                onclick={openAddModal}
              >
                <i class="fas fa-plus"></i>
                {messages.BTN_ADD}
              </button>
            {/if}
          </div>
        {:else}
          <div id="assets-table-content">
            <div class="table-responsive">
              <table
                class="data-table data-table--hover data-table--striped data-table--actions-hover"
                id="assets-table"
              >
                <thead>
                  <tr>
                    <th scope="col">{messages.TH_ID}</th>
                    <th scope="col">{messages.TH_NAME}</th>
                    <th scope="col">{messages.TH_MODEL}</th>
                    <th scope="col">{messages.TH_MANUFACTURER}</th>
                    <th scope="col">{messages.TH_AREA}</th>
                    <th scope="col">{messages.TH_DEPARTMENT}</th>
                    <th scope="col">{messages.TH_TEAMS}</th>
                    <th scope="col">{messages.TH_NEXT_ABSENCE}</th>
                    <th scope="col">{messages.TH_ACTIONS}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each assets as asset (asset.id)}
                    {@const areaBadge = getAreaBadgeData(asset.areaName, labels)}
                    {@const deptBadge = getDepartmentBadgeData(asset.departmentName, labels)}
                    {@const teamsBadge = getTeamsBadgeData(asset.teams, labels)}
                    <tr>
                      <td><code class="text-muted">{asset.id}</code></td>
                      <td><strong>{asset.name}</strong></td>
                      <td>{asset.model ?? '-'}</td>
                      <td>{asset.manufacturer ?? '-'}</td>
                      <td>
                        <span
                          class="badge {areaBadge.class}"
                          title={areaBadge.tooltip}
                        >
                          {areaBadge.text}
                        </span>
                      </td>
                      <td>
                        <span
                          class="badge {deptBadge.class}"
                          title={deptBadge.tooltip}
                        >
                          {deptBadge.text}
                        </span>
                      </td>
                      <td>
                        <span
                          class="badge {teamsBadge.class}"
                          title={teamsBadge.tooltip}
                        >
                          {teamsBadge.text}
                        </span>
                      </td>
                      <td>
                        {#if asset.availabilityStatus !== undefined && asset.availabilityStatus !== 'operational' && asset.availabilityStart !== undefined}
                          {@const statusKey = asset.availabilityStatus as AssetAvailabilityStatus}
                          <span
                            class="badge {MACHINE_AVAILABILITY_BADGE_CLASSES[statusKey]}"
                            title={asset.availabilityNotes ?? ''}
                          >
                            {formatDate(asset.availabilityStart)}
                            – {MACHINE_AVAILABILITY_LABELS[statusKey]}
                          </span>
                        {:else}
                          <span class="text-(--color-text-tertiary)">–</span>
                        {/if}
                      </td>
                      <td>
                        <div class="flex gap-2">
                          <button
                            type="button"
                            class="action-icon action-icon--info"
                            title="Verfügbarkeit"
                            aria-label="Verfügbarkeit bearbeiten"
                            onclick={() => {
                              openAvailabilityModal({
                                name: asset.name,
                                uuid: asset.uuid,
                              });
                            }}
                          >
                            <i class="fas fa-calendar-alt"></i>
                          </button>
                          <button
                            type="button"
                            class="action-icon action-icon--edit"
                            title="Bearbeiten"
                            aria-label="Bearbeiten"
                            onclick={() => openEditModal(asset.id)}
                          >
                            <i class="fas fa-edit"></i>
                          </button>
                          <button
                            type="button"
                            class="action-icon action-icon--delete"
                            title="Löschen"
                            aria-label="Löschen"
                            onclick={() => {
                              assetState.openDeleteModal(asset.id);
                            }}
                          >
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- Pagination — URL-driven, anchor-based for native back/forward + right-click support -->
            {#if pagination.totalPages > 1}
              <nav
                class="pagination"
                id="assets-pagination"
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
        {/if}
      </div>
    </div>
  </div>

  <!-- Floating Action Button -->
  <button
    type="button"
    class="btn-float add-asset-btn"
    onclick={openAddModal}
    aria-label="Hinzufügen"
  >
    <i class="fas fa-plus"></i>
  </button>

  <!-- Modal Components -->
  <AssetFormModal
    onsubmit={handleFormSubmit}
    onclose={() => {
      assetState.closeAssetModal();
    }}
  />
  <DeleteModals ondelete={deleteAsset} />

  <!-- Asset Availability Modal -->
  <AssetAvailabilityModal
    show={showAvailabilityModal}
    asset={availabilityAsset}
    submitting={availabilitySubmitting}
    bind:availabilityStatus
    bind:availabilityStart
    bind:availabilityEnd
    bind:availabilityReason
    bind:availabilityNotes
    onclose={closeAvailabilityModal}
    onsave={() => {
      void saveAvailability();
    }}
    onmanage={navigateToAvailabilityHistory}
  />
{/if}
