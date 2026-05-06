<script lang="ts">
  import PickerTypeahead from '$lib/components/PickerTypeahead.svelte';

  import { TYPE_OPTIONS } from './constants';
  import { getStatusBadgeClass, getStatusLabel, getTypeLabel } from './utils';

  import type { PickerOption } from '$lib/components/picker-typeahead-helpers';
  import type { AreaMessages } from './constants';
  import type { FormIsActiveStatus, AreaType, Department, Hall } from './types';

  /**
   * Lead-candidate pickers (area lead + deputy) consume the unified
   * PickerTypeahead component (FEAT_SERVER_DRIVEN_PAGINATION §4.12 §D23).
   * Both bindings are full PickerOption objects, NOT scalar IDs — the
   * page-level form extracts `.id` on submit. Lifts the silent 10-row
   * server cap that applied while the SSR fetch shipped no `?limit=`
   * (Audit B2).
   */
  interface Props {
    show: boolean;
    isEditMode: boolean;
    modalTitle: string;
    messages: AreaMessages;
    formName: string;
    formDescription: string;
    formAreaLead: PickerOption | null;
    formAreaDeputyLead: PickerOption | null;
    formType: AreaType;
    formCapacity: number | null;
    formDepartmentIds: number[];
    formHallIds: number[];
    formIsActive: FormIsActiveStatus;
    allDepartments: Department[];
    allHalls: Hall[];
    submitting: boolean;
    onclose: () => void;
    onsubmit: (e: Event) => void;
  }

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- Svelte $bindable() requires let and is not a useless default */
  // prettier-ignore
  let { show, isEditMode, modalTitle, messages, formName = $bindable(), formDescription = $bindable(), formAreaLead = $bindable(), formAreaDeputyLead = $bindable(), formType = $bindable(), formCapacity = $bindable(), formDepartmentIds = $bindable(), formHallIds = $bindable(), formIsActive = $bindable(), allDepartments, allHalls, submitting, onclose, onsubmit }: Props = $props();
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  // Local dropdown states (lead/deputy dropdowns are now owned by
  // PickerTypeahead — only type + status remain modal-local).
  let typeDropdownOpen = $state(false);
  let statusDropdownOpen = $state(false);

  // Picker filters: shared dataset for lead + deputy. No `role=` filter so
  // backend returns admin + root candidates with `position=area_lead`
  // mixed in one search response (matches the pre-Phase-4.12 admins+roots
  // merge that the SSR fetch built explicitly).
  const areaLeadPickerParams = { isActive: '1', position: 'area_lead' } as const;

  // =============================================================================
  // DROPDOWN HANDLERS
  // =============================================================================

  function toggleTypeDropdown(e: MouseEvent): void {
    e.stopPropagation();
    statusDropdownOpen = false;
    typeDropdownOpen = !typeDropdownOpen;
  }

  function selectType(type: AreaType): void {
    formType = type;
    typeDropdownOpen = false;
  }

  function toggleStatusDropdown(e: MouseEvent): void {
    e.stopPropagation();
    typeDropdownOpen = false;
    statusDropdownOpen = !statusDropdownOpen;
  }

  function selectStatus(status: FormIsActiveStatus): void {
    formIsActive = status;
    statusDropdownOpen = false;
  }

  // Reset local UI state when modal opens
  $effect(() => {
    if (show) {
      typeDropdownOpen = false;
      statusDropdownOpen = false;
    }
  });

  // Close dropdowns on outside click
  $effect(() => {
    if (typeDropdownOpen || statusDropdownOpen) {
      const handleClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;
        if (typeDropdownOpen && !target.closest('#type-dropdown')) {
          typeDropdownOpen = false;
        }
        if (statusDropdownOpen && !target.closest('#status-dropdown')) {
          statusDropdownOpen = false;
        }
      };
      document.addEventListener('click', handleClick, true);
      return () => {
        document.removeEventListener('click', handleClick, true);
      };
    }
  });
</script>

{#if show}
  <div
    id="area-modal"
    class="modal-overlay modal-overlay--active"
    role="dialog"
    aria-modal="true"
    aria-labelledby="area-modal-title"
    tabindex="-1"
  >
    <form
      id="area-form"
      class="ds-modal"
      {onsubmit}
    >
      <div class="ds-modal__header">
        <h3
          class="ds-modal__title"
          id="area-modal-title"
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
        <!-- Name -->
        <div class="form-field">
          <label
            class="form-field__label"
            for="area-name"
          >
            {messages.LABEL_NAME} <span class="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="area-name"
            name="name"
            class="form-field__control"
            required
            bind:value={formName}
            placeholder={messages.PLACEHOLDER_NAME}
          />
        </div>

        <!-- Description -->
        <div class="form-field">
          <label
            class="form-field__label"
            for="area-description">{messages.LABEL_DESCRIPTION}</label
          >
          <textarea
            id="area-description"
            name="description"
            class="form-field__control"
            rows="3"
            bind:value={formDescription}
            placeholder={messages.PLACEHOLDER_DESCRIPTION}
          ></textarea>
        </div>

        <!-- Area Lead Picker (typeahead).
             Label rendered as <span> + linked via PickerTypeahead's
             `labelledBy` prop (aria-labelledby on the inner input) —
             a <label for=> would orphan because the picker owns its
             input id. -->
        <div class="form-field">
          <span
            class="form-field__label"
            id="area-lead-label"
          >
            <i class="fas fa-user-tie mr-1"></i>
            {messages.LABEL_AREA_LEAD}
          </span>
          <div
            class="alert alert--info alert--sm"
            style="margin-bottom: var(--spacing-3);"
          >
            <span class="alert__icon">
              <i class="fas fa-info-circle"></i>
            </span>
            <div class="alert__content">
              <p class="alert__message">
                Nur Admins/Root mit der Position &laquo;{messages.AREA_LEAD_POSITION}&raquo; stehen
                zur Auswahl. Zuweisung über die
                <a href="/manage-admins">Admin-Verwaltung</a>.
              </p>
            </div>
          </div>
          <PickerTypeahead
            bind:value={formAreaLead}
            searchParams={areaLeadPickerParams}
            labelledBy="area-lead-label"
            placeholderText={messages.NO_AREA_LEAD}
          />
        </div>

        <!-- Area Deputy Lead Picker (typeahead). Span-as-label, see above. -->
        <div class="form-field">
          <span
            class="form-field__label"
            id="area-deputy-lead-label"
          >
            <i class="fas fa-user-shield mr-1"></i>
            Stellvertreter
          </span>
          <PickerTypeahead
            bind:value={formAreaDeputyLead}
            searchParams={areaLeadPickerParams}
            labelledBy="area-deputy-lead-label"
            placeholderText="— Kein Stellvertreter —"
          />
        </div>

        <!-- Type Dropdown -->
        <div class="form-field">
          <label
            class="form-field__label"
            for="area-type-hidden"
          >
            {messages.LABEL_TYPE} <span class="text-red-500">*</span>
          </label>
          <input
            type="hidden"
            id="area-type-hidden"
            value={formType}
          />
          <div
            class="dropdown"
            id="type-dropdown"
          >
            <button
              type="button"
              class="dropdown__trigger"
              class:active={typeDropdownOpen}
              onclick={toggleTypeDropdown}
            >
              <span>{getTypeLabel(formType)}</span>
              <i class="fas fa-chevron-down"></i>
            </button>
            <div
              class="dropdown__menu"
              class:active={typeDropdownOpen}
            >
              {#each TYPE_OPTIONS as option (option.value)}
                <button
                  type="button"
                  class="dropdown__option"
                  onclick={() => {
                    selectType(option.value);
                  }}
                >
                  {option.label}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <!-- Capacity -->
        <div class="form-field">
          <label
            class="form-field__label"
            for="area-capacity">{messages.LABEL_CAPACITY}</label
          >
          <input
            type="number"
            id="area-capacity"
            name="capacity"
            class="form-field__control"
            min="0"
            bind:value={formCapacity}
            placeholder={messages.PLACEHOLDER_CAPACITY}
          />
        </div>

        <!-- Department Multi-Select -->
        <div class="form-field">
          <label
            class="form-field__label"
            for="area-departments"
          >
            <i class="fas fa-sitemap mr-1"></i>
            {messages.LABEL_DEPARTMENTS}
          </label>
          <select
            id="area-departments"
            name="departmentIds"
            multiple
            class="multi-select"
            bind:value={formDepartmentIds}
          >
            {#each allDepartments as dept (dept.id)}
              <option value={dept.id}>{dept.name}</option>
            {/each}
          </select>
          <span class="form-field__message text-(--color-text-secondary)">
            <i class="fas fa-info-circle mr-1"></i>
            {messages.DEPARTMENTS_HINT}
          </span>
        </div>

        <!-- Hall Multi-Select -->
        <div class="form-field">
          <label
            class="form-field__label"
            for="area-halls"
          >
            <i class="fas fa-warehouse mr-1"></i>
            {messages.LABEL_HALLS}
          </label>
          <select
            id="area-halls"
            name="hallIds"
            multiple
            class="multi-select"
            bind:value={formHallIds}
          >
            {#each allHalls as hall (hall.id)}
              <option value={hall.id}>{hall.name}</option>
            {/each}
          </select>
          <span class="form-field__message text-(--color-text-secondary)">
            <i class="fas fa-info-circle mr-1"></i>
            {messages.HALLS_HINT}
          </span>
        </div>

        <!-- Status Dropdown (only in edit mode) -->
        {#if isEditMode}
          <div class="form-field">
            <label
              class="form-field__label"
              for="area-status-hidden"
            >
              {messages.LABEL_STATUS} <span class="text-red-500">*</span>
            </label>
            <input
              type="hidden"
              id="area-status-hidden"
              value={formIsActive}
            />
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
                <span class="badge {getStatusBadgeClass(formIsActive)}"
                  >{getStatusLabel(formIsActive)}</span
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
            <span class="form-field__message mt-1 block text-(--color-text-secondary)">
              {messages.STATUS_HINT}
            </span>
          </div>
        {/if}
      </div>

      <div class="ds-modal__footer">
        <button
          type="button"
          class="btn btn-cancel"
          onclick={onclose}>{messages.BTN_CANCEL}</button
        >
        <button
          type="submit"
          class="btn btn-secondary"
          disabled={submitting}
        >
          {#if submitting}<span class="spinner-ring spinner-ring--sm mr-2"></span>{/if}
          {messages.BTN_SAVE}
        </button>
      </div>
    </form>
  </div>
{/if}
