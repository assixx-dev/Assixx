/**
 * Migration: Simplify Department/Team Hall Hierarchy to 1:1
 *
 * Purpose:
 *   Replace the M:N additive Hall-assignment model (department_halls + team_halls
 *   junction tables, ADR-034) with a strict 1:1 hierarchy:
 *     - departments.hall_id (NULLable, FK halls(id) ON DELETE SET NULL)
 *     - Teams inherit Hall transitively via team.department.hall_id (no team_halls)
 *
 *   Rationale: the M:N model allowed inconsistent states where a Team could be
 *   assigned a Hall outside its parent Department's Area. The TeamFormModal
 *   filter ignored area-implicit inheritance, leading to "Keine Zuordnung"
 *   despite valid Department→Area→Hall chain.
 *
 * Constraint: halls.area_id == departments.area_id (enforced via DB triggers).
 *
 * WARNING: One-way migration in spirit. down() recreates the empty junction
 * tables and back-fills department_halls from departments.hall_id, but ANY
 * data added via the new column (departments.hall_id) is collapsed into a
 * single junction row per department on rollback — Multi-Hall data that was
 * intentionally lost in up() cannot be reconstructed.
 *
 * Pre-flight: junction tables MUST be empty at up() time (FAIL LOUD via
 * RAISE EXCEPTION). Verified 2026-05-06: 0 rows in both junctions.
 *
 * Related: ADR-034 (hierarchy labels), ADR-014 (migration architecture),
 *          ADR-019 (RLS isolation), FEAT_ORGANIGRAM_MASTERPLAN.md
 */
import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    -- ============================================================
    -- 1. FAIL LOUD pre-check: junction tables must be empty
    -- ------------------------------------------------------------
    -- The new model collapses M:N → 1:1. If any junction rows exist,
    -- migration would silently lose them. Per ADR-014 quality
    -- standards: RAISE EXCEPTION instead of silent UPDATE/DELETE.
    -- ============================================================
    DO $$
    DECLARE
      dh_count INT;
      th_count INT;
      multi_count INT;
    BEGIN
      SELECT COUNT(*) INTO dh_count FROM department_halls;
      SELECT COUNT(*) INTO th_count FROM team_halls;
      SELECT COUNT(*) INTO multi_count FROM (
        SELECT department_id FROM department_halls
        GROUP BY department_id HAVING COUNT(*) > 1
      ) t;

      IF multi_count > 0 THEN
        RAISE EXCEPTION
          'Cannot migrate: % departments have multiple halls in department_halls. '
          'Manual cleanup required before this migration can run.', multi_count;
      END IF;

      IF th_count > 0 THEN
        RAISE EXCEPTION
          'Cannot migrate: team_halls has % rows. Teams now inherit hall '
          'from their department. Clear team_halls before running this migration.', th_count;
      END IF;

      IF dh_count > 0 THEN
        RAISE NOTICE 'Backfilling departments.hall_id from % department_halls rows', dh_count;
      END IF;
    END $$;

    -- ============================================================
    -- 2. ADD departments.hall_id (NULLable, FK halls(id))
    -- ------------------------------------------------------------
    -- ON DELETE SET NULL: when a Hall is deleted, the department
    -- loses its hall reference but is not itself deleted.
    -- ============================================================
    ALTER TABLE departments
      ADD COLUMN hall_id INTEGER NULL
        REFERENCES halls(id) ON DELETE SET NULL;

    CREATE INDEX idx_departments_hall ON departments(hall_id);

    -- ============================================================
    -- 3. Backfill hall_id from department_halls (no-op if empty)
    -- ------------------------------------------------------------
    -- Pre-check above guarantees ≤1 row per department, so LIMIT 1
    -- in subquery is safe. Empty tables → backfill is no-op.
    -- ============================================================
    UPDATE departments d
    SET hall_id = (
      SELECT dh.hall_id FROM department_halls dh
      WHERE dh.department_id = d.id LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM department_halls dh WHERE dh.department_id = d.id
    );

    -- ============================================================
    -- 4. Trigger: enforce halls.area_id == departments.area_id
    -- ------------------------------------------------------------
    -- BEFORE INSERT/UPDATE on departments: if hall_id is set, it
    -- must reference a Hall in the same Area as the Department.
    -- Otherwise the strict 1:1 hierarchy is violated.
    -- ============================================================
    CREATE OR REPLACE FUNCTION enforce_dept_hall_area_match()
    RETURNS TRIGGER AS $$
    DECLARE
      hall_area INT;
    BEGIN
      IF NEW.hall_id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT area_id INTO hall_area FROM halls
      WHERE id = NEW.hall_id AND tenant_id = NEW.tenant_id;

      IF hall_area IS NULL THEN
        RAISE EXCEPTION
          'Hall % not found in tenant % (or hall has no area_id).',
          NEW.hall_id, NEW.tenant_id;
      END IF;

      IF NEW.area_id IS NULL THEN
        RAISE EXCEPTION
          'Cannot assign hall to department without area_id. '
          'Set department.area_id first, then hall_id.';
      END IF;

      IF hall_area != NEW.area_id THEN
        RAISE EXCEPTION
          'Hall % belongs to area %, but department is in area %. '
          'Halls must match the department area (1:1 hierarchy, ADR-034).',
          NEW.hall_id, hall_area, NEW.area_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_enforce_dept_hall_area_match
    BEFORE INSERT OR UPDATE OF hall_id, area_id ON departments
    FOR EACH ROW EXECUTE FUNCTION enforce_dept_hall_area_match();

    -- ============================================================
    -- 5. Trigger: prevent halls.area_id change while depts reference
    -- ------------------------------------------------------------
    -- BEFORE UPDATE OF area_id ON halls: if any department points
    -- to this hall, block the area change. UI must NULL the
    -- departments.hall_id first or update them in same transaction.
    -- ============================================================
    CREATE OR REPLACE FUNCTION prevent_hall_area_change_with_depts()
    RETURNS TRIGGER AS $$
    DECLARE
      dep_count INT;
    BEGIN
      IF NEW.area_id IS NOT DISTINCT FROM OLD.area_id THEN
        RETURN NEW;
      END IF;

      SELECT COUNT(*) INTO dep_count FROM departments
      WHERE hall_id = NEW.id AND tenant_id = NEW.tenant_id;

      IF dep_count > 0 THEN
        RAISE EXCEPTION
          'Cannot change area of hall % while % department(s) reference it. '
          'Reassign or clear departments.hall_id first.',
          NEW.id, dep_count;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_prevent_hall_area_change_with_depts
    BEFORE UPDATE OF area_id ON halls
    FOR EACH ROW EXECUTE FUNCTION prevent_hall_area_change_with_depts();

    -- ============================================================
    -- 6. DROP junction tables (no longer needed)
    -- ------------------------------------------------------------
    -- CASCADE drops: indexes, constraints, RLS policies, GRANTs.
    -- Pre-check guaranteed both tables are empty.
    -- ============================================================
    DROP TABLE department_halls CASCADE;
    DROP TABLE team_halls CASCADE;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    -- ============================================================
    -- 1. Drop new triggers + function (must come first to allow
    --    schema rollback without trigger interference)
    -- ============================================================
    DROP TRIGGER IF EXISTS trg_enforce_dept_hall_area_match ON departments;
    DROP TRIGGER IF EXISTS trg_prevent_hall_area_change_with_depts ON halls;
    DROP FUNCTION IF EXISTS enforce_dept_hall_area_match();
    DROP FUNCTION IF EXISTS prevent_hall_area_change_with_depts();

    -- ============================================================
    -- 2. Recreate department_halls (mirror of original schema)
    -- ============================================================
    CREATE TABLE department_halls (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT department_halls_tenant_id_department_id_hall_id_key
        UNIQUE (tenant_id, department_id, hall_id)
    );
    CREATE INDEX idx_department_halls_tenant ON department_halls(tenant_id);
    CREATE INDEX idx_department_halls_department ON department_halls(department_id);
    CREATE INDEX idx_department_halls_hall ON department_halls(hall_id);

    ALTER TABLE department_halls ENABLE ROW LEVEL SECURITY;
    ALTER TABLE department_halls FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON department_halls
      FOR ALL USING (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::integer
      );

    GRANT SELECT, INSERT, UPDATE, DELETE ON department_halls TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON department_halls TO sys_user;
    GRANT USAGE, SELECT ON SEQUENCE department_halls_id_seq TO app_user;
    GRANT USAGE, SELECT ON SEQUENCE department_halls_id_seq TO sys_user;

    -- ============================================================
    -- 3. Recreate team_halls (mirror of original schema)
    -- ============================================================
    CREATE TABLE team_halls (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT team_halls_tenant_id_team_id_hall_id_key
        UNIQUE (tenant_id, team_id, hall_id)
    );
    CREATE INDEX idx_team_halls_tenant ON team_halls(tenant_id);
    CREATE INDEX idx_team_halls_team ON team_halls(team_id);
    CREATE INDEX idx_team_halls_hall ON team_halls(hall_id);

    ALTER TABLE team_halls ENABLE ROW LEVEL SECURITY;
    ALTER TABLE team_halls FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON team_halls
      FOR ALL USING (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::integer
      );

    GRANT SELECT, INSERT, UPDATE, DELETE ON team_halls TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON team_halls TO sys_user;
    GRANT USAGE, SELECT ON SEQUENCE team_halls_id_seq TO app_user;
    GRANT USAGE, SELECT ON SEQUENCE team_halls_id_seq TO sys_user;

    -- ============================================================
    -- 4. Backfill department_halls from departments.hall_id
    -- ------------------------------------------------------------
    -- WARNING (lossy): only the single hall stored in hall_id is
    -- restored. Multi-hall scenarios that were collapsed to 1:1 in
    -- up() cannot be reconstructed (data was already collapsed).
    -- ============================================================
    INSERT INTO department_halls (tenant_id, department_id, hall_id, assigned_by, assigned_at)
    SELECT d.tenant_id, d.id, d.hall_id, NULL, NOW()
    FROM departments d
    WHERE d.hall_id IS NOT NULL;

    -- ============================================================
    -- 5. Drop departments.hall_id column
    -- ============================================================
    DROP INDEX IF EXISTS idx_departments_hall;
    ALTER TABLE departments DROP COLUMN hall_id;
  `);
}
