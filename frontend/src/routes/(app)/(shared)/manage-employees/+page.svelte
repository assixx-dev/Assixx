<script lang="ts">
  /**
   * Manage Employees - Page Component (Phase 4.1b URL-driven state)
   * @module manage-employees/+page
   *
   * Mirrors the Phase-3 reference impl (`manage-dummies/+page.svelte`) per
   * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.1b. URL holds pagination +
   * search + status-filter state — there is NO `$state` shadow of these.
   * Mutations call `invalidateAll()` to retrigger the load on the same URL,
   * so `?page=N`/`?search=...`/`?isActive=N` are preserved across mutations.
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import AvailabilityModal from '$lib/availability/AvailabilityModal.svelte';
  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { showToast } from '$lib/stores/toast';
  import { showSuccessAlert, showErrorAlert, showWarningAlert } from '$lib/utils';
  import { ApiError, getApiClient, getApiErrorMessage } from '$lib/utils/api-client';
  import { createLogger } from '$lib/utils/logger';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  const log = createLogger('ManageEmployeesPage');

  // Local modules
  import ConfirmModal from '$design-system/components/confirm-modal/ConfirmModal.svelte';

  import {
    saveEmployee as apiSaveEmployee,
    deleteEmployee as apiDeleteEmployee,
    updateEmployeeAvailability as apiUpdateAvailability,
    upgradeToAdmin as apiUpgradeToAdmin,
    syncTeamMemberships,
    buildEmployeePayload,
  } from './_lib/api';
  import { createMessages } from './_lib/constants';
  import DeleteModals from './_lib/DeleteModals.svelte';
  import EmployeeFormModal from './_lib/EmployeeFormModal.svelte';
  import EmployeeTableRow from './_lib/EmployeeTableRow.svelte';
  import {
    populateFormFromEmployee,
    getDefaultFormValues,
    validateEmailMatch,
    validatePasswordMatch,
    validateSaveEmployeeForm,
    validateAvailabilityForm,
    buildAvailabilityPayload,
  } from './_lib/utils';

  import type { PageData } from './$types';
  import type { FormIsActiveStatus, AvailabilityStatus } from './_lib/types';

  // ============================================================================
  // SSR DATA — URL is the single source of truth for page / search / status.
  // FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.1b: there is NO client `$state`
  // shadow of these — every change goes through `goto()` → load re-run.
  // ============================================================================

  const { data }: { data: PageData } = $props();

  // SSR data via $derived — updates when invalidateAll() / goto() reruns load.
  // `employees` already represents the current page slice (server-paginated).
  const employees = $derived(data.employees);
  const allTeams = $derived(data.teams);
  const positionOptions = $derived(data.positionOptions);
  const pagination = $derived(data.pagination);
  const searchTerm = $derived(data.search);
  // `number | 'all'` — numeric IS_ACTIVE codes, single conversion in load.
  const statusFilter = $derived(data.statusFilter);

  // Hierarchy labels (propagated from layout)
  const labels = $derived(data.hierarchyLabels);
  const messages = $derived(createMessages(labels));

  const apiClient = getApiClient();

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

  // Lead-View: Employees can Read+Edit but NOT Create/Delete
  const canMutate = $derived(data.user?.role === 'root' || data.user?.role === 'admin');

  // Permission delegation: show shield button (backend checks actual permission)
  const canManagePermissions = $derived(canMutate || data.orgScope.isAnyLead);

  // Permission: Only root or admin with has_full_access may upgrade roles
  const canUpgrade = $derived(
    data.user !== null &&
      (data.user.role === 'root' || (data.user.role === 'admin' && data.user.hasFullAccess)),
  );

  // ============================================================================
  // CLIENT STATE — only modal open/close + form fields are local. Pagination,
  // search, and status filter are URL-driven via the helpers below.
  // ============================================================================

  // Error state (legacy — load function returns `permissionDenied` instead of
  // throwing, so this block is rarely reached. Kept for forward-compat.)
  const error = $state<string | null>(null);

  // Modal States
  let showEmployeeModal = $state(false);
  let showDeleteModal = $state(false);
  let showAvailabilityModal = $state(false);
  let showUpgradeConfirmModal = $state(false);
  let upgradeEmployeeId = $state<number | null>(null);
  let upgradeLoading = $state(false);

  // Availability Modal State
  let availabilityEmployeeId = $state<number | null>(null);
  let availabilityStatus = $state<AvailabilityStatus>('available');
  let availabilityStart = $state('');
  let availabilityEnd = $state('');
  let availabilityReason = $state('');
  let availabilityNotes = $state('');
  let availabilitySubmitting = $state(false);

  // Edit State
  let currentEditId = $state<number | null>(null);
  let deleteEmployeeId = $state<number | null>(null);
  let originalTeamIds = $state<number[]>([]);

  // Form Fields (for EmployeeFormModal)
  let formFirstName = $state('');
  let formLastName = $state('');
  let formEmail = $state('');
  let formEmailConfirm = $state('');
  let formPassword = $state('');
  let formPasswordConfirm = $state('');
  let formEmployeeNumber = $state('');
  let formPositionIds = $state<string[]>([]);
  let formPhone = $state('');
  let formDateOfBirth = $state('');
  let formNotes = $state('');
  let formIsActive = $state<FormIsActiveStatus>(1);
  let formTeamIds = $state<number[]>([]);

  // Validation State
  let emailError = $state(false);
  let passwordError = $state(false);
  let submitting = $state(false);

  // Search input → URL debouncer. Local-only; URL is the authoritative state.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 300;

  // ============================================================================
  // DERIVED VALUES
  // ============================================================================

  const isEditMode = $derived(currentEditId !== null);
  const modalTitle = $derived(isEditMode ? messages.MODAL_TITLE_EDIT : messages.MODAL_TITLE_ADD);

  // Derived: Current employee for availability modal. If the user navigates
  // pages while the modal is open, the employee may no longer be in the
  // current page slice — `find` returns undefined → fallback to null.
  const availabilityEmployee = $derived(
    availabilityEmployeeId !== null ?
      (employees.find((e) => e.id === availabilityEmployeeId) ?? null)
    : null,
  );

  // ============================================================================
  // URL HELPERS — single source of truth for page/search/status
  // ============================================================================

  const BASE_PATH = '/manage-employees';

  // Default status filter — must mirror `+page.server.ts` STATUS_FILTER default
  // (currently `'1'`, IS_ACTIVE.ACTIVE). Stripping this value from the URL
  // keeps the canonical first-page URL clean (`/manage-employees`) per ADR-058.
  const DEFAULT_STATUS_FILTER = 1;

  /**
   * Build an href for a target page, preserving current search + status.
   * `buildPaginatedHref` skips defaults (page=1 / search='' / undefined),
   * so canonical first-page URLs stay clean (`/manage-employees`).
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
  // API FUNCTIONS - Level 3: invalidateAll() after mutations
  // ============================================================================

  async function saveEmployee(): Promise<void> {
    submitting = true;

    // Validate required fields (client-side toast instead of native browser tooltip)
    if (formPositionIds.length === 0) {
      showWarningAlert('Bitte wählen Sie mindestens eine Position aus');
      submitting = false;
      return;
    }
    if (formEmployeeNumber.trim() === '') {
      showWarningAlert('Bitte geben Sie eine Personalnummer ein');
      submitting = false;
      return;
    }

    // Validate form fields
    const validationError = validateSaveEmployeeForm(
      formEmail,
      formEmailConfirm,
      formPassword,
      formPasswordConfirm,
      isEditMode,
    );

    if (validationError !== null) {
      emailError = validationError === 'email';
      passwordError = validationError === 'password';
      submitting = false;
      return;
    }

    try {
      const payload = buildEmployeePayload(
        {
          firstName: formFirstName,
          lastName: formLastName,
          email: formEmail,
          password: formPassword,
          positionIds: formPositionIds,
          phone: formPhone,
          dateOfBirth: formDateOfBirth,
          notes: formNotes,
          employeeNumber: formEmployeeNumber,
          isActive: formIsActive,
        },
        isEditMode,
      );

      const result = await apiSaveEmployee(payload, currentEditId);
      await syncTeamMemberships(result.id, formTeamIds, originalTeamIds, isEditMode);

      closeEmployeeModal();
      // Retrigger SSR load on the SAME URL (preserves ?page / ?search / ?isActive).
      await invalidateAll();

      if (!isEditMode && result.uuid !== null) {
        showToast({
          type: 'success',
          title: 'Mitarbeiter erstellt',
          message: 'Berechtigungen jetzt zuweisen?',
          duration: 8000,
          action: {
            label: 'Berechtigungen',
            href: `/manage-employees/permission/${result.uuid}`,
          },
        });
      } else {
        showSuccessAlert(isEditMode ? 'Mitarbeiter aktualisiert' : 'Mitarbeiter erstellt');
      }
    } catch (err: unknown) {
      log.error({ err }, 'Error saving employee');
      showErrorAlert(getApiErrorMessage(err, messages.ERROR_SAVING));
    } finally {
      submitting = false;
    }
  }

  /** Step 1: Inline confirm clicked → open warning modal */
  function upgradeEmployee(): void {
    if (currentEditId === null) return;
    if (!canUpgrade) {
      showWarningAlert(messages.UPGRADE_UNAUTHORIZED);
      return;
    }
    upgradeEmployeeId = currentEditId;
    closeEmployeeModal();
    showUpgradeConfirmModal = true;
  }

  /** Step 2: Warning modal confirmed → PUT role change */
  async function confirmUpgradeEmployee(): Promise<void> {
    if (upgradeEmployeeId === null) return;
    if (!canUpgrade) {
      showWarningAlert(messages.UPGRADE_UNAUTHORIZED);
      return;
    }
    const userId = upgradeEmployeeId;
    upgradeLoading = true;

    try {
      showUpgradeConfirmModal = false;
      upgradeEmployeeId = null;
      await apiUpgradeToAdmin(userId);
      await invalidateAll();
      showSuccessAlert(messages.UPGRADE_SUCCESS);
    } catch (err: unknown) {
      log.error({ err }, 'Error upgrading employee to admin');
      showErrorAlert(err instanceof Error ? err.message : messages.UPGRADE_ERROR);
    } finally {
      upgradeLoading = false;
    }
  }

  function closeUpgradeConfirmModal(): void {
    showUpgradeConfirmModal = false;
    upgradeEmployeeId = null;
  }

  async function deleteEmployee(): Promise<void> {
    const idToDelete = deleteEmployeeId;
    if (idToDelete === null) return;

    // Reset state immediately to prevent double-clicks
    deleteEmployeeId = null;
    showDeleteModal = false;

    try {
      await apiDeleteEmployee(idToDelete);
      // Level 3: Trigger SSR refetch on the same URL
      await invalidateAll();
      showSuccessAlert('Mitarbeiter wurde gelöscht');
    } catch (err: unknown) {
      log.error({ err }, 'Error deleting employee');
      showErrorAlert(messages.ERROR_DELETING);
    }
  }

  // ============================================================================
  // MODAL HANDLERS
  // ============================================================================

  function openAddModal(): void {
    currentEditId = null;
    resetForm();
    showEmployeeModal = true;
  }

  function openEditModal(employeeId: number): void {
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) return;

    currentEditId = employeeId;
    const formData = populateFormFromEmployee(employee);

    formFirstName = formData.firstName;
    formLastName = formData.lastName;
    formEmail = formData.email;
    formEmailConfirm = formData.emailConfirm;
    formPassword = formData.password;
    formPasswordConfirm = formData.passwordConfirm;
    formEmployeeNumber = formData.employeeNumber;
    formPhone = formData.phone;

    // Load N:M positions from API
    void loadUserPositions(employeeId);
    formDateOfBirth = formData.dateOfBirth;
    formNotes = formData.notes;
    formIsActive = formData.isActive;
    formTeamIds = formData.teamIds;
    // Store original team IDs for diff calculation on save
    originalTeamIds = [...formData.teamIds];
    emailError = false;
    passwordError = false;
    showEmployeeModal = true;
  }

  function openDeleteModal(employeeId: number): void {
    deleteEmployeeId = employeeId;
    showDeleteModal = true;
  }

  function closeEmployeeModal(): void {
    showEmployeeModal = false;
    currentEditId = null;
    resetForm();
  }

  function closeDeleteModal(): void {
    showDeleteModal = false;
    deleteEmployeeId = null;
  }

  // Availability Modal Handlers
  // NOTE: Modal is CREATE-only. PUT/UPDATE is on history page.
  function openAvailabilityModal(employeeId: number): void {
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) return;

    availabilityEmployeeId = employeeId;
    // Reset to defaults - this modal is for CREATE only
    availabilityStatus = 'available';
    availabilityStart = '';
    availabilityEnd = '';
    availabilityReason = '';
    availabilityNotes = '';
    showAvailabilityModal = true;
  }

  function closeAvailabilityModal(): void {
    showAvailabilityModal = false;
    availabilityEmployeeId = null;
    availabilityStatus = 'available';
    availabilityStart = '';
    availabilityEnd = '';
    availabilityReason = '';
    availabilityNotes = '';
  }

  async function saveAvailability(): Promise<void> {
    if (availabilityEmployeeId === null) return;

    const formData = {
      status: availabilityStatus,
      start: availabilityStart,
      end: availabilityEnd,
      reason: availabilityReason,
      notes: availabilityNotes,
    };

    const validationError = validateAvailabilityForm(formData);
    if (validationError === 'dates_required') {
      showErrorAlert('Von-Datum und Bis-Datum sind erforderlich.');
      return;
    }
    if (validationError === 'end_before_start') {
      showErrorAlert('Bis-Datum muss nach oder gleich Von-Datum sein.');
      return;
    }

    availabilitySubmitting = true;
    try {
      const payload = buildAvailabilityPayload(formData);
      await apiUpdateAvailability(availabilityEmployeeId, payload);
      closeAvailabilityModal();
      await invalidateAll();
      showSuccessAlert('Verfügbarkeit aktualisiert');
    } catch (err: unknown) {
      log.error({ err }, 'Error updating availability');
      const message =
        err instanceof ApiError ? err.message : 'Fehler beim Speichern der Verfügbarkeit';
      showErrorAlert(message);
    } finally {
      availabilitySubmitting = false;
    }
  }

  function navigateToAvailabilityPage(uuid: string): void {
    // Navigate to the full availability history page
    closeAvailabilityModal();
    void goto(`/manage-employees/availability/${uuid}`);
  }

  function navigateToPermissionPage(uuid: string): void {
    void goto(`/manage-employees/permission/${uuid}`);
  }

  function resetForm(): void {
    const defaults = getDefaultFormValues();
    formFirstName = defaults.firstName;
    formLastName = defaults.lastName;
    formEmail = defaults.email;
    formEmailConfirm = defaults.emailConfirm;
    formPassword = defaults.password;
    formPasswordConfirm = defaults.passwordConfirm;
    formEmployeeNumber = defaults.employeeNumber;
    formPositionIds = [];
    formPhone = defaults.phone;
    formDateOfBirth = defaults.dateOfBirth;
    formNotes = defaults.notes;
    formIsActive = defaults.isActive;
    formTeamIds = defaults.teamIds;
    originalTeamIds = []; // Reset original teams for diff calculation
    emailError = false;
    passwordError = false;
  }

  // ============================================================================
  // FORM VALIDATION HANDLERS
  // ============================================================================

  function validateEmails(): void {
    emailError = !validateEmailMatch(formEmail, formEmailConfirm);
  }

  function validatePasswords(): void {
    // Only show error if user has typed in the confirm field
    passwordError =
      formPasswordConfirm !== '' ?
        !validatePasswordMatch(formPassword, formPasswordConfirm)
      : false;
  }

  function handleFormSubmit(e: Event): void {
    e.preventDefault();
    void saveEmployee();
  }
</script>

<svelte:head>
  <title>Mitarbeiterverwaltung - Assixx</title>
</svelte:head>

{#if data.permissionDenied}
  <PermissionDenied addonName="die Mitarbeiterverwaltung" />
{:else}
  <div class="container">
    <div class="card">
      <div class="card__header">
        <h2 class="card__title">
          <i class="fas fa-users mr-2"></i>
          Mitarbeiterverwaltung
        </h2>
        <p class="mt-2 text-(--color-text-secondary)">Mitarbeiter erstellen und verwalten</p>

        <div
          class="mt-6 flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between"
        >
          <!-- Status Toggle Group — numeric IS_ACTIVE codes (0/1/3 + 'all') -->
          <div
            class="toggle-group"
            id="employee-status-toggle"
          >
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 1}
              title="Aktive Mitarbeiter"
              onclick={() => {
                handleStatusToggle(1);
              }}
            >
              <i class="fas fa-user-check"></i>
              Aktive
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 0}
              title="Inaktive Mitarbeiter"
              onclick={() => {
                handleStatusToggle(0);
              }}
            >
              <i class="fas fa-user-times"></i>
              Inaktive
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 3}
              title="Archivierte Mitarbeiter"
              onclick={() => {
                handleStatusToggle(3);
              }}
            >
              <i class="fas fa-archive"></i>
              Archiviert
            </button>
            <button
              type="button"
              class="toggle-group__btn"
              class:active={statusFilter === 'all'}
              title="Alle Mitarbeiter"
              onclick={() => {
                handleStatusToggle('all');
              }}
            >
              <i class="fas fa-users"></i>
              Alle
            </button>
          </div>

          <!-- Search Input — debounced URL update (300 ms), URL-driven -->
          <div class="search-input max-w-80">
            <i class="search-input__icon fas fa-search"></i>
            <input
              type="search"
              id="employee-search"
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
              onclick={() => invalidateAll()}
            >
              Erneut versuchen
            </button>
          </div>
        {:else if employees.length === 0}
          <div
            id="employees-empty"
            class="empty-state"
          >
            <div class="empty-state__icon">
              <i class="fas fa-users"></i>
            </div>
            <h3 class="empty-state__title">{messages.NO_EMPLOYEES_FOUND}</h3>
            <p class="empty-state__description">
              {messages.CREATE_FIRST_EMPLOYEE}
            </p>
            <button
              type="button"
              class="btn btn-primary"
              onclick={openAddModal}
            >
              <i class="fas fa-plus"></i>
              Mitarbeiter hinzufügen
            </button>
          </div>
        {:else}
          <div id="employees-table-content">
            <div class="table-responsive">
              <table
                class="data-table data-table--hover data-table--striped data-table--actions-hover"
                id="employees-table"
              >
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">E-Mail</th>
                    <th scope="col">Position</th>
                    <th scope="col">Personalnummer</th>
                    <th scope="col">Status</th>
                    <th scope="col">{messages.TH_AREAS}</th>
                    <th scope="col">{messages.TH_DEPARTMENTS}</th>
                    <th scope="col">{messages.TH_TEAMS}</th>
                    <th scope="col">Verfügbarkeit</th>
                    <th scope="col">Geplant</th>
                    <th scope="col">Zusätzliche Infos</th>
                    <th scope="col">Abwesenheitsnotiz</th>
                    <th scope="col">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {#each employees as employee (employee.id)}
                    <EmployeeTableRow
                      {employee}
                      {labels}
                      currentUserId={data.user?.id ?? 0}
                      {canManagePermissions}
                      {canMutate}
                      onedit={openEditModal}
                      onavailability={openAvailabilityModal}
                      onpermission={navigateToPermissionPage}
                      ondelete={openDeleteModal}
                    />
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- Pagination — URL-driven, anchor-based for native back/forward + right-click support -->
            {#if pagination.totalPages > 1}
              <nav
                class="pagination"
                id="employees-pagination"
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

  {#if canMutate}
    <!-- Floating Action Button (Root/Admin only) -->
    <button
      type="button"
      class="btn-float add-employee-btn"
      onclick={openAddModal}
      aria-label="Mitarbeiter hinzufügen"
    >
      <i class="fas fa-user-plus"></i>
    </button>
  {/if}

  <!-- Employee Form Modal Component -->
  <EmployeeFormModal
    show={showEmployeeModal}
    {isEditMode}
    {modalTitle}
    {allTeams}
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
    bind:formPhone
    bind:formDateOfBirth
    bind:formNotes
    bind:formIsActive
    bind:formTeamIds
    bind:emailError
    bind:passwordError
    onclose={closeEmployeeModal}
    onsubmit={handleFormSubmit}
    onvalidateemails={validateEmails}
    onvalidatepasswords={validatePasswords}
    onupgrade={canUpgrade ? upgradeEmployee : undefined}
    resetLinkTarget={isEditMode && currentEditId !== null && data.user?.role === 'root' ?
      (() => {
        const e = employees.find((x) => x.id === currentEditId);
        return e !== undefined ? { id: e.id, email: e.email } : undefined;
      })()
    : undefined}
  />

  <!-- Delete Modals Component -->
  <DeleteModals
    show={showDeleteModal}
    oncancel={closeDeleteModal}
    onconfirm={deleteEmployee}
  />

  <!-- Availability Modal Component -->
  <AvailabilityModal
    show={showAvailabilityModal}
    person={availabilityEmployee}
    submitting={availabilitySubmitting}
    bind:availabilityStatus
    bind:availabilityStart
    bind:availabilityEnd
    bind:availabilityReason
    bind:availabilityNotes
    onclose={closeAvailabilityModal}
    onsave={saveAvailability}
    onmanage={navigateToAvailabilityPage}
  />

  <!-- Upgrade Confirm Modal -->
  <ConfirmModal
    show={showUpgradeConfirmModal}
    id="upgrade-confirm-modal"
    title={messages.UPGRADE_TITLE}
    variant="warning"
    icon="fa-arrow-up"
    confirmLabel={messages.UPGRADE_CONFIRM_BUTTON}
    submitting={upgradeLoading}
    onconfirm={() => void confirmUpgradeEmployee()}
    oncancel={closeUpgradeConfirmModal}
  >
    <strong>{messages.UPGRADE_CONFIRM_MESSAGE}</strong>
  </ConfirmModal>
{/if}
