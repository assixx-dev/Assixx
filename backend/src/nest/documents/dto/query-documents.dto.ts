/**
 * DTOs for Documents Query Parameters
 *
 * Phase 1.2a (2026-05-01): extends canonical PaginationSchema (ADR-030 §4 + audit D1).
 * limit default 20 (preserved); search tightened from .max(200) to .trim().max(100)
 * per D3 convention. Schema renamed to PascalCase + exported for consistency
 * with other module schemas.
 *
 * Phase 4.9a (2026-05-06): added `sort` field — server-side ORDER BY dispatch
 * replaces the pre-migration FE-only client-side sort (`_lib/filters.ts:78`).
 * Bundled into the §D9 wrapper-key rename per §D18: dropping the UI was rejected
 * per §D11 anti-dishonest-UI rule (3 of 4 sort options would have become silent
 * no-ops once the list paginates server-side); preserving sort across all pages
 * is the higher-quality long-term choice for a Beta-launch page.
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §D18
 */
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { PaginationSchema } from '../../../schemas/common.schema.js';

/**
 * Access scope values
 */
const ACCESS_SCOPE_VALUES = [
  'personal',
  'team',
  'department',
  'company',
  'payroll',
  'blackboard',
  'chat',
] as const;

/**
 * Sort options for the documents list.
 * Mirrors the pre-Phase-4.9 FE sort options verbatim (`_lib/filters.ts:78`).
 */
const SORT_VALUES = ['newest', 'oldest', 'name', 'size'] as const;

/**
 * List documents query schema
 */
export const ListDocumentsQuerySchema = PaginationSchema.extend({
  // Override default limit (PaginationSchema = 10) — documents-list-Default war historisch 20.
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  accessScope: z.enum(ACCESS_SCOPE_VALUES).optional(),
  ownerUserId: z.coerce.number().int().positive().optional(),
  targetTeamId: z.coerce.number().int().positive().optional(),
  targetDepartmentId: z.coerce.number().int().positive().optional(),
  salaryYear: z.coerce.number().int().min(2000).max(2100).optional(),
  salaryMonth: z.coerce.number().int().min(1).max(12).optional(),
  blackboardEntryId: z.coerce.number().int().positive().optional(),
  conversationId: z.coerce.number().int().positive().optional(),
  isActive: z.coerce.number().int().min(0).max(4).optional().default(1),
  search: z.string().trim().max(100).optional(),
  /** Sort order — see §D18 (UI preserved server-side, not dropped per §D11). */
  sort: z.enum(SORT_VALUES).default('newest'),
});

export class ListDocumentsQueryDto extends createZodDto(ListDocumentsQuerySchema) {}
