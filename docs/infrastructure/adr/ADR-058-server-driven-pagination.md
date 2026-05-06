# ADR-058: Server-Driven Pagination as Canonical List Pattern

| Metadata                | Value                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**              | Accepted                                                                                                                                                        |
| **Date**                | 2026-05-07                                                                                                                                                      |
| **Decision Makers**     | SCS-Technik Team                                                                                                                                                |
| **Affected Components** | All `manage-*` pages, all addon list views, `apiFetchPaginated*` helpers, `ResponseInterceptor` (ADR-007)                                                       |
| **Supersedes**          | —                                                                                                                                                               |
| **Related ADRs**        | ADR-007 (API Response Standardization), ADR-012 (Frontend Route Security), ADR-020 (Per-User Permissions), ADR-030 (Zod Validation), ADR-045 (Permission Stack) |

---

## Context

Assixx is a multi-tenant SaaS for industrial companies (50–500 employees per tenant). Beta-launch is imminent and target tenants will routinely store 100+ records of any business type (employees, blackboard entries, work orders, KVP suggestions, calendar events, …).

### The Problem (pre-2026-05-01)

Every list endpoint in the backend extends `PaginationSchema` with default `limit = 10` (`backend/src/schemas/common.schema.ts`). Frontend `manage-*` pages historically called those endpoints either:

1. Without `?limit` at all → silent truncation at the 10th record, OR
2. With `?limit=100` band-aid → hard ceiling at the 100th record (PaginationSchema.max), OR
3. With server-side pagination but without URL-state → `?page=1` hardcoded in `+page.server.ts`, no way to navigate further.

`extractResponseData` in `frontend/src/lib/server/api-fetch.ts` strips the `meta.pagination` envelope produced by `ResponseInterceptor` (ADR-007), so the FE had no signal that more data existed. Result: **silent data truncation**, plus filters/searches that operated only on the loaded subset (B1 audit class — see `FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md` §0.2.1).

### Greenfield Constraint

Per CLAUDE.md "Greenfield-Production (since 2026-04-19)": no live prod tenants. Breaking changes to URL/state contracts are allowed without backwards-compat shims. That window closes the moment the first paying tenant signs up — making this refactor a hard pre-Beta requirement.

### Requirements

- Every list page must scale beyond 100 records per tenant per type without code changes.
- Filter and search must span all pages (B1-class truncation impossible).
- URL must be the single source of truth for pagination + search + filter state (bookmarkable, browser-back-restorable).
- Mutations must keep the user on their current page slice + filter context.
- Pattern must be copy-paste-ready: every new list page reuses the same shape.
- Pattern must enforce ADR-007 envelope conformance — `meta.pagination` is the contract, not an opt-in.

---

## Decision

**Server-driven pagination with URL-state is the canonical list-rendering pattern across all `manage-*` and addon list pages.**

The pattern is:

1. **Backend** — list service returns `{ items: T[], pagination: { page, limit, total, totalPages } }`. `ResponseInterceptor` (ADR-007) detects this shape (`response.interceptor.ts:65 isPaginatedResponse` — recognised wrapper keys: `items` / `entries` / `data`) and emits the canonical envelope `{ success, data: items, meta: { pagination }, timestamp }` on the wire. `hasNext` / `hasPrev` are NOT in the backend contract; they are FE-derived in `apiFetchPaginated`.
2. **Frontend SSR** (`+page.server.ts`) — read `?page` / `?search` / page-specific filters from `url.searchParams` via the helpers in `frontend/src/lib/utils/url-pagination.ts`, build `URLSearchParams` (defaults NEVER emitted), call `apiFetchPaginated<T>` (or `apiFetchPaginatedWithPermission<T>` for addon-gated pages), return `{ data: T[], pagination, search, filters }` to the page.
3. **Frontend page** (`+page.svelte`) — read pagination + search + filters from `data` via `$derived`. NO `$state` shadow of these values. Pagination UI uses `<a href={pageHref(N)}>` (anchor-based, native back/forward, right-click → new tab), `<button disabled>` for `hasPrev`/`hasNext = false`. Filter changes trigger `goto(buildPaginatedHref(...))` with `keepFocus: true`.
4. **Mutations** — `await invalidateAll()` re-runs the SSR load on the same URL, preserving `?page`/`?search`/filters across create/update/delete.

### Single Source of Truth: URL

The canonical contract is enumerated in `frontend/src/lib/utils/url-pagination.ts`:

| Helper                 | Default           | Purpose                                                               |
| ---------------------- | ----------------- | --------------------------------------------------------------------- |
| `readPageFromUrl`      | `1`               | `?page=N` → integer                                                   |
| `readSearchFromUrl`    | `''`              | `?search=…` → trimmed string                                          |
| `readFilterFromUrl<T>` | (caller-supplied) | Allow-list-validated string-enum                                      |
| `buildPaginatedHref`   | —                 | Emits ONLY non-default params (canonical first-page URL has no query) |

**Filter rule (D5 lesson):** every page-level filter MUST be URL state, NOT client `$state`. Counter-example: leaving a status filter as client state while `?page` migrates to URL creates a desync — clicking `<a href={pageHref(2)}>` re-runs the server load with no `isActive`, dropping the filter the user just selected. URL convention: `?<paramName>=<value>` mirrors the backend query param verbatim — no FE-side aliasing layer (`?isActive=1`, never `?status=active`).

### Permission-Aware Variant (ADR-020)

Addon-gated pages compose with permission detection via `apiFetchPaginatedWithPermission<T>`: a 403 response surfaces as `{ permissionDenied: true, data: [], pagination: <empty> }` so the page can render `<PermissionDenied />` (Phase 2 §2.1 + §D6). Root-only pages (`(root)` route group, fail-closed) use the base `apiFetchPaginated<T>` — no permission-denial UX path needed.

### Audit Discipline

Pre-flight per-endpoint audit is mandatory before declaring "Standard FE-only migration". The lesson chain §D8 → §D9 → §D15 → §D17 → §D18 → §D21 → §D22 → §D26 in the masterplan documents how envelope drift hides behind 4 distinct symptom classes:

1. Backend has no pagination at all (§D8 — `/assets`).
2. Wrapper-key drift: response uses non-canonical key (`{ documents: ... }` / `{ suggestions: ... }`) not in `isPaginatedResponse`'s recognised set → `meta.pagination` never emitted (§D9, §D18).
3. Shape drift: wrapper key recognised but `pagination` block absent → no `meta.pagination` (§D15, §D21).
4. Sibling-map drift: NOVEL non-pagination object key at root, silently stripped by `extractPaginatedItems` (§D17 — `customValuesByItem`).

The audit checklist before every list-page migration:

```bash
grep 'Promise<Paginated' backend/src/nest/<feature>/
grep -rn '/<feature-endpoint>' frontend/src
```

…then verify each consumer's response-extraction pattern survives `extractResponseData`'s array-lift.

---

## Alternatives Considered

### A. Client-side `?limit=100` band-aid (status quo before this plan)

**Rejected.** Hard ceiling at 100 records; B1-class truncation when status filter applies after the limit cap (e.g. 99 inactive + 2 active employees → 1 active hidden behind the 100-record fetch boundary). Search/filter operate only on the loaded subset → user types "Müller", sees only matches in the first 100, has no signal that page 2 of matches exists. Documented in `HOW-TO-FIX-MANAGE-PAGINATION.md` (Phase 1) as deliberate tech-debt. Phase 5.2 (this plan) eliminated all live `?limit=100` band-aids.

### B. Cursor / keyset pagination

**Rejected for V1.** Cursor pagination is the right answer beyond ~10 k records per tenant per type because OFFSET scans the table linearly. At Beta-target volume (50–500 employees, 100–1 000 entries per addon per tenant), `page` + `limit` (offset) is acceptable and simpler. KISS. Re-evaluate post-Beta if a real tenant grows past 10 k of any type — the rewrite is per-endpoint and does not touch the FE contract (FE still consumes `{ data, pagination }`).

### C. GraphQL Relay-style connections

**Rejected.** No GraphQL in stack (Assixx is REST-only — `/api/v2/*`, raw `pg`, no ORM). Adopting GraphQL just for pagination is massive scope creep.

### D. Infinite scroll instead of paginated UI

**Rejected.** Loses bookmarkability, loses browser-back navigation, loses position recall after mutation, loses screen-reader semantics. Pagination is also a stronger affordance for "I am on page 3 of 17" — infinite scroll hides the data volume. Industrial admins routinely jump to specific positions; infinite scroll punishes that.

### E. Library-managed table state (TanStack Table, AG-Grid, …)

**Rejected.** Adds a runtime dependency, brings its own state model (often duplicating URL state), and ties the design system to the library's markup. Assixx's design system primitives (`pagination__btn`, `pagination__page`, etc.) are first-class and reused across all migrated pages — no library lock-in.

---

## Consequences

### Positive

1. **Scales beyond 100 records per tenant per type** — no hard ceiling; the only operational limit is OFFSET performance at 10 k+ which is well above Beta volume.
2. **Filter + search span all pages** — server applies WHERE clause, FE consumes the filtered+paginated slice; B1-class truncation is structurally impossible.
3. **Bookmarkable + back-button-friendly** — `/manage-employees?page=3&search=Müller&isActive=1` is a stable URL.
4. **Mutations preserve user position** — `invalidateAll()` re-runs the load on the same URL.
5. **Copy-paste-ready pattern** — every Phase-4 migration in `FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md` reused the same shape verbatim. Two reference impls (`manage-dummies` for `(root)`, `manage-employees` for addon-gated) cover both permission-stack variants.
6. **ADR-007 envelope is now enforced** — `apiFetchPaginated` type-guard rejects non-canonical responses cleanly; new list endpoints cannot ship envelope drift without failing at the FE boundary.
7. **API integration tests verify the round-trip** — every migrated endpoint has a test asserting `?page=N&limit=M` returns the correct slice + correct `meta.pagination.totalPages` (Step 5.1).

### Negative

1. **Every new list page MUST adopt the pattern from day one** — code review enforces it. There is no "lightweight client-side pagination as starting point" path.
2. **Audit discipline is mandatory** — pre-flight grep before every migration; declaring "Standard FE-only migration" without audit produced 8 separate spec-deviation entries (§D8 through §D22) during Phase 4. Same lesson applies to NEW list endpoints.
3. **OFFSET-based pagination breaks down past ~10 k records per tenant per type** — V1 limitation; cursor migration plan needed if a real tenant hits this.
4. **URL-only state means no in-memory filter shortcuts** — every status toggle / search keystroke triggers a server round-trip. Mitigated by 300 ms search debounce; observable cost is 1 round-trip per user-initiated state change.

### Open Items / Known Limitations (V1)

Documented in `FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md` §"Known Limitations":

- `manage-halls` / `manage-areas` / `manage-departments` / `manage-teams` — backend does not paginate; out of V1 scope (typical tenant: <100 of any).
- 5 lead-picker modal dropdowns — get `&limit=100` and stay (volumes structurally <100; eliminated by Phase 4.12 typeahead for the employee-picker only).
- `WorkOrderCommentsService.listComments` — same flat shape as pre-4.7 `/work-orders`, scoped out (≤20 comments per work order in practice).
- `tpm-executions.service.ts` — `PaginatedDefects` + `PaginatedExecutions` share §D15 mirror, scoped out.
- Documents folder-sidebar count badges, KVP `BadgeCounts` — counted only loaded subset pre-migration; dropped to honour the §D11 dishonest-UI rule.
- TPM plan status filter, employee overview, kamishibai board — visual non-list views with hardcoded `?limit=50`/`?limit=200` ceilings; V2 follow-up.

### Code-Review Checklist (binding)

For every PR adding or modifying a list endpoint:

- [ ] Service returns `{ items: T[], pagination: { page, limit, total, totalPages } }` — wrapper key is one of `items` / `entries` / `data` (anything else fails `isPaginatedResponse`).
- [ ] `pagination` block exists at the wrapper top-level — `'pagination' in result` is the FIRST gate.
- [ ] No sibling map at the wrapper root (denormalise per-row, not per-collection).
- [ ] FE consumer uses `apiFetchPaginated<T>` or `apiFetchPaginatedWithPermission<T>` (NOT `apiFetch<T[]>`).
- [ ] Page-level filters are URL state, not `$state` (§D5).
- [ ] Mutations call `invalidateAll()` — never a manual refetch helper.
- [ ] Pagination markup is anchor-based (`<a href={pageHref(N)}>`), not button-onclick.
- [ ] API integration test asserts the envelope round-trip for `?page=N&limit=M`.

---

## Verification

| Check                                                            | Result                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| 12/12 list endpoints migrated to canonical envelope (Phase 4)    | ✅ closed Session 13 (2026-05-06)                       |
| 2 in-place migrations beyond §Phase-4 table (Phase 5.2)          | ✅ closed Session 15a (2026-05-07)                      |
| API integration tests on all 12 migrated endpoints (Phase 5.1)   | ✅ closed Session 14c (2026-05-06)                      |
| Zero live `?limit=100` band-aids in `frontend/src/{routes,lib}/` | ✅ verified Session 15a (4 tombstone doc-comments only) |
| `cd frontend && pnpm run check`                                  | ✅ 2596 files / 0 errors / 0 warnings                   |
| ESLint on touched files                                          | ✅ exit 0                                               |

---

## References

- [FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md](../../FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md) — execution masterplan (29 sessions, full audit + 12 backend rebuilds + 14 FE migrations + 12 API integration tests)
- [HOW-TO-FIX-MANAGE-PAGINATION.md](../../how-to/HOW-TO-FIX-MANAGE-PAGINATION.md) — copy-paste-ready snippets + triage tables
- [ADR-007: API Response Standardization](./ADR-007-api-response-standardization.md) — `{ success, data, meta, timestamp }` envelope, `meta.pagination` shape
- [ADR-012: Frontend Route Security Groups](./ADR-012-frontend-route-security-groups.md) — `(root)` / `(admin)` / `(shared)` group semantics
- [ADR-020: Per-User Feature Permissions](./ADR-020-per-user-feature-permissions.md) — `apiFetchPaginatedWithPermission` 403-detection composition
- [ADR-030: Zod Validation Architecture](./ADR-030-zod-validation-architecture.md) — `PaginationSchema`, `createIdParamSchema`
- [ADR-045: Permission & Visibility Design](./ADR-045-permission-visibility-design.md) — 3-layer permission stack
- `frontend/src/lib/server/api-fetch.ts` — `apiFetchPaginated`, `apiFetchPaginatedWithPermission`, `extractResponseData`
- `frontend/src/lib/utils/url-pagination.ts` — `readPageFromUrl`, `readSearchFromUrl`, `readFilterFromUrl`, `buildPaginatedHref`
- `backend/src/nest/common/interceptors/response.interceptor.ts:65` — `isPaginatedResponse` shape detector
- `backend/src/schemas/common.schema.ts` — `PaginationSchema` (default `limit=10`, max `100`)
