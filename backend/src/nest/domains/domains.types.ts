/**
 * Domain types for the tenant-domain-verification module.
 *
 * Two shapes live side-by-side:
 *   - `TenantDomainRow` — raw DB row (snake_case columns, `Date` for timestamps,
 *     matches the `tenant_domains` table created in migration
 *     `20260417223358319_create-tenant-domains.ts`).
 *   - `TenantDomain` — outward-facing API response (camelCase, ISO strings).
 *
 * `TenantDomain.verificationInstructions` is emitted for any non-verified row
 * (status: 'pending' | 'failed' | 'expired') on every API response — POST,
 * GET-list, GET-one, PATCH-verify. Verified rows omit the field. Source: the
 * persistent `tenant_domains.verification_token` column (never rotated). RBAC
 * is the only access gate — controller-level @Roles('root') + RLS via
 * tenantTransaction (ADR-019) restrict the response to the owning tenant.
 *
 * Replaces the original "one-shot at add-time" policy (masterplan §0.2.5 #10,
 * 2026-04-19): one-shot left users without a recovery path after panel
 * dismiss / page reload / SPA navigation, forcing a delete+re-add cycle to
 * see the TXT again. ADR-049 (2026-05-04 amendment) makes the token
 * persistently retrievable for any row that still needs it.
 *
 * @see docs/FEAT_TENANT_DOMAIN_VERIFICATION_MASTERPLAN.md §2.2
 * @see docs/infrastructure/adr/ADR-049-tenant-domain-verification.md
 */

export type TenantDomainStatus = 'pending' | 'verified' | 'failed' | 'expired';

export interface TenantDomainRow {
  id: string; // uuidv7
  tenant_id: number;
  domain: string;
  status: TenantDomainStatus;
  verification_token: string;
  verified_at: Date | null;
  is_primary: boolean;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

export interface TenantDomain {
  id: string;
  tenantId: number;
  domain: string;
  status: TenantDomainStatus;
  isPrimary: boolean;
  verifiedAt: string | null; // ISO
  createdAt: string;
  updatedAt: string;
  /** only surfaced to root during "add" response to show TXT instructions */
  verificationInstructions?: {
    txtHost: string; // "_assixx-verify.firma.de"
    txtValue: string; // "assixx-verify=<token>"
  };
}
