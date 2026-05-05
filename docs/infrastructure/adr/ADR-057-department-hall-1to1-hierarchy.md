# ADR-057: Department/Team Hall Hierarchy — 1:1 Strict Model

| Metadata                | Value                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**              | Accepted                                                                                                                                                                    |
| **Date**                | 2026-05-06                                                                                                                                                                  |
| **Decision Makers**     | Simon Öztürk                                                                                                                                                                |
| **Affected Components** | PostgreSQL (departments, halls, dropped junctions), Backend (areas/departments/teams/halls/organigram services), Frontend (manage-areas/-departments/-teams modals + pages) |
| **Supersedes**          | Earlier additive M:N hall-assignment scheme described in ADR-034 §"Hall Hierarchy"                                                                                          |
| **Related ADRs**        | ADR-014 (migration), ADR-019 (RLS), ADR-034 (hierarchy labels), ADR-045 (permission stack)                                                                                  |

---

## Context

Halls were originally bolted onto the existing `Area → Department → Team` hierarchy as an **additive M:N** model:

- `halls.area_id` (1:N) — a Hall belongs to one Area.
- `department_halls` junction (M:N) — Department had **implicit** halls via Area-match
  PLUS **direct** cross-area halls in this junction.
- `team_halls` junction (M:N) — Team had its own hall list, independent of its
  parent Department.

This model produced two real bugs we hit in `wepg` tenant:

1. **TeamFormModal showed "Keine Zuordnung"** for a team whose parent department's
   area had a hall (Halle 1). The modal filter consulted only
   `hall.departmentIds` (junction-based), ignoring the area-implicit edge → the
   inherited hall was invisible in the dropdown despite the DepartmentModal
   correctly displaying "Halle automatisch zugeordnet".
2. **Inconsistency was reachable.** `assignHallsToTeam()` had **no** validation
   against the parent department's area or hall — a Team could be assigned a
   hall outside its parent department's area, breaking the physical hierarchy.

Two divergent mental models lived in two modals of the same hierarchy concept;
junction-driven UI logic kept duplicating itself with subtle drift.

### Requirements

- Single, unambiguous mental model: **a Team is in exactly one Hall, namely
  the one its Department points at**.
- Database-level guarantee: a Department's hall must belong to the same Area
  as the Department itself.
- Greenfield-friendly: no production data, breaking changes acceptable
  ([CLAUDE.md "Greenfield-Production"](../../CLAUDE.md), ADR-050).

---

## Decision

**Strict 1:1 hall hierarchy** — the M:N junctions are dropped and replaced
with a single `departments.hall_id` FK column. Teams have **no own hall
column**; they inherit transitively via `team.department.hall_id`.

```text
Hall (1) ─< Area (1) ─< Department (1) ─< Team (N)
                              │
                              └─ hall_id ─── Hall (1, must match Area)
```

### Database Changes (Migration 20260505221345432)

| Operation | Detail                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADD       | `departments.hall_id INTEGER NULL REFERENCES halls(id) ON DELETE SET NULL`                                                                                                                                                         |
| ADD       | Index `idx_departments_hall` btree (hall_id)                                                                                                                                                                                       |
| ADD       | Trigger `trg_enforce_dept_hall_area_match` (BEFORE INSERT/UPDATE on departments) — enforces `halls.area_id = departments.area_id` whenever `hall_id IS NOT NULL`. Raises `BadRequestException`-equivalent SQL exception otherwise. |
| ADD       | Trigger `trg_prevent_hall_area_change_with_depts` (BEFORE UPDATE OF area_id on halls) — blocks an area change while any department references the hall. Forces UI to clear `departments.hall_id` first.                            |
| DROP      | `department_halls` junction table (CASCADE: indexes, RLS policy, GRANTs)                                                                                                                                                           |
| DROP      | `team_halls` junction table (CASCADE)                                                                                                                                                                                              |

The migration **fails loud** with `RAISE EXCEPTION` if either junction has
rows or if any department had multiple halls — manual cleanup is required
before the schema collapse runs.

`down()` recreates both junction tables (incl. RLS + Triple-User-Model
GRANTs per ADR-019), back-fills `department_halls` from
`departments.hall_id`, then drops the column. **Lossy** for any cross-area
hall data that was originally in the junction (we already verified zero rows
at migration time — see ADR-014 §"Required Patterns" RAISE EXCEPTION
gate).

### Backend API Changes

| Old                                          | New                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /departments/:id/halls { hallIds }`    | `PUT /departments/:id/hall { hallId }` (single 1:1)                                      |
| `POST /teams/:id/halls { hallIds }`          | **Removed** — team's hall is read-only                                                   |
| `DepartmentResponse.halls: HallEntry[]`      | `DepartmentResponse.hall: HallEntry \| null`, `hallId`, `hallName` (flat for list views) |
| `TeamResponse.hallIds: number[]`             | `TeamResponse.hallId: number \| null`, `hallName: string \| null` (transitive via dept)  |
| `assignHallsToDepartment(deptId, hallIds[])` | `setDepartmentHall(deptId, hallId \| null)`                                              |
| `assignHallsToTeam(...)`                     | **Removed**                                                                              |
| `getDepartmentHallIds() → number[]`          | `getDepartmentHallId() → number \| null`                                                 |
| `getTeamHallIds() → number[]`                | `getTeamHallId() → number \| null` (derived)                                             |

The DB trigger raises a `P0001` SQL exception when an inconsistent assignment
is attempted; the service translates it into `BadRequestException` so the
API returns 400, not 500.

### Frontend UX Changes

- **TeamFormModal** — Hall dropdown removed. Replaced with a read-only info
  badge derived from the selected Department's `hallName`:
  > 🔒 Halle 1 — Quelle: Koffer
  > Die Halle wird automatisch von der Abteilung übernommen. Änderungen
  > erfolgen über die Abteilungs-Verwaltung.
- **DepartmentFormModal** — Multi-select replaced with a single-select that
  shows only halls in the selected Area. If the Area changes, the hall
  selection auto-clears. The "inherited halls" section + "cross-area
  multi-select" section are gone.
- **manage-teams page** — `team.hallName` displayed in a single info badge
  per row (no count, no comma-list).
- **manage-departments page** — single hall name displayed (was: count badge
  - tooltip listing all halls).
- `assignTeamHall()` API call kept as a deprecated no-op stub for backward
  compatibility during cleanup; can be deleted in a follow-up PR.

---

## Alternatives Considered

### A. Keep the additive M:N model + add a validation layer for teams

Add `assignHallsToTeam` validation against `team.department.area_id` and
`department_halls`, mirroring the existing logic in
`assignHallsToDepartment`.

**Rejected.** Validation logic is duplicated in two places (modal +
service), the implicit-vs-explicit distinction stays in the data model, and
the original "two divergent mental models in two modals" problem is not
solved — it just gets a third place where the rule must be reproduced.

### B. Make `team_halls` a view over `team → department → hall`

Keep the junction tables as views so existing API shape stays intact.

**Rejected.** Views would have to be writable (the API still takes
`assignHallsToTeam`), which means INSTEAD-OF triggers on top of the new
column. We'd preserve a deprecated API surface for no real gain — Greenfield
allows breaking changes per CLAUDE.md.

### C. Replace `departments.area_id` with a single `departments.hall_id` and

derive area via `hall.area_id`

Pure 1:1 chain.

**Rejected.** ADR-010 permission model relies on `admin_area_permissions`
plus inheritance to departments via `area_id`. A department in an area
without halls would lose its area, breaking the permission inheritance.
Keeping both `area_id` and `hall_id` (with the trigger checking
consistency) is the simpler, less invasive change.

---

## Consequences

### Positive

1. **Single mental model** — Team's hall is its Department's hall, full stop.
2. **DB-level invariant** — the area-match trigger eliminates the entire
   class of inconsistency bugs the M:N model allowed.
3. **Smaller surface** — two junction tables, two endpoints, one set of
   service helpers, and ~50 frontend lines deleted in net.
4. **Easier UX** — the "TeamFormModal shows Keine Zuordnung despite Halle in
   Department" bug class is impossible: there is no team-side hall picker.
5. **Test surface shrank** — 14 mocked test cases covering the old
   M:N assign/get methods replaced by 6 simpler cases (single
   set/get; Department service tests for the trigger error path).

### Negative

1. **No cross-area department halls** — a Department that physically
   operates in two halls of two different areas can no longer model that
   directly. Workaround: make those halls members of one Area (or split
   the Department).
2. **Down-migration is lossy** — rolling back the migration recreates
   junction tables but only restores the single hall per department. Any
   theoretical multi-hall data is gone. Mitigated by the FAIL LOUD
   pre-check that blocks `up()` if multi-hall data exists.
3. **Frontend deprecated stubs** — `assignTeamHall()` left as a no-op for
   migration-period imports. Not ideal but cheap to clean up later.

### Risks & Mitigations

| Risk                                                    | Mitigation                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Trigger error message leaks SQL detail to API consumers | `setDepartmentHall()` catches the P0001 and re-throws as `BadRequestException` with friendly text.      |
| Hall area change breaks references silently             | `trg_prevent_hall_area_change_with_depts` blocks the UPDATE; UI must clear refs first.                  |
| Future need for multi-hall Department resurfaces        | Reintroduce a junction table behind a feature flag — `departments.hall_id` becomes "primary hall".      |
| Customer fresh-install ships an outdated schema         | Run `./scripts/sync-customer-migrations.sh` after merge (see ADR-014 §"Update Customer Fresh-Install"). |

---

## Verification

| Check                                                     | Result                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `node-pg-migrate up --dry-run`                            | Dry-run clean, FAIL LOUD pre-check passes (0 junction rows).            |
| `node-pg-migrate up`                                      | Applied, `pgmigrations` row recorded.                                   |
| Backend unit tests (`pnpm vitest run --project unit ...`) | 456/456 pass.                                                           |
| Backend type-check (`tsc --noEmit -p backend`)            | exit 0.                                                                 |
| Frontend type-check + svelte-check                        | 0 errors, 0 warnings, 2598 files.                                       |
| Backend lint                                              | 0 errors.                                                               |
| Manual smoke test (manage-areas → assign hall → save)     | 200 OK after `$2` orphan-param fix.                                     |
| Manual smoke test (manage-departments → set hall → save)  | 200 OK, area-match invariant respected.                                 |
| Manual smoke test (manage-teams → open team modal)        | Hall badge shows "Halle 1 — Quelle: <Dept>" inherited from parent dept. |

---

## Files

### Migration

- `database/migrations/20260505221345432_simplify-department-hall-1to1.ts`

### Backend

- `backend/src/nest/departments/departments.service.ts` (queries, mapToResponse, setDepartmentHall, getDepartmentHallId)
- `backend/src/nest/departments/departments.controller.ts` (PUT /departments/:id/hall)
- `backend/src/nest/departments/dto/assign-halls.dto.ts` (renamed schema/class to `SetDepartmentHallSchema/Dto`)
- `backend/src/nest/departments/dto/update-department.dto.ts` (added `hallId`)
- `backend/src/nest/teams/teams.service.ts` (query joins via `department.hall_id`, `getTeamHallId`)
- `backend/src/nest/teams/teams.controller.ts` (removed POST /teams/:id/halls)
- `backend/src/nest/teams/dto/assign-halls.dto.ts` (deprecation stub)
- `backend/src/nest/halls/halls.service.ts` (`dept_assignments` CTE reads `departments.hall_id`)
- `backend/src/nest/areas/areas.service.ts` (`assignHallsToArea` pre-clears `departments.hall_id` for trigger guard)
- `backend/src/nest/organigram/organigram.service.ts` (fetchDepartmentHalls/fetchTeamHalls join via `departments.hall_id`)

### Frontend

- `frontend/src/routes/(app)/(shared)/manage-teams/_lib/TeamFormModal.svelte` (read-only hall info, no dropdown)
- `frontend/src/routes/(app)/(shared)/manage-teams/_lib/types.ts` (Department.hallId/hallName, TeamFormData no hallId)
- `frontend/src/routes/(app)/(shared)/manage-teams/+page.svelte` (single hall badge per team)
- `frontend/src/routes/(app)/(shared)/manage-teams/+page.server.ts` (no /halls fetch)
- `frontend/src/routes/(app)/(shared)/manage-teams/_lib/api.ts` (assignTeamHall → no-op deprecation stub)
- `frontend/src/routes/(app)/(shared)/manage-departments/_lib/DepartmentModal.svelte` (single hall <select>, area-match auto-clear)
- `frontend/src/routes/(app)/(shared)/manage-departments/_lib/api.ts` (`setDepartmentHall(id, hallId)` via PUT)
- `frontend/src/routes/(app)/(shared)/manage-departments/_lib/constants.ts` (`API_ENDPOINTS.departmentHall`, FORM_DEFAULTS.hallId)
- `frontend/src/routes/(app)/(shared)/manage-departments/_lib/types.ts` (`hall: DepartmentHallEntry | null`)
- `frontend/src/routes/(app)/(shared)/manage-departments/_lib/utils.ts` (getHallDisplayText/getHallTooltip take single hall)
- `frontend/src/routes/(app)/(shared)/manage-departments/+page.svelte` (single hall badge, formHallId state)

---

## References

- [Migration file](../../../database/migrations/20260505221345432_simplify-department-hall-1to1.ts)
- [ADR-014: Migration Architecture](./ADR-014-database-migration-architecture.md) — FAIL LOUD pre-checks, lossy down() rules.
- [ADR-019: Multi-Tenant RLS](./ADR-019-multi-tenant-rls-isolation.md) — Triple-User-Model GRANTs in `down()`.
- [ADR-034: Hierarchy Labels](./ADR-034-hierarchy-labels-propagation.md) — defines hall as a separate level above area in the label model; 1:1 hierarchy is consistent with that view.
- [DATABASE-MIGRATION-GUIDE.md](../../DATABASE-MIGRATION-GUIDE.md) — backup-first protocol, generator-only rule, dry-run mandate.
