/**
 * Set Department Hall DTO
 *
 * Validation schema for assigning a single Hall to a Department (1:1 model).
 *
 * Background: M:N junction `department_halls` was dropped in migration
 * 20260505221345432_simplify-department-hall-1to1 in favour of a single
 * `departments.hall_id` column. The Hall must belong to the same Area as
 * the Department (DB trigger `trg_enforce_dept_hall_area_match` enforces).
 *
 * @see ADR-034 Hierarchy Labels
 */
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SetDepartmentHallSchema = z.object({
  hallId: z.coerce.number().int().positive('Hall ID must be a positive integer').nullable(),
});

export class SetDepartmentHallDto extends createZodDto(SetDepartmentHallSchema) {}
