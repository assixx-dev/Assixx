<script lang="ts">
  import {
    getStatusBadgeClass,
    getStatusLabel,
    getSelectedAreaName,
    getSelectedLeadName,
  } from './utils';

  import type { DepartmentMessages } from './constants';
  import type { FormIsActiveStatus, Area, AdminUser, Hall } from './types';

  // Props with bindable for two-way binding
  interface Props {
    show: boolean;
    isEditMode: boolean;
    modalTitle: string;
    messages: DepartmentMessages;
    formName: string;
    formDescription: string;
    formAreaId: number | null;
    formDepartmentLeadId: number | null;
    formDepartmentDeputyLeadId: number | null;
    /** Single hall ID (1:1 model after migration 20260505221345432). */
    formHallId: number | null;
    formIsActive: FormIsActiveStatus;
    allAreas: Area[];
    allHalls: Hall[];
    allDepartmentLeads: AdminUser[];
    submitting: boolean;
    onclose: () => void;
    onsubmit: (e: Event) => void;
  }

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- Svelte $bindable() requires let and is not a useless default */
  // prettier-ignore
  let { show, isEditMode, modalTitle, messages, formName = $bindable(), formDescription = $bindable(), formAreaId = $bindable(), formDepartmentLeadId = $bindable(), formDepartmentDeputyLeadId = $bindable(), formHallId = $bindable(), formIsActive = $bindable(), allAreas, allHalls, allDepartmentLeads, submitting, onclose, onsubmit }: Props = $props();
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  /**
   * After migration 20260505221345432_simplify-department-hall-1to1, halls are
   * 1:1 with departments and must belong to the same area. The cross-area
   * multi-select was removed; only halls with `h.areaId === formAreaId` are
   * selectable. If the area changes, the selection is auto-cleared.
   */
  const sameAreaHalls = $derived(
    formAreaId === null ? [] : allHalls.filter((h) => h.areaId === formAreaId),
  );
  const areaName = $derived(
    formAreaId === null ? '' : (allAreas.find((a) => a.id === formAreaId)?.name ?? ''),
  );

  // Auto-clear hall when area changes or when current selection no longer matches.
  $effect(() => {
    if (formHallId === null) return;
    const stillValid = sameAreaHalls.some((h) => h.id === formHallId);
    if (!stillValid) {
      formHallId = null;
    }
  });

  // Local dropdown states
  let areaDropdownOpen = $state(false);
  let leadDropdownOpen = $state(false);
  let deputyLeadDropdownOpen = $state(false);
  let hallDropdownOpen = $state(false);
  let statusDropdownOpen = $state(false);

  // Derived dropdown display names
  const selectedAreaName = $derived(getSelectedAreaName(formAreaId, allAreas));
  const selectedLeadName = $derived(getSelectedLeadName(formDepartmentLeadId, allDepartmentLeads));
  const selectedDeputyLeadName = $derived(
    getSelectedLeadName(formDepartmentDeputyLeadId, allDepartmentLeads),
  );
  // Hall is 1:1 and area-scoped; show the matching hall name or NO_HALL fallback.
  const selectedHallName = $derived(
    formHallId === null ?
      messages.NO_HALL
    : (sameAreaHalls.find((h) => h.id === formHallId)?.name ?? messages.NO_HALL),
  );

  // =============================================================================
  // DROPDOWN HANDLERS
  // =============================================================================

  function toggleAreaDropdown(e: MouseEvent): void {
    e.stopPropagation();
    leadDropdownOpen = false;
    deputyLeadDropdownOpen = false;
    hallDropdownOpen = false;
    statusDropdownOpen = false;
    areaDropdownOpen = !areaDropdownOpen;
  }

  function selectArea(areaId: number | null): void {
    formAreaId = areaId;
    areaDropdownOpen = false;
  }

  function toggleLeadDropdown(e: MouseEvent): void {
    e.stopPropagation();
    areaDropdownOpen = false;
    deputyLeadDropdownOpen = false;
    hallDropdownOpen = false;
    statusDropdownOpen = false;
    leadDropdownOpen = !leadDropdownOpen;
  }

  function selectLead(leadId: number | null): void {
    formDepartmentLeadId = leadId;
    leadDropdownOpen = false;
  }

  function toggleDeputyLeadDropdown(e: MouseEvent): void {
    e.stopPropagation();
    areaDropdownOpen = false;
    leadDropdownOpen = false;
    hallDropdownOpen = false;
    statusDropdownOpen = false;
    deputyLeadDropdownOpen = !deputyLeadDropdownOpen;
  }

  function selectDeputyLead(leadId: number | null): void {
    formDepartmentDeputyLeadId = leadId;
    deputyLeadDropdownOpen = false;
  }

  function toggleHallDropdown(e: MouseEvent): void {
    e.stopPropagation();
    areaDropdownOpen = false;
    leadDropdownOpen = false;
    deputyLeadDropdownOpen = false;
    statusDropdownOpen = false;
    hallDropdownOpen = !hallDropdownOpen;
  }

  function selectHall(hallId: number | null): void {
    formHallId = hallId;
    hallDropdownOpen = false;
  }

  function toggleStatusDropdown(e: MouseEvent): void {
    e.stopPropagation();
    areaDropdownOpen = false;
    leadDropdownOpen = false;
    deputyLeadDropdownOpen = false;
    hallDropdownOpen = false;
    statusDropdownOpen = !statusDropdownOpen;
  }

  function selectStatus(status: FormIsActiveStatus): void {
    formIsActive = status;
    statusDropdownOpen = false;
  }

  /**
   * Checks if click target is outside the specified element
   */
  function isClickOutsideElement(target: HTMLElement, elementId: string): boolean {
    const el = document.getElementById(elementId);
    return el?.contains(target) !== true;
  }

  /**
   * Closes a dropdown when it is open AND the click was outside its element.
   * Extracted to keep the outside-click effect's arrow function at cyclomatic
   * complexity 1 — five inline `if (open && outside)` checks pushed it to 11
   * (ESLint `complexity` cap is 10, see [CODE-OF-CONDUCT.md] hard limits).
   */
  function closeIfOutside(
    isOpen: boolean,
    target: HTMLElement,
    elementId: string,
    close: () => void,
  ): void {
    if (isOpen && isClickOutsideElement(target, elementId)) {
      close();
    }
  }

  // Reset local UI state when modal opens
  $effect(() => {
    if (show) {
      areaDropdownOpen = false;
      leadDropdownOpen = false;
      deputyLeadDropdownOpen = false;
      hallDropdownOpen = false;
      statusDropdownOpen = false;
    }
  });

  // Close dropdowns on outside click
  $effect(() => {
    const anyDropdownOpen =
      areaDropdownOpen ||
      leadDropdownOpen ||
      deputyLeadDropdownOpen ||
      hallDropdownOpen ||
      statusDropdownOpen;
    if (!anyDropdownOpen) return;

    const handleClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      closeIfOutside(areaDropdownOpen, target, 'area-dropdown', () => {
        areaDropdownOpen = false;
      });
      closeIfOutside(leadDropdownOpen, target, 'lead-dropdown', () => {
        leadDropdownOpen = false;
      });
      closeIfOutside(deputyLeadDropdownOpen, target, 'deputy-lead-dropdown', () => {
        deputyLeadDropdownOpen = false;
      });
      closeIfOutside(hallDropdownOpen, target, 'hall-dropdown', () => {
        hallDropdownOpen = false;
      });
      closeIfOutside(statusDropdownOpen, target, 'status-dropdown', () => {
        statusDropdownOpen = false;
      });
    };

    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  });
</script>

{#if show}
  <div
    id="department-modal"
    class="modal-overlay modal-overlay--active"
    role="dialog"
    aria-modal="true"
    aria-labelledby="department-modal-title"
    tabindex="-1"
  >
    <form
      id="department-form"
      class="ds-modal"
      {onsubmit}
    >
      <div class="ds-modal__header">
        <h3
          class="ds-modal__title"
          id="department-modal-title"
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
            for="department-name"
          >
            {messages.LABEL_NAME} <span class="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="department-name"
            name="name"
            class="form-field__control"
            required
            bind:value={formName}
          />
        </div>

        <div class="form-field">
          <label
            class="form-field__label"
            for="department-description">{messages.LABEL_DESCRIPTION}</label
          >
          <textarea
            id="department-description"
            name="description"
            class="form-field__control"
            rows="3"
            bind:value={formDescription}
          ></textarea>
        </div>

        <div class="form-field">
          <label
            class="form-field__label"
            for="area-hidden">{messages.LABEL_AREA}</label
          >
          <input
            type="hidden"
            id="area-hidden"
            value={formAreaId ?? ''}
          />
          <div
            class="dropdown"
            id="area-dropdown"
          >
            <button
              type="button"
              class="dropdown__trigger"
              class:active={areaDropdownOpen}
              onclick={toggleAreaDropdown}
            >
              <span>{selectedAreaName}</span>
              <i class="fas fa-chevron-down"></i>
            </button>
            <div
              class="dropdown__menu"
              class:active={areaDropdownOpen}
            >
              <button
                type="button"
                class="dropdown__option"
                onclick={() => {
                  selectArea(null);
                }}
              >
                {messages.NO_AREA}
              </button>
              {#each allAreas as area (area.id)}
                <button
                  type="button"
                  class="dropdown__option"
                  onclick={() => {
                    selectArea(area.id);
                  }}
                >
                  {area.name}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div class="form-field">
          <label
            class="form-field__label"
            for="lead-hidden"
          >
            <i class="fas fa-user-tie mr-1"></i>
            {messages.LABEL_DEPARTMENT_LEAD}
          </label>
          <div
            class="alert alert--info alert--sm"
            style="margin-bottom: var(--spacing-3);"
          >
            <span class="alert__icon">
              <i class="fas fa-info-circle"></i>
            </span>
            <div class="alert__content">
              <p class="alert__message">
                Nur Admins/Root mit der Position &laquo;{messages.DEPARTMENT_LEAD_POSITION}&raquo;
                stehen zur Auswahl. Zuweisung über die
                <a href="/manage-admins">Admin-Verwaltung</a>.
              </p>
            </div>
          </div>
          <input
            type="hidden"
            id="lead-hidden"
            value={formDepartmentLeadId ?? ''}
          />
          {#if allDepartmentLeads.length > 0}
            <div
              class="dropdown"
              id="lead-dropdown"
            >
              <button
                type="button"
                class="dropdown__trigger"
                class:active={leadDropdownOpen}
                onclick={toggleLeadDropdown}
              >
                <span>{selectedLeadName}</span>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div
                class="dropdown__menu"
                class:active={leadDropdownOpen}
              >
                <button
                  type="button"
                  class="dropdown__option"
                  onclick={() => {
                    selectLead(null);
                  }}
                >
                  {messages.NO_DEPARTMENT_LEAD}
                </button>
                {#each allDepartmentLeads as lead (lead.id)}
                  <button
                    type="button"
                    class="dropdown__option"
                    onclick={() => {
                      selectLead(lead.id);
                    }}
                  >
                    {lead.firstName}
                    {lead.lastName} ({lead.role === 'root' ? 'Root' : 'Admin'})
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="form-field">
          <label
            class="form-field__label"
            for="deputy-lead-hidden"
          >
            <i class="fas fa-user-shield mr-1"></i>
            Stellvertreter
          </label>
          <input
            type="hidden"
            id="deputy-lead-hidden"
            value={formDepartmentDeputyLeadId ?? ''}
          />
          {#if allDepartmentLeads.length > 0}
            <div
              class="dropdown"
              id="deputy-lead-dropdown"
            >
              <button
                type="button"
                class="dropdown__trigger"
                class:active={deputyLeadDropdownOpen}
                onclick={toggleDeputyLeadDropdown}
              >
                <span>{selectedDeputyLeadName}</span>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div
                class="dropdown__menu"
                class:active={deputyLeadDropdownOpen}
              >
                <button
                  type="button"
                  class="dropdown__option"
                  onclick={() => {
                    selectDeputyLead(null);
                  }}
                >
                  {messages.NO_DEPARTMENT_LEAD}
                </button>
                {#each allDepartmentLeads as lead (lead.id)}
                  <button
                    type="button"
                    class="dropdown__option"
                    onclick={() => {
                      selectDeputyLead(lead.id);
                    }}
                  >
                    {lead.firstName}
                    {lead.lastName} ({lead.role === 'root' ? 'Root' : 'Admin'})
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <!--
          Hall (1:1, must match the department's area).
          The DB trigger trg_enforce_dept_hall_area_match enforces the
          area-match invariant; the dropdown only lists same-area halls.
        -->
        <div class="form-field">
          <label
            class="form-field__label"
            for="department-hall"
          >
            <i class="fas fa-warehouse mr-1"></i>
            Halle
          </label>
          {#if formAreaId === null}
            <p class="form-field__message text-(--color-text-secondary)">
              <i class="fas fa-info-circle mr-1"></i>
              Bitte zuerst einen Bereich wählen — die Halle muss zum Bereich der Abteilung gehören.
            </p>
          {:else if sameAreaHalls.length === 0}
            <p class="form-field__message text-(--color-text-secondary)">
              <i class="fas fa-info-circle mr-1"></i>
              Im Bereich "{areaName}" sind keine Hallen vorhanden.
            </p>
          {:else}
            <input
              type="hidden"
              id="hall-hidden"
              value={formHallId ?? ''}
            />
            <div
              class="dropdown"
              id="hall-dropdown"
            >
              <button
                type="button"
                class="dropdown__trigger"
                class:active={hallDropdownOpen}
                onclick={toggleHallDropdown}
              >
                <span>{selectedHallName}</span>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div
                class="dropdown__menu"
                class:active={hallDropdownOpen}
              >
                <button
                  type="button"
                  class="dropdown__option"
                  onclick={() => {
                    selectHall(null);
                  }}
                >
                  {messages.NO_HALL}
                </button>
                {#each sameAreaHalls as hall (hall.id)}
                  <button
                    type="button"
                    class="dropdown__option"
                    onclick={() => {
                      selectHall(hall.id);
                    }}
                  >
                    {hall.name}
                  </button>
                {/each}
              </div>
            </div>
            <span class="form-field__message text-(--color-text-secondary)">
              <i class="fas fa-info-circle mr-1"></i>
              Genau eine Halle aus dem Bereich "{areaName}". Teams dieser Abteilung erben die Halle
              automatisch.
            </span>
          {/if}
        </div>

        {#if isEditMode}
          <div
            class="form-field"
            id="status-field-group"
          >
            <label
              class="form-field__label"
              for="status-hidden"
            >
              {messages.LABEL_STATUS} <span class="text-red-500">*</span>
            </label>
            <input
              type="hidden"
              id="status-hidden"
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
