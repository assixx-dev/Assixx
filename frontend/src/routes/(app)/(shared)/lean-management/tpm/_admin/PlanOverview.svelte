<script lang="ts">
  /**
   * TPM Plan Overview Component
   * @module lean-management/tpm/_admin/PlanOverview
   *
   * Phase 4.11b (2026-05-06): URL-state-driven. Plans + pagination + search
   * arrive as props from the SSR load. Status filter dropped — backend
   * `ListPlansQuerySchema` has no `?isActive=` field; client-side filtering
   * over a paginated subset would be the §D5/§D10/§D11/§D12 dishonest-UI
   * pattern. Recorded as Known Limitation #13.
   *
   * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §"Migration order" row 4.11
   */
  import { SvelteMap } from 'svelte/reactivity';

  import {
    INTERVAL_LABELS,
    CARD_STATUS_LABELS,
    CARD_STATUS_BADGE_CLASSES,
    APPROVAL_STATUS_LABELS,
    APPROVAL_STATUS_BADGE,
    type TpmMessages,
  } from './constants';

  import type { PaginationMeta } from '$lib/server/api-fetch';
  import type { TpmPlan, IntervalType, IntervalMatrixEntry, CardStatus } from './types';

  interface Props {
    messages: TpmMessages;
    plans: TpmPlan[];
    pagination: PaginationMeta;
    intervalMatrix: IntervalMatrixEntry[];
    searchValue: string;
    canDelete: boolean;
    /** URL-href builder for pagination anchors — supplied by parent. */
    pageHref: (page: number) => string;
    /** Emitted on search-input change — parent debounces + navigates. */
    onsearch: (value: string) => void;
    /** Emitted on form submit (Enter key) — parent navigates immediately. */
    onsearchsubmit: () => void;
    ondelete: (plan: TpmPlan) => void;
  }

  const {
    messages,
    plans,
    pagination,
    intervalMatrix,
    searchValue,
    canDelete,
    pageHref,
    onsearch,
    onsearchsubmit,
    ondelete,
  }: Props = $props();

  /** Lookup: planUuid → intervalType → full matrix entry */
  const matrixLookup = $derived.by(() => {
    const map = new SvelteMap<string, SvelteMap<IntervalType, IntervalMatrixEntry>>();
    for (const entry of intervalMatrix) {
      let planMap = map.get(entry.planUuid);
      if (planMap === undefined) {
        planMap = new SvelteMap<IntervalType, IntervalMatrixEntry>();
        map.set(entry.planUuid, planMap);
      }
      planMap.set(entry.intervalType, entry);
    }
    return map;
  });

  /** Interval columns to display */
  const intervalColumns: IntervalType[] = [
    'daily',
    'weekly',
    'monthly',
    'quarterly',
    'semi_annual',
    'annual',
  ];

  /** Single-letter short labels for compact columns */
  const shortLabels: Record<string, string> = {
    daily: 'T',
    weekly: 'W',
    monthly: 'M',
    quarterly: 'Q',
    semi_annual: 'H',
    annual: 'J',
  };

  function formatShortDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  }

  function getMatrixEntry(planUuid: string, interval: IntervalType): IntervalMatrixEntry | null {
    return matrixLookup.get(planUuid)?.get(interval) ?? null;
  }

  /** Determine worst card status: overdue > red > yellow > green */
  function getWorstStatus(entry: IntervalMatrixEntry): CardStatus {
    if (entry.overdueCount > 0) return 'overdue';
    if (entry.redCount > 0) return 'red';
    if (entry.yellowCount > 0) return 'yellow';
    return 'green';
  }

  /** Build tooltip with status breakdown */
  function getStatusTooltip(entry: IntervalMatrixEntry, intervalLabel: string): string {
    const parts: string[] = [];
    if (entry.greenCount > 0) parts.push(`${String(entry.greenCount)} ${CARD_STATUS_LABELS.green}`);
    if (entry.redCount > 0) parts.push(`${String(entry.redCount)} ${CARD_STATUS_LABELS.red}`);
    if (entry.yellowCount > 0)
      parts.push(`${String(entry.yellowCount)} ${CARD_STATUS_LABELS.yellow}`);
    if (entry.overdueCount > 0)
      parts.push(`${String(entry.overdueCount)} ${CARD_STATUS_LABELS.overdue}`);
    return `${intervalLabel}: ${parts.join(', ')}`;
  }

  function handleSearchInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    onsearch(input.value);
  }

  function handleSearchSubmit(e: SubmitEvent): void {
    e.preventDefault();
    onsearchsubmit();
  }

  function getStatusBadge(isActive: number): { label: string; cls: string } {
    if (isActive === 1) return { label: 'Aktiv', cls: 'badge--success' };
    if (isActive === 3) return { label: 'Archiviert', cls: 'badge--info' };
    return { label: 'Inaktiv', cls: 'badge--error' };
  }

  /** Build the page-number range to render. Always [1..totalPages]. */
  const pageRange = $derived(
    Array.from({ length: pagination.totalPages }, (_: unknown, i: number) => i + 1),
  );
</script>

<!-- Search bar -->
<div class="mb-4 flex flex-wrap items-center justify-end">
  <form
    role="search"
    onsubmit={handleSearchSubmit}
    class="min-w-50"
  >
    <label
      class="search-input"
      for="tpm-plans-search"
    >
      <i
        class="fas fa-search search-input__icon"
        aria-hidden="true"
      ></i>
      <input
        id="tpm-plans-search"
        type="search"
        class="search-input__field"
        placeholder={messages.SEARCH_PLACEHOLDER}
        value={searchValue}
        oninput={handleSearchInput}
        aria-label="Wartungspläne durchsuchen"
      />
    </label>
  </form>
</div>

<!-- Plan table -->
{#if plans.length === 0}
  <div class="empty-state">
    <div class="empty-state__icon">
      <i class="fas fa-clipboard-list"></i>
    </div>
    <h3 class="empty-state__title">{messages.EMPTY_TITLE}</h3>
    <p class="empty-state__description">
      {searchValue === '' ? messages.EMPTY_DESCRIPTION : messages.EMPTY_FILTER_DESC}
    </p>
  </div>
{:else}
  <div class="table-responsive">
    <table class="data-table data-table--hover data-table--striped data-table--actions-hover">
      <thead>
        <tr>
          <th
            scope="col"
            style="min-width: 120px">{messages.TH_MACHINE}</th
          >
          <th
            scope="col"
            style="min-width: 80px">{messages.TH_STATUS}</th
          >
          <th
            scope="col"
            style="min-width: 64px">Version</th
          >
          <th
            scope="col"
            style="min-width: 160px">Freigabe</th
          >
          <th
            scope="col"
            style="min-width: 88px">Geändert</th
          >
          {#each intervalColumns as col (col)}
            <th
              scope="col"
              class="text-center"
              style="width: 48px"
              title={INTERVAL_LABELS[col]}
            >
              {shortLabels[col] ?? col}
            </th>
          {/each}
          <th scope="col">{messages.TH_ACTIONS}</th>
        </tr>
      </thead>
      <tbody>
        {#each plans as plan (plan.uuid)}
          {@const badge = getStatusBadge(plan.isActive)}
          <tr>
            <td>
              <a
                href={`/lean-management/tpm/plan/${plan.uuid}`}
                class="inline-flex items-center gap-2 font-medium text-(--color-text-primary) no-underline hover:text-(--color-primary)"
              >
                <i class="fas fa-cog"></i>
                {plan.assetName ?? '—'}
              </a>
            </td>
            <td>
              <span class="badge {badge.cls}">{badge.label}</span>
            </td>
            <td>
              <span class="badge badge--primary">v{plan.approvalVersion}.{plan.revisionMinor}</span>
            </td>
            <td class="text-nowrap">
              {#if plan.approvalStatus !== null}
                <span
                  class="badge {APPROVAL_STATUS_BADGE[plan.approvalStatus] ?? 'badge--outline'}"
                >
                  {APPROVAL_STATUS_LABELS[plan.approvalStatus] ?? plan.approvalStatus}
                </span>
                {#if plan.approvalDecidedByName !== null}
                  <span class="approval-decided-by">
                    {plan.approvalDecidedByName}
                  </span>
                {/if}
                {#if plan.approvalDecisionNote !== null}
                  <span
                    class="decision-note-icon"
                    title={plan.approvalDecisionNote}
                  >
                    <i class="fas fa-comment"></i>
                  </span>
                {/if}
              {:else}
                <span class="text-muted">—</span>
              {/if}
            </td>
            <td class="text-nowrap">
              {formatShortDate(plan.updatedAt)}
            </td>
            {#each intervalColumns as col (col)}
              {@const entry = getMatrixEntry(plan.uuid, col)}
              <td class="text-center align-middle">
                {#if entry !== null}
                  {@const worstStatus = getWorstStatus(entry)}
                  <span
                    class="badge {CARD_STATUS_BADGE_CLASSES[worstStatus]} badge--sm"
                    title={getStatusTooltip(entry, INTERVAL_LABELS[col])}
                  >
                    {entry.cardCount}
                  </span>
                {:else}
                  <span
                    class="text-(--color-text-muted)"
                    title="{INTERVAL_LABELS[col]}: keine Karten">—</span
                  >
                {/if}
              </td>
            {/each}
            <td>
              <div class="flex gap-2">
                <a
                  href={`/lean-management/tpm/board/${plan.uuid}`}
                  class="action-icon action-icon--primary"
                  title={messages.BTN_VIEW_BOARD}
                  aria-label={messages.BTN_VIEW_BOARD}
                >
                  <i class="fas fa-th-large"></i>
                </a>
                <a
                  href={`/lean-management/tpm/locations/${plan.uuid}`}
                  class="action-icon action-icon--warning"
                  title="Standorte"
                  aria-label="Standorte"
                >
                  <i class="fas fa-map-marker-alt"></i>
                </a>
                <a
                  href={`/lean-management/tpm/cards/${plan.uuid}`}
                  class="action-icon action-icon--info"
                  title="Karten verwalten"
                  aria-label="Karten verwalten"
                >
                  <i class="fas fa-clone"></i>
                </a>
                <a
                  href={`/lean-management/tpm/board/${plan.uuid}/defects`}
                  class="action-icon action-icon--danger"
                  title="Gesamtmängelliste"
                  aria-label="Gesamtmängelliste"
                >
                  <i class="fas fa-exclamation-triangle"></i>
                </a>
                <a
                  href={`/lean-management/tpm/plan/${plan.uuid}/revisions`}
                  class="action-icon"
                  title="Versionshistorie"
                  aria-label="Versionshistorie"
                >
                  <i class="fas fa-history"></i>
                </a>
                <a
                  href={`/lean-management/tpm/plan/${plan.uuid}`}
                  class="action-icon action-icon--edit"
                  title={messages.BTN_EDIT}
                  aria-label="Plan bearbeiten"
                >
                  <i class="fas fa-edit"></i>
                </a>
                {#if canDelete}
                  <button
                    type="button"
                    class="action-icon action-icon--delete"
                    title={messages.BTN_DELETE}
                    aria-label="Plan löschen"
                    onclick={() => {
                      ondelete(plan);
                    }}
                  >
                    <i class="fas fa-trash"></i>
                  </button>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Legend -->
  <div class="matrix-legend">
    <span class="matrix-legend__item">
      <span class="badge badge--success badge--sm">3</span>
      {CARD_STATUS_LABELS.green}
    </span>
    <span class="matrix-legend__item">
      <span class="badge badge--danger badge--sm">2</span>
      {CARD_STATUS_LABELS.red}
    </span>
    <span class="matrix-legend__item">
      <span class="badge badge--warning badge--sm">1</span>
      {CARD_STATUS_LABELS.yellow}
    </span>
    <span class="matrix-legend__item">
      <span class="badge badge--error badge--sm">1</span>
      {CARD_STATUS_LABELS.overdue}
    </span>
    <span class="matrix-legend__item">
      <span class="text-(--color-text-muted)">—</span>
      Keine Karten
    </span>
  </div>

  <!-- Pagination — anchor links per Per-Page DoD §4 -->
  {#if pagination.totalPages > 1}
    <nav
      class="pagination mt-6"
      aria-label="Seitennavigation"
    >
      {#if pagination.hasPrev}
        <a
          href={pageHref(pagination.page - 1)}
          class="pagination__btn pagination__btn--prev"
          rel="prev"
        >
          <i class="fas fa-chevron-left"></i>
          Zurück
        </a>
      {:else}
        <button
          type="button"
          class="pagination__btn pagination__btn--prev"
          disabled
        >
          <i class="fas fa-chevron-left"></i>
          Zurück
        </button>
      {/if}

      <div class="pagination__pages">
        {#each pageRange as page (page)}
          <a
            href={pageHref(page)}
            class="pagination__page"
            class:pagination__page--active={page === pagination.page}
            aria-current={page === pagination.page ? 'page' : undefined}
          >
            {page}
          </a>
        {/each}
      </div>

      {#if pagination.hasNext}
        <a
          href={pageHref(pagination.page + 1)}
          class="pagination__btn pagination__btn--next"
          rel="next"
        >
          Weiter
          <i class="fas fa-chevron-right"></i>
        </a>
      {:else}
        <button
          type="button"
          class="pagination__btn pagination__btn--next"
          disabled
        >
          Weiter
          <i class="fas fa-chevron-right"></i>
        </button>
      {/if}
    </nav>
    <span class="pagination__info mt-2">
      Zeige {plans.length} von {pagination.total} Plänen
    </span>
  {/if}
{/if}

<style>
  .matrix-legend {
    display: flex;
    gap: 1.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-glass-border);
    margin-top: 0.75rem;
  }

  .matrix-legend__item {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .approval-decided-by {
    margin-left: 0.375rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .decision-note-icon {
    margin-left: 0.25rem;
    color: var(--color-text-muted);
    cursor: help;
    font-size: 0.8rem;
  }
</style>
