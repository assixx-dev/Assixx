<script lang="ts">
  import { onClickOutsideDropdown } from '$lib/actions/click-outside';
  import PickerTypeahead from '$lib/components/PickerTypeahead.svelte';
  import { DEFAULT_HIERARCHY_LABELS, type HierarchyLabels } from '$lib/types/hierarchy-labels';

  import { createMessages } from './constants';
  import {
    getStatusBadgeClass,
    getStatusLabel,
    getAssetsDisplayText,
    getDepartmentDisplayText,
    toggleIdInArray,
  } from './utils';

  import type { PickerOption } from '$lib/components/picker-typeahead-helpers';
  import type { Department, Asset, FormIsActiveStatus } from './types';

  /**
   * Team form modal.
   *
   * Hall is READ-ONLY and inherited from the parent Department (1:1 model,
   * migration 20260505221345432_simplify-department-hall-1to1).
   *
   * Lead + deputy + member candidates are sourced through PickerTypeahead
   * (FEAT_SERVER_DRIVEN_PAGINATION §4.12 §D23):
   *  - leader (single)  — `?isActive=1&position=team_lead`
   *  - deputy (single)  — same params
   *  - members (multi)  — `?isActive=1&role=employee`
   * Form-state surface is full PickerOption objects, NOT scalar IDs —
   * `handleFormSubmit` extracts `.id` for the backend payload.
   */
  interface Props {
    isEditMode: boolean;
    modalTitle: string;
    labels?: HierarchyLabels;
    formName: string;
    formDescription: string;
    formDepartmentId: number | null;
    formLeader: PickerOption | null;
    formDeputyLeader: PickerOption | null;
    formMembers: PickerOption[];
    formAssetIds: number[];
    formIsActive: FormIsActiveStatus;
    allDepartments: Department[];
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
    formLeader,
    formDeputyLeader,
    formMembers,
    formAssetIds,
    formIsActive,
    allDepartments,
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
  let localLeader = $state<PickerOption | null>(null);
  let localDeputyLeader = $state<PickerOption | null>(null);
  let localMembers = $state<PickerOption[]>([]);
  let localAssetIds = $state<number[]>([]);
  let localIsActive = $state<FormIsActiveStatus>(1);

  // Sync props to local state when they change
  $effect(() => {
    localName = formName;
    localDescription = formDescription;
    localDepartmentId = formDepartmentId;
    localLeader = formLeader;
    localDeputyLeader = formDeputyLeader;
    localMembers = [...formMembers];
    localAssetIds = [...formAssetIds];
    localIsActive = formIsActive;
  });

  // Dropdown states (no hallDropdownOpen — hall is read-only now;
  // leader/deputy/members dropdowns are owned by PickerTypeahead).
  let departmentDropdownOpen = $state(false);
  let assetsDropdownOpen = $state(false);
  let statusDropdownOpen = $state(false);

  // Picker filters. Lead + deputy share the team_lead dataset; members
  // pull from active employees (B3 fix: pre-Phase-4.12 SSR fetch shipped
  // no `isActive=1`, so inactive employees could appear).
  const teamLeadPickerParams = { isActive: '1', position: 'team_lead' } as const;
  const employeePickerParams = { isActive: '1', role: 'employee' } as const;

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
    // Extract scalar IDs from PickerOption form values (§D23 contract).
    // Members come through as PickerOption[]; the leader is filtered out
    // server-side, but we also strip it locally so the legacy
    // "leader is auto-member" UX stays correct in the relations payload.
    const leaderId = localLeader?.id ?? null;
    const memberIds =
      leaderId === null ?
        localMembers.map((o) => o.id)
      : localMembers.filter((o) => o.id !== leaderId).map((o) => o.id);
    onsubmit({
      name: localName,
      description: localDescription,
      departmentId: localDepartmentId,
      leaderId,
      deputyLeaderId: localDeputyLeader?.id ?? null,
      memberIds,
      assetIds: localAssetIds,
      isActive: localIsActive,
    });
  }

  // Capture-phase click-outside: works inside modals (bypasses stopPropagation)
  $effect(() => {
    return onClickOutsideDropdown(() => {
      departmentDropdownOpen = false;
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

      <!-- Team Leader Picker (typeahead).
           Label rendered as <span> + linked via PickerTypeahead's
           `labelledBy` prop (aria-labelledby on the inner input) —
           a <label for=> would orphan because the picker owns its
           input id. -->
      <div class="form-field">
        <span
          class="form-field__label"
          id="team-lead-label">Leiter</span
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
        <PickerTypeahead
          bind:value={localLeader}
          searchParams={teamLeadPickerParams}
          labelledBy="team-lead-label"
          placeholderText={messages.NO_LEADER}
        />
      </div>

      <!-- Team Deputy Leader Picker (typeahead). Span-as-label, see above. -->
      <div class="form-field">
        <span
          class="form-field__label"
          id="team-deputy-lead-label"
        >
          <i class="fas fa-user-shield mr-1"></i>
          Stellvertreter
        </span>
        <PickerTypeahead
          bind:value={localDeputyLeader}
          searchParams={teamLeadPickerParams}
          labelledBy="team-deputy-lead-label"
          placeholderText="— Kein Stellvertreter —"
        />
      </div>

      <!-- Team Members Picker (typeahead, multi). Leader is auto-member,
           submit-time filter removes the leader's id from the relations
           payload to mirror the pre-Phase-4.12 "exclude leader from
           members dropdown" behaviour. -->
      <div class="form-field">
        <span
          class="form-field__label"
          id="team-members-label">Mitglieder</span
        >
        <PickerTypeahead
          bind:value={localMembers}
          multiple={true}
          searchParams={employeePickerParams}
          labelledBy="team-members-label"
          placeholderText="Mitarbeiter suchen…"
          emptySelectionText={messages.NO_EMPLOYEES_AVAILABLE}
        />
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
