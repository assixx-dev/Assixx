# HOW-TO: Fix Pagination for `manage-*` Pages

> **Created:** 2026-05-01 · **Status:** Living Doc · **Reference Impls:** `manage-employees`, `manage-admins`
>
> Step-by-step pattern + triage list for the systematic pagination bug across all `manage-*` pages.

---

## Problem

Backend `PaginationSchema` (in `backend/src/schemas/common.schema.ts`) defaults `limit = 10`. Any list endpoint that extends `PaginationSchema` returns at most 10 items unless the caller sends `?limit=N`. Frontend `manage-*` pages historically called those endpoints **without** `?limit` and **without a pagination UI** — users saw only the first 10 records, with no way to access the rest.

`extractResponseData` in `frontend/src/lib/server/api-fetch.ts` strips the `meta.pagination` envelope produced by `ResponseInterceptor` (ADR-007), so the frontend has no signal that more data exists. Result: silent data truncation.

**Bug confirmed in:** `manage-employees` (10/82 employees) → fixed v0.x.x. Same pattern audited across 11 `manage-*` pages.

---

## Fix Pattern (4 Files)

Reference implementation: `frontend/src/routes/(app)/(shared)/manage-employees/`. Mirror this structure exactly.

### 1. `+page.server.ts` — append `&limit=100` to the list URL

```ts
// BEFORE
apiFetch<Foo[]>('/foos', token, fetch),

// AFTER
// limit=100 = backend cap (PaginationSchema.max). For tenants with > 100
// foos we will need server-driven pagination (Phase 2) — current scope is
// client-side pagination on the loaded set (KISS, mirrors manage-employees).
apiFetch<Foo[]>('/foos?limit=100', token, fetch),
```

### 2. `_lib/types.ts` — add `PaginationPageItem`

```ts
export type PaginationPageItem = { type: 'page'; value: number; active?: boolean } | { type: 'ellipsis' };
```

### 3. `_lib/utils.ts` — `<NAME>_PER_PAGE` constant + `getVisiblePages()`

Copy the helper verbatim from `manage-employees/_lib/utils.ts` (3 lines + 30 lines). Rename only the constant: `EMPLOYEES_PER_PAGE` → `<NAME>_PER_PAGE`. Keep value at `25` for consistency.

### 4. `+page.svelte` — wire it up

- Import `<NAME>_PER_PAGE`, `getVisiblePages` from `./_lib/utils`
- Add state: `let currentPage = $state(1);`
- Add three derived: `totalPages`, `paginatedFoos`, `visiblePages`
- Add `$effect` that resets `currentPage = 1` when filter/search changes (use `void` reads on tracked vars)
- Add three one-line handlers: `goToPage`, `handlePreviousPage`, `handleNextPage`
- In the `{#each}` loop: switch `filteredFoos` → `paginatedFoos` (table only — keep `filteredFoos` for `SearchResults` dropdown so search still spans all pages)
- After `</table>`: insert the `<nav class="pagination">` block (copy verbatim from `manage-employees/+page.svelte`, gate with `{#if totalPages > 1}`)

The exact markup uses `pagination`, `pagination__btn`, `pagination__btn--prev/--next`, `pagination__pages`, `pagination__page`, `pagination__page--active`, `pagination__ellipsis`, `pagination__info` — all defined in `frontend/src/design-system/primitives/navigation/pagination.css`.

### Validation Checklist

```bash
cd frontend
pnpm exec prettier --write src/routes/.../manage-X/
NODE_OPTIONS='--max-old-space-size=8192' pnpm exec eslint src/routes/.../manage-X/
pnpm exec svelte-check --tsconfig ./tsconfig.json 2>&1 | grep manage-X
```

All three must pass with 0 errors. Watch for `svelte/max-lines-per-block` (script cap = 400 lines) — pagination handlers must be one-liners (`{ if (cond) currentPage = N; }`) to fit.

---

## Triage — Outstanding Pages

Sorted by severity (largest data loss first). Backend defaults verified by inspecting each `*.dto.ts`.

### High — silent data loss possible

| Page                  | Endpoint               | Backend Default                 | DB Count (T1) | Status                                                           |
| --------------------- | ---------------------- | ------------------------------- | ------------- | ---------------------------------------------------------------- |
| ✅ `manage-employees` | `/users?role=employee` | 10                              | 82 active     | **Phase 2 done** (Phase 4.1, addon-gated reference impl)         |
| ✅ `manage-admins`    | `/users?role=admin`    | 10                              | 3             | **Phase 2 done** (Phase 4.2, root-only reference impl)           |
| ✅ `manage-surveys`   | `/surveys`             | 10 (extends `PaginationSchema`) | —             | **Phase 2 done** (Phase 4.10, three-section pivot + §D20 merger) |
| ✅ `manage-root`      | `/users?role=root`     | 10                              | 1 per tenant  | **Phase 2 done** (Phase 5.2.2, in-place migration §D26)          |

### Medium — already paginated, verify UI presence

| Page                  | Endpoint                                                | Backend Default | Notes                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ `manage-assets`    | `/assets`                                               | 20              | **Phase 2 done** (Phase 4.4, broken-not-paginated §D8 — full backend rebuild)                                                                                                                                                                                                                  |
| ✅ `manage-dummies`   | `/dummy-users` (URL-driven `?page=N&search=&isActive=`) | 20 (FE caller)  | **canonical reference impl** (Phase 3, 2026-05-04). Backend returns `{ items, pagination: { page, limit, total, totalPages } }` (interceptor wraps to ADR-007 envelope) and FE reads `?page`/`?search`/`?isActive` from the URL via the helpers in `frontend/src/lib/utils/url-pagination.ts`. |
| ✅ `manage-approvals` | `/approvals` (URL-driven)                               | 20 (sent)       | **Phase 2 done** (Phase 4.3, broken-by-mirror — full rebuild)                                                                                                                                                                                                                                  |

### Low — backend has no pagination (no truncation, but UX consistency open)

| Page                 | Endpoint       | Notes                                                |
| -------------------- | -------------- | ---------------------------------------------------- |
| `manage-halls`       | `/halls`       | No `PaginationSchema` extension — full list returned |
| `manage-areas`       | `/areas`       | Same                                                 |
| `manage-departments` | `/departments` | Same                                                 |
| `manage-teams`       | `/teams`       | Same                                                 |

For the Low tier: pagination is **not required** for correctness. Add only if a tenant has > 50 entries and the table becomes unscrollable.

---

## Secondary Endpoints (Modal Dropdowns)

These calls also hit `PaginationSchema` (default 10) and feed dropdown options inside modals. Default-truncation here means **leads/team-members vanish from selectors**:

| Caller                               | Endpoint                                          | Status                                                                                             |
| ------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `manage-areas`, `manage-departments` | `/users?role=admin&isActive=1&position=area_lead` | `&limit=100` ceiling — Known Limit. #2 (volumes structurally <100; rejected typeahead — see §4.12) |
| `manage-areas`, `manage-departments` | `/users?role=root&isActive=1&position=area_lead`  | `&limit=100` ceiling — Known Limit. #2                                                             |
| `manage-teams`                       | `/users?isActive=1&position=team_lead`            | `&limit=100` ceiling — Known Limit. #2                                                             |
| `manage-teams`                       | `/users?role=employee`                            | **Phase 4.12 done** — `PickerTypeahead` (debounced `?search=…`, no ceiling) replaces the band-aid  |

**Pattern for new pickers:** reuse `frontend/src/lib/components/PickerTypeahead.svelte` with the appropriate `?role=…&position=…` query — no `&limit=100` band-aid.

---

## Phase 2 — Server-Driven Pagination ✅ DONE 2026-05-07

> **Status:** **CANONICAL & ENFORCED** as of 2026-05-07 (plan closed Session 15b). Pattern is now binding for every new list page — see [ADR-058](../infrastructure/adr/ADR-058-server-driven-pagination.md). Reference impls: `frontend/src/routes/(app)/(root)/manage-dummies/` + `backend/src/nest/dummy-users/` (canonical, root-only) and `frontend/src/routes/(app)/(shared)/manage-employees/` + `/users` endpoint (canonical, addon-gated). All 12 list endpoints + 2 in-place migrations from [FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN](../FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md) §4 + §5.2 copy this pattern verbatim.
>
> **Default for new pages:** every new list page MUST adopt this pattern from day one — no "Phase-1 client-side band-aid as starting point" path is allowed. ADR-058's code-review checklist is binding.

The Phase-1 `&limit=100` band-aid above is a hard ceiling — silently truncates at the 101st record AND leaves search/filter operating only on the loaded subset. Phase 2 fixes both: backend ships the canonical ADR-007 envelope, FE reads `?page` / `?search` / any filter from the URL.

### Phase-2 helpers (already shipped)

| Helper                 | File                                       | Purpose                                                               |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `apiFetchPaginated<T>` | `frontend/src/lib/server/api-fetch.ts`     | ADR-007 envelope reader → `{ data: T[], pagination }`                 |
| `readPageFromUrl`      | `frontend/src/lib/utils/url-pagination.ts` | `?page=N` → `number` (default `1`)                                    |
| `readSearchFromUrl`    | `frontend/src/lib/utils/url-pagination.ts` | `?search=...` → trimmed string (default `''`)                         |
| `readFilterFromUrl<T>` | `frontend/src/lib/utils/url-pagination.ts` | Allow-list-validated string-enum reader                               |
| `buildPaginatedHref`   | `frontend/src/lib/utils/url-pagination.ts` | Emits ONLY non-default params (canonical first-page URL has no query) |

DO NOT re-implement these locally. DO NOT reach into `extractResponseData` for paginated responses.

### 1. Backend — ADR-007 envelope

Service returns `{ items: T[], pagination: { page, limit, total, totalPages } }`. `ResponseInterceptor` ([ADR-007](../infrastructure/adr/ADR-007-api-response-standardization.md)) detects this shape (`response.interceptor.ts:65 isPaginatedResponse`) and emits `{ success, data: items, meta: { pagination }, timestamp }` on the wire.

```ts
// <feature>.types.ts
export interface PaginatedXxx {
  items: Xxx[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// <feature>.service.ts list()
const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
return { items, pagination: { page, limit, total, totalPages } };
```

`hasNext` / `hasPrev` are NOT in the backend contract — they are FE-derived in `apiFetchPaginated` (`page < totalPages` / `page > 1`).

API integration test must assert the envelope round-trip — see `backend/test/dummy-users.api.test.ts` "should echo ?page=2&limit=10 with correct totalPages math" for the canonical assertion shape.

### 2. `+page.server.ts` — URL → state → backend

```ts
import { apiFetchPaginated } from '$lib/server/api-fetch';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import { redirect } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';
import type { Xxx } from './_lib/types';

const STATUS_FILTERS = ['all', '0', '1', '3'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, '/login');
  }

  // URL → state. Each helper falls back to a defined default.
  const page = readPageFromUrl(url);
  const search = readSearchFromUrl(url);
  const status = readFilterFromUrl<StatusFilter>(url, 'isActive', STATUS_FILTERS, 'all');

  // State → backend query string. Defaults are NEVER sent — keeps URLs canonical.
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  if (search !== '') params.set('search', search);
  if (status !== 'all') params.set('isActive', status);

  const result = await apiFetchPaginated<Xxx>(`/xxx?${params.toString()}`, token, fetch);

  return {
    items: result.data,
    pagination: result.pagination,
    search,
    statusFilter: status === 'all' ? ('all' as const) : Number.parseInt(status, 10),
  };
};
```

### 3. `+page.svelte` — read from `data`, navigate via URL

```svelte
<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';

  import { buildPaginatedHref } from '$lib/utils/url-pagination';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  // No `$state` shadow copies — URL is the single source of truth.
  const items = $derived(data.items);
  const pagination = $derived(data.pagination);
  const searchTerm = $derived(data.search);
  const statusFilter = $derived(data.statusFilter);

  const BASE_PATH = '/xxx';

  function pageHref(targetPage: number): string {
    return resolve(
      buildPaginatedHref(BASE_PATH, {
        page: targetPage,
        search: searchTerm,
        isActive: statusFilter === 'all' ? undefined : String(statusFilter),
      }),
    );
  }

  function navigateFilters(next: { search?: string; statusFilter?: number | 'all' }): void {
    const nextSearch = next.search ?? searchTerm;
    const nextStatus = next.statusFilter ?? statusFilter;
    void goto(
      resolve(
        buildPaginatedHref(BASE_PATH, {
          // page omitted → resets to 1 on filter change.
          search: nextSearch,
          isActive: nextStatus === 'all' ? undefined : String(nextStatus),
        }),
      ),
      { keepFocus: true },
    );
  }

  function handleSearch(term: string): void {
    // SearchBar debounces internally (300 ms).
    navigateFilters({ search: term });
  }

  function handleStatusFilter(value: number | 'all'): void {
    navigateFilters({ statusFilter: value });
  }
</script>

{#if pagination.totalPages > 1}
  <nav class="pagination mt-6" aria-label="Seitennavigation">
    {#if pagination.hasPrev}
      <a class="pagination__btn pagination__btn--prev" href={pageHref(pagination.page - 1)} rel="prev">
        <i class="fas fa-chevron-left"></i>
        Zurück
      </a>
    {:else}
      <button type="button" class="pagination__btn pagination__btn--prev" disabled>
        <i class="fas fa-chevron-left"></i>
        Zurück
      </button>
    {/if}

    <div class="pagination__pages">
      {#each Array.from({ length: pagination.totalPages }, (_: unknown, i: number) => i + 1) as page (page)}
        {#if page === pagination.page}
          <span class="pagination__page pagination__page--active" aria-current="page">{page}</span>
        {:else}
          <a class="pagination__page" href={pageHref(page)}>{page}</a>
        {/if}
      {/each}
    </div>

    {#if pagination.hasNext}
      <a class="pagination__btn pagination__btn--next" href={pageHref(pagination.page + 1)} rel="next">
        Weiter
        <i class="fas fa-chevron-right"></i>
      </a>
    {:else}
      <button type="button" class="pagination__btn pagination__btn--next" disabled>
        Weiter
        <i class="fas fa-chevron-right"></i>
      </button>
    {/if}
  </nav>
{/if}
```

`<a href>` instead of `<button onclick>` is non-negotiable: native back/forward, right-click → new tab, and screen-reader semantics all depend on it. `<button disabled>` is the explicit fallback for `hasPrev` / `hasNext = false` because anchors without `href` are not natively disabled.

### 4. After mutations: `invalidateAll()`

```ts
async function handleSave(formData: XxxFormData): Promise<void> {
  await createOrUpdate(formData);
  // Retrigger the SSR load on the SAME URL — preserves ?page / ?search / filters.
  await invalidateAll();
}
```

NEVER swap `invalidateAll()` for a manual refetch helper. `invalidateAll()` re-runs `+page.server.ts` against the current URL, so the user stays on their page with their filters.

### 5. Filter rule (D5 lesson)

Every page-level filter (status, role, team, etc.) MUST be URL state, NOT client `$state`. Counter-example: leaving a status filter as client state while migrating `?page` / `?search` to URL creates a desync bug — clicking a pagination `<a href={pageHref(2)}>` re-runs the server load with no `isActive` param, dropping the filter the user just selected. URL convention: `?<paramName>=<value>` mirrors the backend query param verbatim — no FE-side aliasing layer (backend accepts `?isActive=1` → FE emits `?isActive=1`, never `?status=active`). See [masterplan §Spec Deviations D5](../FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md#spec-deviations).

### Validation Checklist

```bash
cd /home/scs/projects/Assixx/frontend
pnpm exec prettier --write src/routes/.../<page>/
NODE_OPTIONS='--max-old-space-size=8192' pnpm exec eslint src/routes/.../<page>/
pnpm run check  # sync:svelte → tsc -p frontend → tsc -p backend
```

All three must pass with 0 errors. Manual smoke (per masterplan per-page DoD §4):

- [ ] Tenant with > 25 records sees ALL pages.
- [ ] Search returns matches that exist on page ≥ 3.
- [ ] Filter (status / role / etc.) re-fetches and resets to page 1.
- [ ] Browser back-button restores previous page state.
- [ ] Mutation (create / delete) refreshes the current page without losing `?page` / `?search` / filter state.

---

## References

- `backend/src/schemas/common.schema.ts` — `PaginationSchema` definition
- `backend/src/nest/common/interceptors/response.interceptor.ts` — wraps paginated responses with `meta.pagination`
- `frontend/src/lib/server/api-fetch.ts` — `extractResponseData` (drops `meta.pagination`)
- `frontend/src/design-system/primitives/navigation/pagination.css` — markup reference
- [ADR-007: API Response Standardization](../infrastructure/adr/ADR-007-api-response-standardization.md)
- [ADR-030: Zod Validation Architecture](../infrastructure/adr/ADR-030-zod-validation-architecture.md)
- [ADR-058: Server-Driven Pagination as Canonical List Pattern](../infrastructure/adr/ADR-058-server-driven-pagination.md) — binding pattern + code-review checklist
- [FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN](../FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md) — execution masterplan (29 sessions, audit + 12 backend rebuilds + 14 FE migrations + 12 API tests + ADR + HOW-TO)
