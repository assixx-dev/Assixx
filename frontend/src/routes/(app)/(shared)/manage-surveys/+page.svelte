<script lang="ts">
  /**
   * Manage Surveys — Page Component (Phase 4.10b URL-driven state)
   * @module manage-surveys/+page
   *
   * Three independent paginated card sections — Aktive / Beendete / Entwürfe
   * — each with its own URL pivot per FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN
   * §4.10b. The Beendete section folds backend statuses `completed` +
   * `archived` into one URL key (`?completedPage=N`) via two parallel calls
   * on the server, recorded as §D20.
   *
   * URL contract:
   *   ?draftPage / ?activePage / ?completedPage  — per-section page index
   *   ?search                                     — shared title/description
   *
   * `buildPaginatedHref` skips defaults (page=1 / search='' / undefined),
   * so canonical first-page URLs stay clean (`/manage-surveys`). Search
   * changes reset all three section pages to 1 — keeps the URL semantically
   * consistent across filter switches.
   *
   * Mutations call `invalidateAll()` to retrigger the load on the SAME URL,
   * preserving page + search across create/edit/complete/delete.
   *
   * Templates section is OUT OF SCOPE per masterplan row 4.10 — kept
   * unchanged (single non-paginated lookup).
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import PermissionDenied from '$lib/components/PermissionDenied.svelte';
  import { showErrorAlert } from '$lib/utils';
  import { buildPaginatedHref } from '$lib/utils/url-pagination';

  import ActiveSurveyCard from './_lib/ActiveSurveyCard.svelte';
  import CompletedSurveyCard from './_lib/CompletedSurveyCard.svelte';
  import { createAssignmentBadgeMap, createSurveyMessages } from './_lib/constants';
  import DraftSurveyCard from './_lib/DraftSurveyCard.svelte';
  import {
    getSurveyId,
    getAssignmentBadges,
    getOptionsFromQuestion,
    handleCompleteSurveyWithInvalidate,
    handleDeleteSurveyWithInvalidate,
    handleViewResults,
    loadSurveyForEdit,
    saveSurveyWithInvalidate,
    type FormState,
  } from './_lib/handlers';
  import { surveyAdminState } from './_lib/state.svelte';
  import SurveyFormModal from './_lib/SurveyFormModal.svelte';
  import {
    questionTypeNeedsOptions,
    getTextFromBuffer,
    toBool,
    canAssignSurveyCompanyWide,
  } from './_lib/utils';

  import type { PageData } from './$types';
  import type { QuestionType } from './_lib/types';

  // ==========================================================================
  // SSR DATA — single source of truth via $derived from props
  // ==========================================================================

  const { data }: { data: PageData } = $props();
  const permissionDenied = $derived(data.permissionDenied);

  // Hierarchy labels from layout data inheritance (ADR-034).
  const labels = $derived(data.hierarchyLabels);
  const surveyMessages = $derived(createSurveyMessages(labels));
  const badgeMap = $derived(createAssignmentBadgeMap(labels));

  // Section data — already filtered + paginated server-side. NO client-side
  // .filter() over a flat array (Phase-1 pattern that the §4.10b migration
  // closes — was the silent-truncation bug B1 in the masterplan §0.2.1).
  const draftSurveys = $derived(data.draftSurveys);
  const draftPagination = $derived(data.draftPagination);
  const activeSurveys = $derived(data.activeSurveys);
  const activePagination = $derived(data.activePagination);
  const completedSurveys = $derived(data.completedSurveys);
  const completedPagination = $derived(data.completedPagination);

  // Reference data (unchanged from pre-Phase-4.10b).
  const templates = $derived(data.templates);
  const departments = $derived(data.departments);
  const teams = $derived(data.teams);
  const areas = $derived(data.areas);

  // ADR-036 #4: backend `/areas`, `/departments`, `/teams` already scope-
  // filter via ScopeService — client trusts the returned data. The only
  // remaining client-side permission gate is "company-wide" (root /
  // admin-full only).
  const canAssignCompanyWide = $derived(canAssignSurveyCompanyWide(data.currentUser));

  // ==========================================================================
  // URL NAVIGATION HELPERS — per-section pageHref + search debounce
  //
  // `buildPaginatedHref` from `$lib/utils/url-pagination` only suppresses
  // `page === 1` and `search === ''`. Per-section keys (`draftPage` /
  // `activePage` / `completedPage`) go through its `appendExtraParams`
  // path which emits ANY non-empty primitive. Caller must skip the value 1
  // explicitly — done via conditional spread below.
  // ==========================================================================

  const BASE_PATH = '/manage-surveys';

  type SectionKey = 'draft' | 'active' | 'completed';

  /**
   * Build a clean URL for clicking a pagination anchor in a single section.
   * The other two section pages stay at their current values; only the
   * targeted section's page changes. Default page 1 is suppressed so the
   * canonical first-page state is `/manage-surveys` (no query string).
   */
  function pageHref(section: SectionKey, targetPage: number): string {
    const draftPage = section === 'draft' ? targetPage : data.draftPage;
    const activePage = section === 'active' ? targetPage : data.activePage;
    const completedPage = section === 'completed' ? targetPage : data.completedPage;
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        search: data.search,
        ...(draftPage > 1 ? { draftPage } : {}),
        ...(activePage > 1 ? { activePage } : {}),
        ...(completedPage > 1 ? { completedPage } : {}),
      }),
    );
  }

  // ==========================================================================
  // SEARCH — debounced URL update, resets all three section pages to 1
  //
  // Resetting pages to 1 on search-change keeps the URL semantically
  // consistent: page 5 of a result set may be empty after filter narrowing,
  // so we drop the cursor instead of showing an empty page. Backend honours
  // the empty-page case correctly anyway, but the UX is cleaner this way.
  // ==========================================================================

  // Writable-derived pattern: the input mirrors `data.search` reactively
  // (back-button, invalidateAll → reloaded URL → derived re-runs), but is
  // also locally writable so `oninput` can update it during typing without
  // re-running the load function on every keystroke. The local override
  // sticks until the source (`data.search`) changes again — exactly the
  // semantics we need for a debounced search box.
  let searchInputValue = $derived(data.search);
  let searchDebounceHandle: ReturnType<typeof setTimeout> | undefined;

  function navigateSearch(newSearch: string): void {
    void goto(
      resolve(
        buildPaginatedHref(BASE_PATH, {
          search: newSearch,
          // All three section pages reset (default 1 → suppressed by helper).
        }),
      ),
      { keepFocus: true },
    );
  }

  function handleSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    searchInputValue = target.value;
    if (searchDebounceHandle !== undefined) clearTimeout(searchDebounceHandle);
    searchDebounceHandle = setTimeout(() => {
      navigateSearch(searchInputValue.trim());
    }, 300);
  }

  function handleSearchClear(): void {
    if (searchDebounceHandle !== undefined) clearTimeout(searchDebounceHandle);
    searchInputValue = '';
    navigateSearch('');
  }

  // =============================================================================
  // UI STATE - Form and Modal state (client-side only)
  // =============================================================================

  let formTitle = $state('');
  let formDescription = $state('');
  let formIsAnonymous = $state(false);
  let formIsMandatory = $state(false);
  let formStartDate = $state('');
  let formStartTime = $state('00:00');
  let formEndDate = $state('');
  let formEndTime = $state('23:59');
  let formCompanyWide = $state(false);
  let formSelectedAreas = $state<number[]>([]);
  let formSelectedDepartments = $state<number[]>([]);
  let formSelectedTeams = $state<number[]>([]);
  let formQuestions = $state<
    {
      id: string;
      text: string;
      type: QuestionType;
      isOptional: boolean;
      options: string[];
    }[]
  >([]);

  // =============================================================================
  // FORM STATE HELPERS
  // =============================================================================

  function getFormState(): FormState {
    return {
      formTitle,
      formDescription,
      formIsAnonymous,
      formIsMandatory,
      formStartDate,
      formStartTime,
      formEndDate,
      formEndTime,
      formCompanyWide,
      formSelectedAreas,
      formSelectedDepartments,
      formSelectedTeams,
      formQuestions,
    };
  }

  function applyFormState(state: FormState): void {
    formTitle = state.formTitle;
    formDescription = state.formDescription;
    formIsAnonymous = state.formIsAnonymous;
    formIsMandatory = state.formIsMandatory;
    formStartDate = state.formStartDate;
    formStartTime = state.formStartTime;
    formEndDate = state.formEndDate;
    formEndTime = state.formEndTime;
    formCompanyWide = state.formCompanyWide;
    formSelectedAreas = state.formSelectedAreas;
    formSelectedDepartments = state.formSelectedDepartments;
    formSelectedTeams = state.formSelectedTeams;
    formQuestions = state.formQuestions;
  }

  function resetForm(): void {
    formTitle = '';
    formDescription = '';
    formIsAnonymous = false;
    formIsMandatory = false;
    formStartDate = '';
    formStartTime = '00:00';
    formEndDate = '';
    formEndTime = '23:59';
    formCompanyWide = false;
    formSelectedAreas = [];
    formSelectedDepartments = [];
    formSelectedTeams = [];
    formQuestions = [];
    surveyAdminState.resetQuestionCounter();
  }

  // =============================================================================
  // MODAL HANDLERS
  // =============================================================================

  function handleOpenCreateModal(): void {
    resetForm();
    surveyAdminState.openModal(null);
    addQuestion();
  }

  async function handleEditSurvey(surveyId: number | string): Promise<void> {
    const formState = await loadSurveyForEdit(surveyId);
    if (formState !== null) {
      // Reset company-wide if user lacks permission (UX guard, backend enforces too)
      if (!canAssignCompanyWide && formState.formCompanyWide) {
        formState.formCompanyWide = false;
      }
      applyFormState(formState);
    }
  }

  function handleCloseModal(): void {
    surveyAdminState.closeModal();
    resetForm();
  }

  // =============================================================================
  // QUESTION HANDLERS
  // =============================================================================

  function addQuestion(): void {
    const questionId = `question_${surveyAdminState.incrementQuestionCounter()}`;
    formQuestions = [
      ...formQuestions,
      {
        id: questionId,
        text: '',
        type: 'text',
        isOptional: false,
        options: [],
      },
    ];
  }

  function removeQuestion(questionId: string): void {
    formQuestions = formQuestions.filter((q) => q.id !== questionId);
  }

  function handleQuestionTypeChange(questionId: string, type: QuestionType): void {
    formQuestions = formQuestions.map((q) => {
      if (q.id === questionId) {
        const needsOptions = questionTypeNeedsOptions(type);
        return {
          ...q,
          type,
          options:
            needsOptions && q.options.length === 0 ? ['', '']
            : needsOptions ? q.options
            : [],
        };
      }
      return q;
    });
  }

  function addOption(questionId: string): void {
    formQuestions = formQuestions.map((q) => {
      if (q.id === questionId) return { ...q, options: [...q.options, ''] };
      return q;
    });
  }

  function removeOption(questionId: string, optionIndex: number): void {
    formQuestions = formQuestions.map((q) => {
      if (q.id === questionId)
        return { ...q, options: q.options.filter((_, i) => i !== optionIndex) };
      return q;
    });
  }

  function updateOptionText(questionId: string, optionIndex: number, text: string): void {
    formQuestions = formQuestions.map((q) => {
      if (q.id === questionId) {
        const newOptions = [...q.options];
        newOptions[optionIndex] = text;
        return { ...q, options: newOptions };
      }
      return q;
    });
  }

  // =============================================================================
  // ASSIGNMENT & SAVE HANDLERS
  // =============================================================================

  async function handleSaveSurvey(status: 'draft' | 'active'): Promise<void> {
    await saveSurveyWithInvalidate(status, getFormState(), handleCloseModal, invalidateAll);
  }

  // =============================================================================
  // TEMPLATE HANDLER
  // =============================================================================

  function handleCreateFromTemplate(templateId: number): void {
    const template = templates.find((t) => t.id === templateId);
    if (template === undefined) {
      showErrorAlert('Vorlage konnte nicht gefunden werden');
      return;
    }

    resetForm();
    formTitle = template.name;
    formDescription = template.description;

    if (template.questions.length > 0) {
      formQuestions = template.questions.map((q) => {
        const qId = `question_${surveyAdminState.incrementQuestionCounter()}`;
        return {
          id: qId,
          text: getTextFromBuffer(q.questionText),
          type: q.questionType,
          isOptional: !toBool(q.isRequired),
          options: getOptionsFromQuestion(q),
        };
      });
    }

    surveyAdminState.openModal(null);
  }
</script>

<svelte:head>
  <title>Umfrage-Verwaltung - Assixx</title>
</svelte:head>

{#if permissionDenied}
  <PermissionDenied addonName="die Umfragen" />
{:else}
  <div class="container">
    <div class="card">
      <div class="card__header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 class="card-title">Umfrage-Verwaltung</h4>
          <p class="text-secondary">Erstellen und verwalten Sie Mitarbeiterumfragen</p>
        </div>
        <!-- Search box — debounced URL update; spans all three sections -->
        <div class="search-input search-input--md">
          <i
            class="fas fa-search search-input__leading-icon"
            aria-hidden="true"
          ></i>
          <input
            type="search"
            class="search-input__control"
            placeholder="Umfragen durchsuchen…"
            aria-label="Umfragen durchsuchen"
            value={searchInputValue}
            oninput={handleSearchInput}
          />
          {#if searchInputValue !== ''}
            <button
              type="button"
              class="search-input__clear"
              aria-label="Suche zurücksetzen"
              onclick={handleSearchClear}
            >
              <i
                class="fas fa-times"
                aria-hidden="true"
              ></i>
            </button>
          {/if}
        </div>
      </div>

      <div class="card-body">
        <!-- ===== Active Surveys ===== -->
        <h4>Aktive Umfragen</h4>
        {#if activeSurveys.length === 0}
          <div class="empty-state">
            <div class="empty-state__icon">
              <i class="fas fa-clipboard-list"></i>
            </div>
            <h3 class="empty-state__title">Keine aktiven Umfragen</h3>
            <p class="empty-state__description">
              {#if data.search !== ''}
                Keine aktiven Umfragen passen zum Suchbegriff „{data.search}".
              {:else}
                Es gibt derzeit keine aktiven Umfragen. Erstellen Sie eine neue oder aktivieren Sie
                einen Entwurf.
              {/if}
            </p>
          </div>
        {:else}
          <div class="mb-8 grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-6">
            {#each activeSurveys as survey (getSurveyId(survey))}
              <ActiveSurveyCard
                {survey}
                surveyId={getSurveyId(survey)}
                canManage={survey.canManage ?? false}
                assignmentBadges={getAssignmentBadges(survey, departments, teams, areas, badgeMap)}
                onedit={handleEditSurvey}
                onviewresults={handleViewResults}
                ondelete={(id: number | string) =>
                  handleDeleteSurveyWithInvalidate(id, invalidateAll)}
                oncomplete={(id: number | string) =>
                  handleCompleteSurveyWithInvalidate(id, invalidateAll)}
              />
            {/each}
          </div>
          {#if activePagination.totalPages > 1}
            <nav
              class="pagination"
              aria-label="Aktive Umfragen — Seitennavigation"
            >
              {#if activePagination.hasPrev}
                <a
                  class="pagination__btn pagination__btn--prev"
                  href={pageHref('active', activePagination.page - 1)}
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
                {#each Array.from({ length: activePagination.totalPages }, (_: unknown, i: number) => i + 1) as page (page)}
                  {#if page === activePagination.page}
                    <span
                      class="pagination__page pagination__page--active"
                      aria-current="page"
                    >
                      {page}
                    </span>
                  {:else}
                    <a
                      class="pagination__page"
                      href={pageHref('active', page)}>{page}</a
                    >
                  {/if}
                {/each}
              </div>
              <span class="pagination__info">
                Seite {activePagination.page} von {activePagination.totalPages}
                ({activePagination.total} Einträge)
              </span>
              {#if activePagination.hasNext}
                <a
                  class="pagination__btn pagination__btn--next"
                  href={pageHref('active', activePagination.page + 1)}
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
        {/if}

        <!-- ===== Beendete (completed + archived merged §D20) ===== -->
        <div class="completed-section">
          <div class="completed-header">
            <h4 class="completed-title">Beendete Umfragen</h4>
          </div>
          {#if completedSurveys.length === 0}
            <div class="empty-state">
              <div class="empty-state__icon">
                <i class="fas fa-check-circle"></i>
              </div>
              <h3 class="empty-state__title">Keine beendeten Umfragen</h3>
              <p class="empty-state__description">
                {#if data.search !== ''}
                  Keine beendeten oder archivierten Umfragen passen zum Suchbegriff „{data.search}".
                {:else}
                  Beendete und archivierte Umfragen werden hier angezeigt.
                {/if}
              </p>
            </div>
          {:else}
            <div class="mb-8 grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-6">
              {#each completedSurveys as survey (getSurveyId(survey))}
                <CompletedSurveyCard
                  {survey}
                  surveyId={getSurveyId(survey)}
                  canManage={survey.canManage ?? false}
                  assignmentBadges={getAssignmentBadges(survey, departments, teams, areas)}
                  onviewresults={handleViewResults}
                  ondelete={(id: number | string) =>
                    handleDeleteSurveyWithInvalidate(id, invalidateAll)}
                />
              {/each}
            </div>
            {#if completedPagination.totalPages > 1}
              <nav
                class="pagination"
                aria-label="Beendete Umfragen — Seitennavigation"
              >
                {#if completedPagination.hasPrev}
                  <a
                    class="pagination__btn pagination__btn--prev"
                    href={pageHref('completed', completedPagination.page - 1)}
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
                  {#each Array.from({ length: completedPagination.totalPages }, (_: unknown, i: number) => i + 1) as page (page)}
                    {#if page === completedPagination.page}
                      <span
                        class="pagination__page pagination__page--active"
                        aria-current="page"
                      >
                        {page}
                      </span>
                    {:else}
                      <a
                        class="pagination__page"
                        href={pageHref('completed', page)}>{page}</a
                      >
                    {/if}
                  {/each}
                </div>
                <span class="pagination__info">
                  Seite {completedPagination.page} von {completedPagination.totalPages}
                  ({completedPagination.total} Einträge)
                </span>
                {#if completedPagination.hasNext}
                  <a
                    class="pagination__btn pagination__btn--next"
                    href={pageHref('completed', completedPagination.page + 1)}
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
          {/if}
        </div>

        <!-- ===== Drafts ===== -->
        <div class="drafts-section">
          <div class="drafts-header">
            <h4 class="drafts-title">Entwürfe</h4>
          </div>
          {#if draftSurveys.length === 0}
            <div class="empty-state">
              <div class="empty-state__icon">
                <i class="fas fa-file-alt"></i>
              </div>
              <h3 class="empty-state__title">Keine Entwürfe</h3>
              <p class="empty-state__description">
                {#if data.search !== ''}
                  Keine Entwürfe passen zum Suchbegriff „{data.search}".
                {:else}
                  Sie haben keine Umfrage-Entwürfe. Erstellen Sie eine neue und speichern Sie sie
                  als Entwurf.
                {/if}
              </p>
            </div>
          {:else}
            <div class="mb-8 grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-6">
              {#each draftSurveys as survey (getSurveyId(survey))}
                <DraftSurveyCard
                  {survey}
                  surveyId={getSurveyId(survey)}
                  canManage={survey.canManage ?? false}
                  onedit={handleEditSurvey}
                  ondelete={(id: number | string) =>
                    handleDeleteSurveyWithInvalidate(id, invalidateAll)}
                />
              {/each}
            </div>
            {#if draftPagination.totalPages > 1}
              <nav
                class="pagination"
                aria-label="Entwürfe — Seitennavigation"
              >
                {#if draftPagination.hasPrev}
                  <a
                    class="pagination__btn pagination__btn--prev"
                    href={pageHref('draft', draftPagination.page - 1)}
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
                  {#each Array.from({ length: draftPagination.totalPages }, (_: unknown, i: number) => i + 1) as page (page)}
                    {#if page === draftPagination.page}
                      <span
                        class="pagination__page pagination__page--active"
                        aria-current="page"
                      >
                        {page}
                      </span>
                    {:else}
                      <a
                        class="pagination__page"
                        href={pageHref('draft', page)}>{page}</a
                      >
                    {/if}
                  {/each}
                </div>
                <span class="pagination__info">
                  Seite {draftPagination.page} von {draftPagination.totalPages}
                  ({draftPagination.total} Einträge)
                </span>
                {#if draftPagination.hasNext}
                  <a
                    class="pagination__btn pagination__btn--next"
                    href={pageHref('draft', draftPagination.page + 1)}
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
          {/if}
        </div>

        <!-- ===== Templates (out of scope per masterplan row 4.10) ===== -->
        <div class="templates-section">
          <div class="templates-header">
            <h4 class="templates-title">Vorlagen</h4>
          </div>
          {#if templates.length === 0}
            <div class="empty-state">
              <div class="empty-state__icon">
                <i class="fas fa-folder-open"></i>
              </div>
              <h3 class="empty-state__title">Keine Vorlagen verfügbar</h3>
              <p class="empty-state__description">
                Es sind noch keine Umfragevorlagen vorhanden. Vorlagen werden automatisch erstellt.
              </p>
            </div>
          {:else}
            <div class="mb-8 grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-6">
              {#each templates as template (template.id)}
                <div
                  class="card card--clickable"
                  role="button"
                  tabindex="0"
                  onclick={() => {
                    handleCreateFromTemplate(template.id);
                  }}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') handleCreateFromTemplate(template.id);
                  }}
                >
                  <h4 class="text-primary mb-2 font-semibold">
                    {template.name}
                  </h4>
                  <p class="text-secondary text-sm leading-normal">
                    {template.description}
                  </p>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <button
    type="button"
    class="btn-float"
    aria-label="Neue Umfrage erstellen"
    onclick={handleOpenCreateModal}
  >
    <i class="fas fa-plus"></i>
  </button>

  <SurveyFormModal
    messages={surveyMessages}
    bind:formTitle
    bind:formDescription
    bind:formIsAnonymous
    bind:formIsMandatory
    bind:formStartDate
    bind:formStartTime
    bind:formEndDate
    bind:formEndTime
    bind:formCompanyWide
    bind:formSelectedAreas
    bind:formSelectedDepartments
    bind:formSelectedTeams
    bind:formQuestions
    {departments}
    {teams}
    {areas}
    {canAssignCompanyWide}
    onclose={handleCloseModal}
    onsavedraft={() => handleSaveSurvey('draft')}
    onsaveactive={() => handleSaveSurvey('active')}
    onaddquestion={addQuestion}
    onremovequestion={removeQuestion}
    onquestiontypechange={handleQuestionTypeChange}
    onaddoption={addOption}
    onremoveoption={removeOption}
    onupdateoption={updateOptionText}
  />
{/if}

<style>
  /* Survey Stats — used in child card components */
  :global(.survey-stats) {
    display: flex;
    gap: var(--spacing-6);
    margin-bottom: var(--spacing-4);
  }

  :global(.survey-stat) {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  :global(.survey-stat-value) {
    color: var(--primary-color);
    font-weight: 700;
    font-size: 1.5rem;
  }

  :global(.survey-stat-label) {
    color: var(--text-secondary);
    font-size: 0.8rem;
    text-transform: uppercase;
  }

  :global(.survey-actions) {
    display: grid;
    gap: var(--spacing-2);
    margin-top: var(--spacing-4);
  }

  /* Question Builder — used in SurveyFormModal */
  :global(.question-builder) {
    margin-top: var(--spacing-6);
  }

  :global(.question-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-4);
  }

  :global(.question-number) {
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 50%;

    background: var(--primary-color);

    width: 30px;
    height: 30px;
    color: var(--color-white);
    font-weight: 600;

    font-size: 14px;
  }

  :global(.question-actions) {
    display: flex;
    gap: var(--spacing-1);
  }

  :global(.question-action),
  :global(.remove-question) {
    display: flex;
    justify-content: center;
    align-items: center;

    transition: all 0.2s ease;
    cursor: pointer;
    border: none;
    border-radius: 50%;

    background: color-mix(in oklch, var(--color-white) 10%, transparent);
    padding: var(--spacing-1);

    width: 32px;
    height: 32px;

    color: var(--text-secondary);
  }

  :global(.question-action:hover),
  :global(.remove-question:hover) {
    transform: scale(1.1);
    background: color-mix(in oklch, var(--color-danger) 30%, transparent);
    color: var(--color-red-accent);
  }

  :global(.question-action.delete:hover) {
    background: color-mix(in oklch, var(--color-danger) 20%, transparent);
    color: var(--color-danger);
  }

  :global(.remove-question svg) {
    width: 14px;
    height: 14px;
  }

  /* Question Options — used in SurveyFormModal */
  :global(.option-item) {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
    margin-bottom: var(--spacing-2);
  }

  :global(.option-input) {
    flex: 1;
    border: 1px solid color-mix(in oklch, var(--color-white) 20%, transparent);
    border-radius: var(--radius-xl);

    background: color-mix(in oklch, var(--color-white) 5%, transparent);

    padding: var(--spacing-3);

    color: var(--text-primary);
  }

  :global(.remove-option) {
    display: flex;
    justify-content: center;
    align-items: center;

    transition: background 0.2s ease;
    cursor: pointer;
    border: none;
    border-radius: 50%;

    background: color-mix(in oklch, var(--color-danger) 20%, transparent);
    padding: var(--spacing-1);

    width: 28px;
    height: 28px;

    color: var(--color-danger);
  }

  :global(.remove-option:hover) {
    background: color-mix(in oklch, var(--color-danger) 30%, transparent);
  }

  :global(.add-option-btn) {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);

    transition: background 0.2s ease;
    cursor: pointer;

    margin-bottom: 10px;
    border: none;
    border-radius: var(--radius-xl);

    background: color-mix(in oklch, var(--color-success) 20%, transparent);
    padding: var(--spacing-3);
    color: var(--color-success);

    font-size: 0.9rem;
  }

  :global(.add-option-btn:hover) {
    background: color-mix(in oklch, var(--color-success) 30%, transparent);
  }

  /* Sections — directly in this template */
  .completed-section,
  .drafts-section,
  .templates-section {
    margin-top: var(--spacing-8);
    border-top: 1px solid color-mix(in oklch, var(--color-white) 10%, transparent);
    padding-top: var(--spacing-8);
  }

  .completed-header,
  .drafts-header,
  .templates-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-6);
  }

  .completed-title,
  .drafts-title,
  .templates-title {
    color: var(--text-primary);
    font-weight: 600;
    font-size: 1.5rem;
  }
</style>
