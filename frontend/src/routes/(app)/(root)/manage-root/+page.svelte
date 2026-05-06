<script lang="ts">
  /**
   * Manage Root Users — Page Component (Phase 5.2.2 URL-driven state)
   * @module manage-root/+page
   *
   * Mirrors `manage-admins/+page.svelte` (§4.2) per
   * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §5.2.2. URL holds pagination +
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
  import { showSuccessAlert, showWarningAlert, showErrorAlert } from '$lib/stores/toast';
  import { resolvePositionDisplay } from '$lib/types/hierarchy-labels';
  import { getApiClient } from '$lib/utils/api-client';
  import { createLogger } from '$lib/utils/logger';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import { createRootMessages } from './_lib/constants';
  import DeleteModals from './_lib/DeleteModals.svelte';
  import {
    executeSaveRootUser,
    executeDeleteRootUser,
    executeSaveAvailability,
  } from './_lib/page-actions';
  import RootUserModal from './_lib/RootUserModal.svelte';
  import {
    getStatusBadgeClass,
    getStatusLabel,
    formatDate,
    getAvatarColor,
    populateFormFromUser,
    getDefaultFormValues,
    validateEmailMatch,
    validatePasswordMatch,
    getAvailabilityBadge,
    getPlannedAvailability,
    getTruncatedNotes,
  } from './_lib/utils';

  import type { PageData } from './$types';
  import type { FormIsActiveStatus, AvailabilityStatus } from './_lib/types';

  const apiClient = getApiClient();
  const log = createLogger('ManageRootPage');

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
  // ============================================================================

  const { data }: { data: PageData } = $props();

  // SSR data via $derived — updates when invalidateAll() / goto() reruns load.
  // `rootUsers` already represents the current page slice (server-paginated).
  const rootUsers = $derived(data.rootUsers);
  const positionOptions = $derived(data.positionOptions);
  const pagination = $derived(data.pagination);
  const searchTerm = $derived(data.search);
  // `number | 'all'` — numeric IS_ACTIVE codes, single conversion in load.
  const statusFilter = $derived(data.statusFilter);

  // Hierarchy labels from layout data inheritance (A6)
  const labels = $derived(data.hierarchyLabels);
  const messages = $derived(createRootMessages(labels));

  // ============================================================================
  // CLIENT STATE — only modal open/close + form fields are local.
  // ============================================================================

  // Error state (legacy — load function never throws now, kept for forward-compat).
  const error = $state<string | null>(null);

  // Modal States
  let showRootModal = $state(false);
  let showDeleteModal = $state(false);
  let showAvailabilityModal = $state(false);

  // Availability Modal State
  let availabilityUserId = $state<number | null>(null);
  let availabilityStatus = $state<AvailabilityStatus>('available');
  let availabilityStart = $state('');
  let availabilityEnd = $state('');
  let availabilityReason = $state('');
  let availabilityNotes = $state('');
  let availabilitySubmitting = $state(false);

  // Edit State
  let currentEditId = $state<number | null>(null);
  let deleteUserId = $state<number | null>(null);

  // Form fields (bindable to modal)
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

  // Derived: Current user for availability modal. With server-side pagination
  // the user may not be in the current slice if the user navigates pages
  // while the modal is open — `find` returns undefined → fallback to null.
  const availabilityUser = $derived(
    availabilityUserId !== null ?
      (rootUsers.find((u) => u.id === availabilityUserId) ?? null)
    : null,
  );

  // ============================================================================
  // URL HELPERS — single source of truth for page/search/status
  // ============================================================================

  const BASE_PATH = '/manage-root';

  // Default status filter — must mirror `+page.server.ts` STATUS_FILTER default
  // (currently `'1'`, IS_ACTIVE.ACTIVE). Stripping this value from the URL
  // keeps the canonical first-page URL clean (`/manage-root`) per ADR-058.
  const DEFAULT_STATUS_FILTER = 1;

  /**
   * Build an href for a target page, preserving current search + status.
   * `buildPaginatedHref` skips defaults (page=1 / search='' / undefined),
   * so canonical first-page URLs stay clean (`/manage-root`).
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
  // HELPERS
  // ============================================================================

  function resetForm(): void {
    const d = getDefaultFormValues();
    formFirstName = d.firstName;
    formLastName = d.lastName;
    formEmail = d.email;
    formEmailConfirm = d.emailConfirm;
    formPassword = d.password;
    formPasswordConfirm = d.passwordConfirm;
    formEmployeeNumber = d.employeeNumber;
    formPositionIds = [];
    formNotes = d.notes;
    formIsActive = d.isActive;
    emailError = false;
    passwordError = false;
  }

  // ============================================================================
  // API FUNCTIONS - Level 3: invalidateAll() after mutations
  // ============================================================================

  async function saveUser(): Promise<void> {
    submitting = true;
    try {
      const result = await executeSaveRootUser(
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
        },
        currentEditId,
        isEditMode,
        log,
      );

      if (result.validationError === 'email') {
        emailError = true;
        return;
      }
      if (result.validationError === 'password') {
        passwordError = true;
        return;
      }
      if (result.validationError === 'position') {
        showWarningAlert(messages.SELECT_POSITION_ERROR);
        return;
      }
      if (result.validationError === 'employee_number') {
        showWarningAlert(messages.EMPLOYEE_NUMBER_REQUIRED);
        return;
      }

      if (result.success) {
        showSuccessAlert(isEditMode ? messages.SUCCESS_UPDATED : messages.SUCCESS_CREATED);
        closeRootModal();
        // Retrigger SSR load on the SAME URL (preserves ?page / ?search / ?isActive)
        await invalidateAll();
      } else {
        showErrorAlert(result.errorMessage ?? messages.ERROR_SAVING);
      }
    } finally {
      submitting = false;
    }
  }

  async function deleteUser(): Promise<void> {
    const userIdToDelete = deleteUserId;
    if (userIdToDelete === null) return;

    const result = await executeDeleteRootUser(userIdToDelete, log);
    if (result.success) {
      showSuccessAlert(messages.SUCCESS_DELETED);
      closeDeleteModal();
      await invalidateAll();
    } else {
      showErrorAlert(result.errorMessage ?? messages.ERROR_DELETING);
    }
  }

  // ============================================================================
  // AVAILABILITY MODAL HANDLERS
  // NOTE: Modal is CREATE-only. PUT/UPDATE is on history page.
  // ============================================================================

  function openAvailabilityModal(userId: number): void {
    const user = rootUsers.find((u) => u.id === userId);
    if (!user) return;

    availabilityUserId = userId;
    availabilityStatus = 'available';
    availabilityStart = '';
    availabilityEnd = '';
    availabilityReason = '';
    availabilityNotes = '';
    showAvailabilityModal = true;
  }

  function closeAvailabilityModal(): void {
    showAvailabilityModal = false;
    availabilityUserId = null;
    availabilityStatus = 'available';
    availabilityStart = '';
    availabilityEnd = '';
    availabilityReason = '';
    availabilityNotes = '';
  }

  async function saveAvailability(): Promise<void> {
    if (availabilityUserId === null) return;

    availabilitySubmitting = true;
    try {
      const result = await executeSaveAvailability(
        availabilityUserId,
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
        return;
      }
      if (result.validationError === 'end_before_start') {
        showErrorAlert('Bis-Datum muss nach oder gleich Von-Datum sein.');
        return;
      }

      if (result.success) {
        closeAvailabilityModal();
        await invalidateAll();
        showSuccessAlert('Verfügbarkeit aktualisiert');
      } else {
        showErrorAlert(result.errorMessage ?? 'Fehler beim Speichern der Verfügbarkeit');
      }
    } finally {
      availabilitySubmitting = false;
    }
  }

  function navigateToAvailabilityPage(uuid: string): void {
    closeAvailabilityModal();
    void goto(resolve(`/manage-root/availability/${uuid}`));
  }

  // ============================================================================
  // MODAL HANDLERS
  // ============================================================================

  function openAddModal(): void {
    currentEditId = null;
    resetForm();
    showRootModal = true;
  }

  function openEditModal(userId: number): void {
    const user = rootUsers.find((u) => u.id === userId);
    if (!user) return;
    currentEditId = userId;
    const f = populateFormFromUser(user);
    formFirstName = f.firstName;
    formLastName = f.lastName;
    formEmail = f.email;
    formEmailConfirm = f.emailConfirm;
    formPassword = f.password;
    formPasswordConfirm = f.passwordConfirm;
    formEmployeeNumber = f.employeeNumber;
    formPositionIds = [];
    void loadUserPositions(userId);
    formNotes = f.notes;
    formIsActive = f.isActive;
    emailError = false;
    passwordError = false;
    showRootModal = true;
  }

  function closeRootModal(): void {
    showRootModal = false;
    currentEditId = null;
    resetForm();
  }

  // Preserved as dead-but-intentional after masterplan §5.2 / ADR-055:
  // the row-level Delete button is now permanently disabled (cross-root
  // immutability — Layer 1 UX hint). The downstream chain (DeleteModals
  // markup, deleteUser, closeDeleteModal, deleteUserId, executeDeleteRootUser)
  // stays in place because removing it would exceed Step 5.2 scope and
  // delete behaviour may be revived under a future permission-gated flow.
  // `_` prefix silences `@typescript-eslint/no-unused-vars` per the repo's
  // `varsIgnorePattern: '^_|^\\$'` (frontend/eslint.config.mjs:280).
  function _openDeleteModal(userId: number): void {
    deleteUserId = userId;
    showDeleteModal = true;
  }

  function closeDeleteModal(): void {
    showDeleteModal = false;
    deleteUserId = null;
  }

  // ============================================================================
  // FORM-VALIDATION HELPERS (passed to RootUserModal)
  // ============================================================================

  function handleFormSubmit(e: Event): void {
    e.preventDefault();
    void saveUser();
  }

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
</script>

<svelte:head>
  <title>{messages.PAGE_TITLE}</title>
</svelte:head>

<div class="container">
  <div class="card">
    <div class="card__header">
      <h2 class="card__title">
        <i class="fas fa-shield-alt mr-2"></i>{messages.PAGE_HEADING}
      </h2>
      <p class="mt-2 text-(--color-text-secondary)">
        {messages.PAGE_DESCRIPTION}
      </p>

      <div class="mt-6 flex items-center justify-between gap-4">
        <div
          class="toggle-group"
          id="root-status-toggle"
        >
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 1}
            onclick={() => {
              handleStatusToggle(1);
            }}
          >
            <i class="fas fa-user-check"></i> Aktive
          </button>
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 0}
            onclick={() => {
              handleStatusToggle(0);
            }}
          >
            <i class="fas fa-user-times"></i> Inaktive
          </button>
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 3}
            onclick={() => {
              handleStatusToggle(3);
            }}
          >
            <i class="fas fa-archive"></i> Archiviert
          </button>
          <button
            type="button"
            class="toggle-group__btn"
            class:active={statusFilter === 'all'}
            onclick={() => {
              handleStatusToggle('all');
            }}
          >
            <i class="fas fa-users"></i> Alle
          </button>
        </div>

        <div class="search-input-wrapper max-w-80">
          <div
            class="search-input"
            id="root-search-container"
          >
            <i class="search-input__icon fas fa-search"></i>
            <input
              type="search"
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
              onclick={clearSearch}><i class="fas fa-times"></i></button
            >
          </div>
        </div>
      </div>
    </div>

    <div class="card__body">
      <div class="alert alert--warning mb-4">
        <div class="alert__icon"><i class="fas fa-shield-alt"></i></div>
        <div class="alert__content">
          <div class="alert__title">{messages.SECURITY_TITLE}</div>
          <div class="alert__message">{messages.SECURITY_MESSAGE}</div>
        </div>
      </div>

      {#if error}
        <div class="p-6 text-center">
          <i class="fas fa-exclamation-triangle mb-4 text-4xl text-(--color-danger)"></i>
          <p class="text-(--color-text-secondary)">{error}</p>
          <button
            type="button"
            class="btn btn-primary mt-4"
            onclick={() => invalidateAll()}>Erneut versuchen</button
          >
        </div>
      {:else if rootUsers.length === 0}
        <div class="empty-state">
          <div class="empty-state__icon"><i class="fas fa-shield-alt"></i></div>
          <h3 class="empty-state__title">{messages.NO_USERS_FOUND}</h3>
          <p class="empty-state__description">{messages.CREATE_FIRST_USER}</p>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!data.tenantVerified}
            title={data.tenantVerified ? undefined : (
              'Verifiziere zuerst Deine Firmen-Domain unter /settings/company-profile/domains.'
            )}
            onclick={openAddModal}><i class="fas fa-plus"></i> Root-Benutzer hinzufügen</button
          >
        </div>
      {:else}
        <div class="table-responsive">
          <table class="data-table data-table--hover data-table--striped data-table--actions-hover">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>E-Mail</th>
                <th>Personalnummer</th>
                <th>Position</th>
                <th>Status</th>
                <th>{messages.TH_AVAILABILITY}</th>
                <th>{messages.TH_PLANNED}</th>
                <th>{messages.TH_ADDITIONAL_INFO}</th>
                <th>{messages.TH_ABSENCE_NOTES}</th>
                <th>Erstellt am</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {#each rootUsers as user (user.id)}
                {@const avBadge = getAvailabilityBadge(user)}
                {@const planned = getPlannedAvailability(user)}
                {@const additionalInfo = getTruncatedNotes(user.notes)}
                {@const absenceNotes = getTruncatedNotes(user.availabilityNotes)}
                <tr>
                  <td>{user.id}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="avatar avatar--sm avatar--color-{getAvatarColor(user.id)}">
                        <span>{user.firstName.charAt(0)}{user.lastName.charAt(0)}</span>
                      </div>
                      <span>{user.firstName} {user.lastName}</span>
                    </div>
                  </td>
                  <td>{user.email}</td>
                  <td>{user.employeeNumber ?? '-'}</td>
                  <td
                    >{user.position !== undefined ?
                      resolvePositionDisplay(user.position, labels)
                    : '-'}</td
                  >
                  <td>
                    <span class="badge {getStatusBadgeClass(user.isActive)}">
                      {getStatusLabel(user.isActive)}
                    </span>
                  </td>
                  <td>
                    <span class="badge {avBadge.class}">
                      {#if avBadge.icon}<i class="fas {avBadge.icon} mr-1"></i>{/if}
                      {avBadge.text}
                    </span>
                  </td>
                  <td>{planned}</td>
                  <td title={additionalInfo.title}>{additionalInfo.text}</td>
                  <td title={absenceNotes.title}>{absenceNotes.text}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="action-icon action-icon--edit"
                        title="Bearbeiten"
                        onclick={() => {
                          openEditModal(user.id);
                        }}><i class="fas fa-edit"></i></button
                      >
                      <button
                        type="button"
                        class="action-icon action-icon--info"
                        title="Verfügbarkeit bearbeiten"
                        aria-label="Verfügbarkeit bearbeiten"
                        onclick={() => {
                          openAvailabilityModal(user.id);
                        }}><i class="fas fa-calendar-alt"></i></button
                      >
                      <!--
                        Cross-root immutability: Delete is disabled because every
                        row on this page is another root account by construction
                        (SSR self-exclusion + API filter `?role=root`). Backend
                        Layer 2 (users.service.deleteUser) and Layer 4 (DB
                        trigger fn_prevent_cross_root_change) enforce the same
                        rule server-side; this `disabled` is the Layer 1 UX
                        hint per masterplan §5.2 / ADR-055. `_openDeleteModal`
                        retained as a noop reference for grep — the disabled
                        attribute prevents click events from firing on <button>.
                      -->
                      <button
                        type="button"
                        class="action-icon action-icon--delete"
                        disabled
                        title={messages.CROSS_ROOT_BLOCKED_TOOLTIP}
                        aria-label={messages.CROSS_ROOT_BLOCKED_TOOLTIP}
                        ><i class="fas fa-trash"></i></button
                      >
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if pagination.totalPages > 1}
          <nav
            class="pagination"
            id="root-pagination"
          >
            {#if pagination.hasPrev}
              <a
                class="pagination__btn pagination__btn--prev"
                href={pageHref(pagination.page - 1)}
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
                  <button
                    type="button"
                    class="pagination__page pagination__page--active"
                    aria-current="page"
                  >
                    {page}
                  </button>
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
        <div class="alert alert--info mt-6">
          <div class="alert__icon"><i class="fas fa-info-circle"></i></div>
          <div class="alert__content">
            <div class="alert__message">
              {messages.PROFILE_INFO}
              <a
                href={resolve('/root-profile')}
                class="text-blue-500 hover:underline">{messages.PROFILE_LINK_TEXT}</a
              >.
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<button
  type="button"
  class="btn-float"
  disabled={!data.tenantVerified}
  title={data.tenantVerified ?
    'Root-Benutzer hinzufügen'
  : 'Verifiziere zuerst Deine Firmen-Domain unter /settings/company-profile/domains.'}
  onclick={openAddModal}
  aria-label={data.tenantVerified ?
    'Root-Benutzer hinzufügen'
  : 'Root-Benutzer hinzufügen (deaktiviert: Domain nicht verifiziert)'}
  ><i class="fas fa-user-shield"></i></button
>

<!--
  lockDestructiveStatus=true: every row on this page is another root account
  (SSR filter excludes self, API filter `?role=root`), so the Edit modal's
  status dropdown must NEVER offer Inaktiv/Archiviert transitions. Backend
  Layer 4 trigger would 500 on such submits anyway — this is the Layer 1 UX
  hint per masterplan §5.2 / ADR-055.
-->
<RootUserModal
  {messages}
  show={showRootModal}
  {isEditMode}
  {modalTitle}
  {positionOptions}
  hierarchyLabels={labels}
  lockDestructiveStatus={true}
  bind:firstName={formFirstName}
  bind:lastName={formLastName}
  bind:email={formEmail}
  bind:emailConfirm={formEmailConfirm}
  bind:password={formPassword}
  bind:passwordConfirm={formPasswordConfirm}
  bind:employeeNumber={formEmployeeNumber}
  bind:positionIds={formPositionIds}
  bind:notes={formNotes}
  bind:isActive={formIsActive}
  {emailError}
  {passwordError}
  {submitting}
  onclose={closeRootModal}
  onsubmit={handleFormSubmit}
  onValidateEmails={validateEmails}
  onValidatePasswords={validatePasswords}
/>

<DeleteModals
  show={showDeleteModal}
  oncancel={closeDeleteModal}
  onconfirm={deleteUser}
/>

<!-- Availability Modal Component -->
<AvailabilityModal
  show={showAvailabilityModal}
  person={availabilityUser}
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
