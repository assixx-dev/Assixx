<script lang="ts">
  /**
   * Manage Admins - Page Component (Phase 4.2 URL-driven state)
   * @module manage-admins/+page
   *
   * Mirrors the Phase-3 reference impl (`manage-dummies/+page.svelte`) and
   * the Phase-4.1b sibling (`manage-employees/+page.svelte`) per
   * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.2. URL holds pagination +
   * search + status-filter state — there is NO `$state` shadow of these.
   * Mutations call `invalidateAll()` to retrigger the load on the same URL,
   * so `?page=N`/`?search=...`/`?isActive=N` are preserved across mutations.
   *
   * Root-only page (gated by `(root)/+layout.server.ts`, ADR-012). No
   * `<PermissionDenied />` path is needed — the route group is fail-closed
   * for non-root users.
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import AvailabilityModal from '$lib/availability/AvailabilityModal.svelte';
  import { showSuccessAlert, showWarningAlert, showErrorAlert, showToast } from '$lib/stores/toast';
  import { getApiClient } from '$lib/utils/api-client';
  import { createLogger } from '$lib/utils/logger';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import AdminFormModal from './_lib/AdminFormModal.svelte';
  import AdminTableRow from './_lib/AdminTableRow.svelte';
  import { createMessages, FORM_DEFAULTS } from './_lib/constants';
  import DeleteModals from './_lib/DeleteModals.svelte';
  import {
    executeFullAdminSave,
    executeFullAvailabilitySave,
    executeUpgradeToRoot,
    executeDowngradeToEmployee,
    executeDeleteAdmin,
  } from './_lib/page-actions';
  import RoleChangeModals from './_lib/RoleChangeModals.svelte';
  import { populateFormFromAdmin } from './_lib/utils';

  import type { PageData } from './$types';
  import type { FormIsActiveStatus, AvailabilityStatus } from './_lib/types';

  const apiClient = getApiClient();
  const log = createLogger('ManageAdminsPage');

  /** Load N:M position assignments for edit mode */
  async function loadUserPositions(userId: number): Promise<void> {
    try {
      const positions = await apiClient.request<{ positionId: string }[]>(
        `/users/${String(userId)}/positions`,
      );
      formPositionIds = positions.map((p: { positionId: string }) => p.positionId);
    } catch {
      formPositionIds = [];
    }
  }

  // ============================================================================
  // SSR DATA — URL is the single source of truth for page / search / status.
  // FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.2: there is NO client `$state`
  // shadow of these — every change goes through `goto()` → load re-run.
  // ============================================================================

  const { data }: { data: PageData } = $props();

  // SSR data via $derived — updates when invalidateAll() / goto() reruns load.
  // `admins` already represents the current page slice (server-paginated).
  const allAdmins = $derived(data.admins);
  const allAreas = $derived(data.areas);
  const allDepartments = $derived(data.departments);
  const positionOptions = $derived(data.positionOptions);
  const pagination = $derived(data.pagination);
  const searchTerm = $derived(data.search);
  // `number | 'all'` — numeric IS_ACTIVE codes, single conversion in load.
  const statusFilter = $derived(data.statusFilter);

  // Hierarchy labels (propagated from layout)
  const labels = $derived(data.hierarchyLabels);
  const messages = $derived(createMessages(labels));

  const canUpgrade = $derived(data.user !== null && data.user.role === 'root');

  // ============================================================================
  // CLIENT STATE — only modal open/close + form fields are local. Pagination,
  // search, and status filter are URL-driven via the helpers below.
  // ============================================================================

  // Error state (legacy — load function never throws now, kept for forward-compat).
  const error = $state<string | null>(null);

  // Modal States
  let showAdminModal = $state(false);
  let showDeleteModal = $state(false);
  let showUpgradeConfirmModal = $state(false);
  let upgradeAdminId = $state<number | null>(null);
  let upgradeLoading = $state(false);
  let showDowngradeConfirmModal = $state(false);
  let downgradeAdminId = $state<number | null>(null);
  let downgradeLoading = $state(false);
  let showAvailabilityModal = $state(false);
  let availabilityAdminId = $state<number | null>(null);
  let availabilityStatus = $state<AvailabilityStatus>('available');
  let availabilityStart = $state('');
  let availabilityEnd = $state('');
  let availabilityReason = $state('');
  let availabilityNotes = $state('');
  let availabilitySubmitting = $state(false);
  let currentEditId = $state<number | null>(null);
  let deleteAdminId = $state<number | null>(null);

  // Form Fields (for AdminFormModal)
  let formFirstName = $state('');
  let formLastName = $state('');
  let formEmail = $state('');
  let formEmailConfirm = $state('');
  let formPassword = $state('');
  let formPasswordConfirm = $state('');
  let formEmployeeNumber = $state('');
  let formPositionIds = $state<string[]>([]);
  let formNotes = $state('');
  let formIsActive = $state<FormIsActiveStatus>(1);
  let formHasFullAccess = $state(false);
  let formAreaIds = $state<number[]>([]);
  let formDepartmentIds = $state<number[]>([]);
  let submitting = $state(false);

  // Search input → URL debouncer. Local-only; URL is the authoritative state.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 300;

  // ============================================================================
  // DERIVED VALUES
  // ============================================================================

  const isEditMode = $derived(currentEditId !== null);
  const modalTitle = $derived(isEditMode ? messages.MODAL_EDIT_TITLE : messages.MODAL_ADD_TITLE);

  // Derived: Current admin for availability modal. If the user navigates pages
  // while the modal is open, the admin may no longer be in the current page
  // slice — `find` returns undefined → fallback to null.
  const availabilityAdmin = $derived(
    availabilityAdminId !== null ?
      (allAdmins.find((a) => a.id === availabilityAdminId) ?? null)
    : null,
  );

  // ============================================================================
  // URL HELPERS — single source of truth for page/search/status
  // ============================================================================

  const BASE_PATH = '/manage-admins';

  // Default status filter — must mirror `+page.server.ts` STATUS_FILTER default
  // (currently `'1'`, IS_ACTIVE.ACTIVE). Stripping this value from the URL
  // keeps the canonical first-page URL clean (`/manage-admins`) per ADR-058.
  const DEFAULT_STATUS_FILTER = 1;

  /**
   * Build an href for a target page, preserving current search + status.
   * `buildPaginatedHref` skips defaults (page=1 / search='' / undefined),
   * so canonical first-page URLs stay clean (`/manage-admins`).
   */
  function pageHref(targetPage: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page: targetPage,
        search: searchTerm,
        isActive: statusFilter === DEFAULT_STATUS_FILTER ? undefined : String(statusFilter),
      }),
    );
  }

  /**
   * Navigate to a new filter/search state. Page resets to 1 (default —
   * not emitted into the URL).
   */
  function navigateFilters(next: { search?: string; statusFilter?: number | 'all' }): void {
    const nextSearch = next.search ?? searchTerm;
    const nextStatus = next.statusFilter ?? statusFilter;
    const href = resolve(
      buildPaginatedHref(BASE_PATH, {
        // page omitted → resets to 1
        search: nextSearch,
        isActive: nextStatus === DEFAULT_STATUS_FILTER ? undefined : String(nextStatus),
      }),
    );
    void goto(href, { keepFocus: true });
  }

  function handleStatusToggle(value: number | 'all'): void {
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
  // FORM HELPERS
  // ============================================================================

  function applyFormState(s: typeof FORM_DEFAULTS): void {
    formFirstName = s.firstName;
    formLastName = s.lastName;
    formEmail = s.email;
    formEmailConfirm = s.emailConfirm;
    formPassword = s.password;
    formPasswordConfirm = s.passwordConfirm;
    formEmployeeNumber = s.employeeNumber;
    formPositionIds = [];
    formNotes = s.notes;
    formIsActive = s.isActive;
    formHasFullAccess = s.hasFullAccess;
    formAreaIds = [...s.areaIds];
    formDepartmentIds = [...s.departmentIds];
  }

  // ============================================================================
  // API HANDLERS — Level 3: invalidateAll() after mutations
  // ============================================================================

  async function saveAdmin(): Promise<void> {
    submitting = true;
    const result = await executeFullAdminSave(
      {
        firstName: formFirstName,
        lastName: formLastName,
        email: formEmail,
        emailConfirm: formEmailConfirm,
        password: formPassword,
        passwordConfirm: formPasswordConfirm,
        employeeNumber: formEmployeeNumber,
        positionIds: formPositionIds,
        notes: formNotes,
        isActive: formIsActive,
        hasFullAccess: formHasFullAccess,
        areaIds: formAreaIds,
        departmentIds: formDepartmentIds,
      },
      currentEditId,
      isEditMode,
      log,
      messages,
    );
    if (result.validationError !== undefined) {
      showWarningAlert(result.validationError);
      submitting = false;
      return;
    }
    if (result.success) {
      closeAdminModal();
      // Retrigger SSR load on the SAME URL (preserves ?page / ?search / ?isActive).
      await invalidateAll();
      if (!isEditMode && result.uuid !== null) {
        showToast({
          type: 'success',
          title: 'Admin erstellt',
          message: 'Berechtigungen jetzt zuweisen?',
          duration: 8000,
          action: {
            label: 'Berechtigungen',
            href: `/manage-admins/permission/${result.uuid}`,
          },
        });
      } else {
        showSuccessAlert(isEditMode ? messages.SUCCESS_UPDATED : messages.SUCCESS_CREATED);
      }
    } else {
      showErrorAlert(result.errorMessage ?? messages.ERROR_SAVE_FAILED);
    }
    submitting = false;
  }

  function upgradeAdmin(): void {
    if (currentEditId === null) return;
    if (!canUpgrade) {
      showWarningAlert(messages.UPGRADE_UNAUTHORIZED);
      return;
    }
    upgradeAdminId = currentEditId;
    closeAdminModal();
    showUpgradeConfirmModal = true;
  }

  async function confirmUpgradeAdmin(): Promise<void> {
    if (upgradeAdminId === null) return;
    if (!canUpgrade) {
      showWarningAlert(messages.UPGRADE_UNAUTHORIZED);
      return;
    }
    const adminId = upgradeAdminId;
    showUpgradeConfirmModal = false;
    upgradeAdminId = null;
    upgradeLoading = true;
    const result = await executeUpgradeToRoot(adminId, log);
    if (result.success) {
      await invalidateAll();
      showSuccessAlert(messages.UPGRADE_SUCCESS);
    } else {
      showErrorAlert(result.errorMessage ?? messages.UPGRADE_ERROR);
    }
    upgradeLoading = false;
  }

  function downgradeAdmin(): void {
    if (currentEditId === null) return;
    if (!canUpgrade) {
      showWarningAlert(messages.UPGRADE_UNAUTHORIZED);
      return;
    }
    downgradeAdminId = currentEditId;
    closeAdminModal();
    showDowngradeConfirmModal = true;
  }

  async function confirmDowngradeAdmin(): Promise<void> {
    if (downgradeAdminId === null) return;
    if (!canUpgrade) {
      showWarningAlert(messages.UPGRADE_UNAUTHORIZED);
      return;
    }
    const adminId = downgradeAdminId;
    showDowngradeConfirmModal = false;
    downgradeAdminId = null;
    downgradeLoading = true;
    const result = await executeDowngradeToEmployee(adminId, log);
    if (result.success) {
      await invalidateAll();
      showSuccessAlert(messages.DOWNGRADE_SUCCESS);
    } else {
      showErrorAlert(result.errorMessage ?? messages.DOWNGRADE_ERROR);
    }
    downgradeLoading = false;
  }

  async function deleteAdmin(): Promise<void> {
    const adminId = deleteAdminId;
    if (adminId === null) return;
    showDeleteModal = false;
    deleteAdminId = null;
    const result = await executeDeleteAdmin(adminId, log);
    if (result.success) {
      showSuccessAlert(messages.SUCCESS_DELETED);
      await invalidateAll();
    } else {
      showErrorAlert(messages.ERROR_DELETE_FAILED);
    }
  }

  // ============================================================================
  // AVAILABILITY
  // ============================================================================

  function resetAvailabilityFields(): void {
    availabilityStatus = 'available';
    availabilityStart = '';
    availabilityEnd = '';
    availabilityReason = '';
    availabilityNotes = '';
  }

  function openAvailabilityModal(adminId: number): void {
    if (!allAdmins.some((a) => a.id === adminId)) return;
    availabilityAdminId = adminId;
    resetAvailabilityFields();
    showAvailabilityModal = true;
  }

  function closeAvailabilityModal(): void {
    showAvailabilityModal = false;
    availabilityAdminId = null;
    resetAvailabilityFields();
  }

  async function saveAvailability(): Promise<void> {
    if (availabilityAdminId === null) return;
    availabilitySubmitting = true;
    const result = await executeFullAvailabilitySave(
      availabilityAdminId,
      {
        status: availabilityStatus,
        start: availabilityStart,
        end: availabilityEnd,
        reason: availabilityReason,
        notes: availabilityNotes,
      },
      log,
    );
    if (result.validationError === 'dates_required') {
      showErrorAlert('Von-Datum und Bis-Datum sind erforderlich.');
    } else if (result.validationError === 'end_before_start') {
      showErrorAlert('Bis-Datum muss nach oder gleich Von-Datum sein.');
    } else if (result.success) {
      closeAvailabilityModal();
      await invalidateAll();
      showSuccessAlert('Verfügbarkeit aktualisiert');
    } else {
      showErrorAlert(result.errorMessage ?? 'Fehler beim Speichern der Verfügbarkeit');
    }
    availabilitySubmitting = false;
  }

  // ============================================================================
  // MODAL HANDLERS
  // ============================================================================

  function openEditModal(adminId: number): void {
    const admin = allAdmins.find((a) => a.id === adminId);
    if (!admin) return;
    currentEditId = adminId;
    const s = populateFormFromAdmin(admin);
    applyFormState({ ...s, emailConfirm: s.email, passwordConfirm: '' });
    void loadUserPositions(adminId);
    showAdminModal = true;
  }

  function closeAdminModal(): void {
    showAdminModal = false;
    currentEditId = null;
    applyFormState(FORM_DEFAULTS);
  }
</script>

<svelte:head>
  <title>{messages.PAGE_TITLE}</title>
</svelte:head>

<div class="container">
  <div class="card">
    <div class="card__header">
      <h2 class="card__title">
        <i class="fas fa-users mr-2"></i>
        {messages.PAGE_HEADING}
      </h2>
      <p class="mt-2 text-(--color-text-secondary)">
        {messages.PAGE_DESCRIPTION}
      </p>

      <div
        class="mt-6 flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between"
      >
        <!-- Status Toggle Group — numeric IS_ACTIVE codes (0/1/3 + 'all') -->
        <div
          class="toggle-group"
          id="admin-status-toggle"
        >
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 1}
            title="Aktive Administratoren"
            onclick={() => {
              handleStatusToggle(1);
            }}
          >
            <i class="fas fa-user-check"></i>
            {messages.FILTER_ACTIVE}
          </button>
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 0}
            title="Inaktive Administratoren"
            onclick={() => {
              handleStatusToggle(0);
            }}
          >
            <i class="fas fa-user-times"></i>
            {messages.FILTER_INACTIVE}
          </button>
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 3}
            title="Archivierte Administratoren"
            onclick={() => {
              handleStatusToggle(3);
            }}
          >
            <i class="fas fa-archive"></i>
            {messages.FILTER_ARCHIVED}
          </button>
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 'all'}
            title="Alle Administratoren"
            onclick={() => {
              handleStatusToggle('all');
            }}
          >
            <i class="fas fa-users"></i>
            {messages.FILTER_ALL}
          </button>
        </div>

        <!-- Search Input — debounced URL update (300 ms), URL-driven -->
        <div class="search-input max-w-80">
          <i class="search-input__icon fas fa-search"></i>
          <input
            type="search"
            id="admin-search"
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
      {#if error !== null}
        <div class="p-6 text-center">
          <i class="fas fa-exclamation-triangle mb-4 text-4xl text-(--color-danger)"></i>
          <p class="text-(--color-text-secondary)">{error}</p>
          <button
            type="button"
            class="btn btn-primary mt-4"
            onclick={() => invalidateAll()}>{messages.BTN_RETRY}</button
          >
        </div>
      {:else if allAdmins.length === 0}
        <div
          id="admins-empty"
          class="empty-state"
        >
          <div class="empty-state__icon">
            <i class="fas fa-users"></i>
          </div>
          <h3 class="empty-state__title">{messages.EMPTY_TITLE}</h3>
          <p class="empty-state__description">{messages.EMPTY_DESCRIPTION}</p>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!data.tenantVerified}
            title={data.tenantVerified ? undefined : (
              'Verifiziere zuerst Deine Firmen-Domain unter /settings/company-profile/domains.'
            )}
            onclick={() => {
              currentEditId = null;
              applyFormState(FORM_DEFAULTS);
              showAdminModal = true;
            }}
          >
            <i class="fas fa-plus"></i>
            {messages.BTN_ADD_ADMIN}
          </button>
        </div>
      {:else}
        <div id="admins-table-content">
          <div class="table-responsive">
            <table
              class="data-table data-table--hover data-table--striped data-table--actions-hover"
              id="admins-table"
            >
              <thead>
                <tr>
                  <th scope="col">{messages.TH_ID}</th>
                  <th scope="col">{messages.TH_NAME}</th>
                  <th scope="col">{messages.TH_EMAIL}</th>
                  <th scope="col">{messages.TH_EMPLOYEE_NUMBER}</th>
                  <th scope="col">{messages.TH_POSITION}</th>
                  <th scope="col">{messages.TH_STATUS}</th>
                  <th scope="col">{messages.TH_AREAS}</th>
                  <th scope="col">{messages.TH_DEPARTMENTS}</th>
                  <th scope="col">{messages.TH_TEAMS}</th>
                  <th scope="col">{messages.TH_AVAILABILITY}</th>
                  <th scope="col">{messages.TH_PLANNED}</th>
                  <th scope="col">{messages.TH_ADDITIONAL_INFO}</th>
                  <th scope="col">{messages.TH_ABSENCE_NOTES}</th>
                  <th scope="col">{messages.TH_ACTIONS}</th>
                </tr>
              </thead>
              <tbody>
                {#each allAdmins as admin (admin.id)}
                  <AdminTableRow
                    {admin}
                    {labels}
                    currentUserId={data.user?.id ?? 0}
                    onedit={openEditModal}
                    onavailability={openAvailabilityModal}
                    onpermission={(uuid: string) => {
                      void goto(`/manage-admins/permission/${uuid}`);
                    }}
                    ondelete={(adminId: number) => {
                      deleteAdminId = adminId;
                      showDeleteModal = true;
                    }}
                  />
                {/each}
              </tbody>
            </table>
          </div>

          <!-- Pagination — URL-driven, anchor-based for native back/forward + right-click support -->
          {#if pagination.totalPages > 1}
            <nav
              class="pagination"
              id="admins-pagination"
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
  class="btn-float"
  disabled={!data.tenantVerified}
  title={data.tenantVerified ?
    'Administrator hinzufügen'
  : 'Verifiziere zuerst Deine Firmen-Domain unter /settings/company-profile/domains.'}
  onclick={() => {
    currentEditId = null;
    applyFormState(FORM_DEFAULTS);
    showAdminModal = true;
  }}
  aria-label={data.tenantVerified ?
    'Administrator hinzufügen'
  : 'Administrator hinzufügen (deaktiviert: Domain nicht verifiziert)'}
>
  <i class="fas fa-user-plus"></i>
</button>

<!-- Add/Edit Admin Modal Component -->
<AdminFormModal
  show={showAdminModal}
  {isEditMode}
  {modalTitle}
  {allAreas}
  {allDepartments}
  {submitting}
  {messages}
  {positionOptions}
  {labels}
  bind:formFirstName
  bind:formLastName
  bind:formEmail
  bind:formEmailConfirm
  bind:formPassword
  bind:formPasswordConfirm
  bind:formEmployeeNumber
  bind:formPositionIds
  bind:formNotes
  bind:formIsActive
  bind:formHasFullAccess
  bind:formAreaIds
  bind:formDepartmentIds
  onclose={closeAdminModal}
  onsubmit={(e: Event) => {
    e.preventDefault();
    void saveAdmin();
  }}
  onupgrade={canUpgrade ? upgradeAdmin : undefined}
  ondowngrade={canUpgrade ? downgradeAdmin : undefined}
  resetLinkTarget={isEditMode && currentEditId !== null ?
    (() => {
      const a = allAdmins.find((x) => x.id === currentEditId);
      return a !== undefined ? { id: a.id, email: a.email } : undefined;
    })()
  : undefined}
/>

<!-- Availability Modal Component -->
<AvailabilityModal
  show={showAvailabilityModal}
  person={availabilityAdmin}
  submitting={availabilitySubmitting}
  bind:availabilityStatus
  bind:availabilityStart
  bind:availabilityEnd
  bind:availabilityReason
  bind:availabilityNotes
  onclose={closeAvailabilityModal}
  onsave={saveAvailability}
  onmanage={(uuid: string) => {
    closeAvailabilityModal();
    void goto(`/manage-admins/availability/${uuid}`);
  }}
/>

<!-- Delete Modals Component -->
<DeleteModals
  show={showDeleteModal}
  oncancel={() => {
    showDeleteModal = false;
    deleteAdminId = null;
  }}
  onconfirm={deleteAdmin}
/>

<!-- Role Change Confirm Modals (Upgrade/Downgrade) -->
<RoleChangeModals
  showUpgradeModal={showUpgradeConfirmModal}
  showDowngradeModal={showDowngradeConfirmModal}
  {upgradeLoading}
  {downgradeLoading}
  oncloseUpgrade={() => {
    showUpgradeConfirmModal = false;
    upgradeAdminId = null;
  }}
  oncloseDowngrade={() => {
    showDowngradeConfirmModal = false;
    downgradeAdminId = null;
  }}
  onconfirmUpgrade={() => {
    void confirmUpgradeAdmin();
  }}
  onconfirmDowngrade={() => {
    void confirmDowngradeAdmin();
  }}
/>
