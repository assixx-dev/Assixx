<script lang="ts">
  import { onClickOutsideDropdown } from '$lib/actions/click-outside';
  import { DEFAULT_HIERARCHY_LABELS, type HierarchyLabels } from '$lib/types/hierarchy-labels';

  import { createMessages } from './constants';
  import {
    getStatusBadgeClass,
    getStatusLabel,
    getMembersDisplayText,
    getAssetsDisplayText,
    getDepartmentDisplayText,
    getLeaderDisplayText,
    toggleIdInArray,
  } from './utils';

  import type { Department, Admin, TeamMember, Asset, FormIsActiveStatus } from './types';

  /**
   * Team form modal — Hall is now READ-ONLY and inherited from the parent
   * Department (1:1 model, see migration
   * 20260505221345432_simplify-department-hall-1to1). The dropdown was
   * removed; the hall is shown as an info badge derived from the selected
   * Department's `hallId`/`hallName`.
   */
  interface Props {
    isEditMode: boolean;
    modalTitle: string;
    labels?: HierarchyLabels;
    formName: string;
    formDescription: string;
    formDepartmentId: number | null;
    formLeaderId: number | null;
    formDeputyLeaderId: number | null;
    formMemberIds: number[];
    formAssetIds: number[];
    formIsActive: FormIsActiveStatus;
    allDepartments: Department[];
    allLeaders: Admin[];
    allEmployees: TeamMember[];
    allAssets: Asset[];
    submitting: boolean;
    onclose: () => void;
    onsubmit: (data: {
      name: string;
      description: string;
      departmentId: number | null;
      leaderId: number | null;
      deputyLeaderId: number | null;
      memberIds: number[];
      assetIds: number[];
      isActive: FormIsActiveStatus;
    }) => void;
  }

  // Destructure all props directly from $props() for ESLint compatibility
  const {
    isEditMode,
    modalTitle,
    labels = DEFAULT_HIERARCHY_LABELS,
    formName,
    formDescription,
    formDepartmentId,
    formLeaderId,
    formDeputyLeaderId,
    formMemberIds,
    formAssetIds,
    formIsActive,
    allDepartments,
    allLeaders,
    allEmployees,
    allAssets,
    submitting,
    onclose,
    onsubmit,
  }: Props = $props();

  const messages = $derived(createMessages(labels));

  // Local form state - initialize with defaults, sync via $effect
  let localName = $state('');
  let localDescription = $state('');
  let localDepartmentId = $state<number | null>(null);
  let localLeaderId = $state<number | null>(null);
  let localDeputyLeaderId = $state<number | null>(null);
  let localMemberIds = $state<number[]>([]);
  let localAssetIds = $state<number[]>([]);
  let localIsActive = $state<FormIsActiveStatus>(1);

  // Sync props to local state when they change
  $effect(() => {
    localName = formName;
    localDescription = formDescription;
    localDepartmentId = formDepartmentId;
    localLeaderId = formLeaderId;
    localDeputyLeaderId = formDeputyLeaderId;
    localMemberIds = [...formMemberIds];
    localAssetIds = [...formAssetIds];
    localIsActive = formIsActive;
  });

  // Dropdown states (no hallDropdownOpen — hall is read-only now)
  let departmentDropdownOpen = $state(false);
  let leaderDropdownOpen = $state(false);
  let deputyLeaderDropdownOpen = $state(false);
  let membersDropdownOpen = $state(false);
  let assetsDropdownOpen = $state(false);
  let statusDropdownOpen = $state(false);

  // Filter: exclude current leader from members dropdown (leader is auto-member)
  const availableEmployees = $derived(
    allEmployees.filter((e: TeamMember) => e.id !== localLeaderId),
  );

  /**
   * Hall info derived from the selected department.
   * Read-only: the team inherits the hall from its parent department.
   */
  const inheritedHall = $derived.by((): { name: string | null; sourceDept: string | null } => {
    if (localDepartmentId === null) return { name: null, sourceDept: null };
    const dept = allDepartments.find((d: Department) => d.id === localDepartmentId);
    if (dept === undefined) return { name: null, sourceDept: null };
    return {
      name: dept.hallName ?? null,
      sourceDept: dept.name,
    };
  });

  function closeOtherDropdowns(except: string): void {
    if (except !== 'department') departmentDropdownOpen = false;
    if (except !== 'leader') leaderDropdownOpen = false;
    if (except !== 'deputyLeader') deputyLeaderDropdownOpen = false;
    if (except !== 'members') membersDropdownOpen = false;
    if (except !== 'assets') assetsDropdownOpen = false;
    if (except !== 'status') statusDropdownOpen = false;
  }

  function toggleDepartmentDropdown(e: MouseEvent): void {
    e.stopPropagation();
    closeOtherDropdowns('department');
    departmentDropdownOpen = !departmentDropdownOpen;
  }

  function selectDepartment(id: number | null): void {
    localDepartmentId = id;
    departmentDropdownOpen = false;
  }

  function toggleLeaderDropdown(e: MouseEvent): void {
    e.stopPropagation();
    closeOtherDropdowns('leader');
    leaderDropdownOpen = !leaderDropdownOpen;
  }

  function selectLeader(id: number | null): void {
    localLeaderId = id;
    leaderDropdownOpen = false;
  }

  function toggleDeputyLeaderDropdown(e: MouseEvent): void {
    e.stopPropagation();
    closeOtherDropdowns('deputyLeader');
    deputyLeaderDropdownOpen = !deputyLeaderDropdownOpen;
  }

  function selectDeputyLeader(id: number | null): void {
    localDeputyLeaderId = id;
    deputyLeaderDropdownOpen = false;
  }

  function toggleMembersDropdown(e: MouseEvent): void {
    e.stopPropagation();
    closeOtherDropdowns('members');
    membersDropdownOpen = !membersDropdownOpen;
  }

  function toggleMember(id: number): void {
    localMemberIds = toggleIdInArray(localMemberIds, id);
  }

  function toggleAssetsDropdown(e: MouseEvent): void {
    e.stopPropagation();
    closeOtherDropdowns('assets');
    assetsDropdownOpen = !assetsDropdownOpen;
  }

  function toggleAsset(id: number): void {
    localAssetIds = toggleIdInArray(localAssetIds, id);
  }

  function toggleStatusDropdown(e: MouseEvent): void {
    e.stopPropagation();
    closeOtherDropdowns('status');
    statusDropdownOpen = !statusDropdownOpen;
  }

  function selectStatus(status: FormIsActiveStatus): void {
    localIsActive = status;
    statusDropdownOpen = false;
  }

  function handleFormSubmit(e: Event): void {
    e.preventDefault();
    onsubmit({
      name: localName,
      description: localDescription,
      departmentId: localDepartmentId,
      leaderId: localLeaderId,
      deputyLeaderId: localDeputyLeaderId,
      memberIds: localMemberIds,
      assetIds: localAssetIds,
      isActive: localIsActive,
    });
  }

  // Capture-phase click-outside: works inside modals (bypasses stopPropagation)
  $effect(() => {
    return onClickOutsideDropdown(() => {
      departmentDropdownOpen = false;
      leaderDropdownOpen = false;
      deputyLeaderDropdownOpen = false;
      membersDropdownOpen = false;
      assetsDropdownOpen = false;
      statusDropdownOpen = false;
    });
  });
</script>

<div
  id="team-modal"
  class="modal-overlay modal-overlay--active"
  role="dialog"
  aria-modal="true"
  aria-labelledby="team-modal-title"
  tabindex="-1"
>
  <form
    class="ds-modal"
    onsubmit={handleFormSubmit}
  >
    <div class="ds-modal__header">
      <h3
        class="ds-modal__title"
        id="team-modal-title"
      >
        {modalTitle}
      </h3>
      <button
        type="button"
        class="ds-modal__close"
        aria-label="Schließen"
        onclick={onclose}
      >
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="ds-modal__body">
      <div class="form-field">
        <label
          class="form-field__label"
          for="team-name"
        >
          Name <span class="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="team-name"
          name="name"
          class="form-field__control"
          required
          bind:value={localName}
        />
      </div>

      <div class="form-field">
        <label
          class="form-field__label"
          for="team-description">Beschreibung</label
        >
        <textarea
          id="team-description"
          name="description"
          class="form-field__control"
          rows="3"
          bind:value={localDescription}
        ></textarea>
      </div>

      <div class="form-field">
        <label
          class="form-field__label"
          for="team-department">{messages.LABEL_DEPARTMENT}</label
        >
        <div
          class="dropdown"
          id="department-dropdown"
        >
          <button
            type="button"
            class="dropdown__trigger"
            class:active={departmentDropdownOpen}
            onclick={toggleDepartmentDropdown}
          >
            <span>{getDepartmentDisplayText(localDepartmentId, allDepartments, labels)}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div
            class="dropdown__menu"
            class:active={departmentDropdownOpen}
          >
            <button
              type="button"
              class="dropdown__option"
              onclick={() => {
                selectDepartment(null);
              }}
            >
              {messages.NO_DEPARTMENT}
            </button>
            {#each allDepartments as dept (dept.id)}
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  selectDepartment(dept.id);
                }}
              >
                {dept.name}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!--
        Hall is read-only: it is inherited from the selected Department
        (1:1 model after migration 20260505221345432_simplify-department-hall-1to1).
        To change the team's hall, the parent Department's hall must be changed.
      -->
      <div class="form-field">
        <label
          class="form-field__label"
          for="team-hall-display">{labels.hall}</label
        >
        <div
          id="team-hall-display"
          class="alert alert--info alert--sm"
          role="status"
          style="margin-bottom: var(--spacing-3);"
        >
          <span class="alert__icon">
            <i class="fas fa-lock"></i>
          </span>
          <div class="alert__content">
            {#if inheritedHall.name !== null}
              <p class="alert__message">
                <span class="badge badge--info"
                  ><i class="fas fa-building mr-1"></i>{inheritedHall.name}</span
                >
                <span class="ml-2 opacity-75">— Quelle: {inheritedHall.sourceDept ?? '—'}</span>
              </p>
              <p class="mt-2 text-sm opacity-75">
                Die Halle wird automatisch von der Abteilung übernommen. Änderungen erfolgen über
                die Abteilungs-Verwaltung.
              </p>
            {:else if localDepartmentId === null}
              <p class="alert__message">{messages.HALL_INFO_NO_DEPARTMENT}</p>
            {:else}
              <p class="alert__message">Die ausgewählte Abteilung hat keine Halle zugewiesen.</p>
            {/if}
          </div>
        </div>
      </div>

      <div class="form-field">
        <label
          class="form-field__label"
          for="team-lead">Leiter</label
        >
        <div
          class="alert alert--info alert--sm"
          style="margin-bottom: var(--spacing-3);"
        >
          <span class="alert__icon">
            <i class="fas fa-info-circle"></i>
          </span>
          <div class="alert__content">
            <p class="alert__message">
              Nur Mitarbeiter mit der Position &laquo;{messages.TEAM_LEAD_POSITION}&raquo; stehen
              zur Auswahl. Zuweisung über die
              <a href="/manage-employees">Mitarbeiterverwaltung</a>.
            </p>
          </div>
        </div>
        {#if allLeaders.length > 0}
          <div
            class="dropdown"
            id="team-lead-dropdown"
          >
            <button
              type="button"
              class="dropdown__trigger"
              class:active={leaderDropdownOpen}
              onclick={toggleLeaderDropdown}
            >
              <span>{getLeaderDisplayText(localLeaderId, allLeaders)}</span>
              <i class="fas fa-chevron-down"></i>
            </button>
            <div
              class="dropdown__menu"
              class:active={leaderDropdownOpen}
            >
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  selectLeader(null);
                }}
              >
                {messages.NO_LEADER}
              </button>
              {#each allLeaders as leader (leader.id)}
                <button
                  type="button"
                  class="dropdown__option"
                  onclick={() => {
                    selectLeader(leader.id);
                  }}
                >
                  {leader.firstName}
                  {leader.lastName}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="form-field">
        <label
          class="form-field__label"
          for="team-deputy-lead"
        >
          <i class="fas fa-user-shield mr-1"></i>
          Stellvertreter
        </label>
        {#if allLeaders.length > 0}
          <div
            class="dropdown"
            id="team-deputy-lead-dropdown"
          >
            <button
              type="button"
              class="dropdown__trigger"
              class:active={deputyLeaderDropdownOpen}
              onclick={toggleDeputyLeaderDropdown}
            >
              <span>{getLeaderDisplayText(localDeputyLeaderId, allLeaders)}</span>
              <i class="fas fa-chevron-down"></i>
            </button>
            <div
              class="dropdown__menu"
              class:active={deputyLeaderDropdownOpen}
            >
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  selectDeputyLeader(null);
                }}
              >
                — Kein Stellvertreter —
              </button>
              {#each allLeaders as leader (leader.id)}
                <button
                  type="button"
                  class="dropdown__option"
                  onclick={() => {
                    selectDeputyLeader(leader.id);
                  }}
                >
                  {leader.firstName}
                  {leader.lastName}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="form-field">
        <label
          class="form-field__label"
          for="team-members">Mitglieder</label
        >
        <div
          class="dropdown"
          id="team-members-dropdown"
        >
          <button
            type="button"
            class="dropdown__trigger"
            class:active={membersDropdownOpen}
            onclick={toggleMembersDropdown}
          >
            <span>{getMembersDisplayText(localMemberIds, availableEmployees)}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div
            class="dropdown__menu"
            class:active={membersDropdownOpen}
          >
            {#each availableEmployees as employee (employee.id)}
              <button
                type="button"
                class="dropdown__option dropdown__option--checkbox"
                onclick={() => {
                  toggleMember(employee.id);
                }}
              >
                <input
                  type="checkbox"
                  checked={localMemberIds.includes(employee.id)}
                  class="mr-2"
                  onclick={(e) => {
                    e.stopPropagation();
                  }}
                  onchange={() => {
                    toggleMember(employee.id);
                  }}
                />
                {employee.firstName}
                {employee.lastName}
              </button>
            {/each}
            {#if availableEmployees.length === 0}
              <div class="dropdown__option dropdown__option--disabled">
                {messages.NO_EMPLOYEES_AVAILABLE}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="form-field">
        <label
          class="form-field__label"
          for="team-assets">{messages.LABEL_ASSETS}</label
        >
        <div
          class="dropdown"
          id="team-assets-dropdown"
        >
          <button
            type="button"
            class="dropdown__trigger"
            class:active={assetsDropdownOpen}
            onclick={toggleAssetsDropdown}
          >
            <span>{getAssetsDisplayText(localAssetIds, allAssets, labels)}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div
            class="dropdown__menu"
            class:active={assetsDropdownOpen}
          >
            {#each allAssets as asset (asset.id)}
              <button
                type="button"
                class="dropdown__option dropdown__option--checkbox"
                onclick={() => {
                  toggleAsset(asset.id);
                }}
              >
                <input
                  type="checkbox"
                  checked={localAssetIds.includes(asset.id)}
                  class="mr-2"
                  onclick={(e) => {
                    e.stopPropagation();
                  }}
                  onchange={() => {
                    toggleAsset(asset.id);
                  }}
                />
                {asset.name}
              </button>
            {/each}
            {#if allAssets.length === 0}
              <div class="dropdown__option dropdown__option--disabled">
                {messages.NO_MACHINES_AVAILABLE}
              </div>
            {/if}
          </div>
        </div>
      </div>

      {#if isEditMode}
        <div class="form-field mt-6">
          <label
            class="form-field__label"
            for="team-is-active"
          >
            Status <span class="text-red-500">*</span>
          </label>
          <div
            class="dropdown"
            id="status-dropdown"
          >
            <button
              type="button"
              class="dropdown__trigger"
              class:active={statusDropdownOpen}
              onclick={toggleStatusDropdown}
            >
              <span class="badge {getStatusBadgeClass(localIsActive)}"
                >{getStatusLabel(localIsActive)}</span
              >
              <i class="fas fa-chevron-down"></i>
            </button>
            <div
              class="dropdown__menu"
              class:active={statusDropdownOpen}
            >
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  selectStatus(1);
                }}
              >
                <span class="badge badge--success">Aktiv</span>
              </button>
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  selectStatus(0);
                }}
              >
                <span class="badge badge--warning">Inaktiv</span>
              </button>
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  selectStatus(3);
                }}
              >
                <span class="badge badge--secondary">Archiviert</span>
              </button>
            </div>
          </div>
          <span class="form-field__hint mt-1 block">
            {messages.STATUS_HINT}
          </span>
        </div>
      {/if}
    </div>

    <div class="ds-modal__footer">
      <button
        type="button"
        class="btn btn-cancel"
        onclick={onclose}>Abbrechen</button
      >
      <button
        type="submit"
        class="btn btn-secondary"
        disabled={submitting}
      >
        {#if submitting}<span class="spinner-ring spinner-ring--sm mr-2"></span>{/if}
        Speichern
      </button>
    </div>
  </form>
</div>
