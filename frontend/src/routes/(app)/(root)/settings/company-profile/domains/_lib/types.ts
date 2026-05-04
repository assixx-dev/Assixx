/**
 * Tenant Domain Verification — Frontend Types
 *
 * Mirrors the backend's `TenantDomain` API response shape from
 * `backend/src/nest/domains/domains.types.ts`. Snake_case DB columns are NOT
 * exposed here — backend's ResponseInterceptor converts to camelCase.
 *
 * @see ADR-048 (Tenant Domain Verification — Phase 6 deliverable)
 * @see masterplan §2.2 (backend types) + §5.1 (frontend page)
 */

export type TenantDomainStatus = 'pending' | 'verified' | 'failed' | 'expired';

/**
 * DNS TXT record instructions. Emitted by the backend for any non-verified
 * row on POST /domains AND on every GET response (ADR-049 amendment
 * 2026-05-04 — replaces masterplan §0.2.5 #10 one-shot policy). The frontend
 * therefore reads these directly from `data.domains[i].verificationInstructions`
 * for pending/failed/expired rows; no separate in-memory snapshot needed.
 * Verified rows omit the field — caller must guard with `!== undefined`.
 */
export interface VerificationInstructions {
  txtHost: string;
  txtValue: string;
}

/** API-shape (camelCase) — matches backend's `TenantDomain` interface. */
export interface TenantDomain {
  /** UUIDv7 (string) — backend uses native PG 18.3 `uuidv7()` per §0.2.5 #13. */
  id: string;
  domain: string;
  status: TenantDomainStatus;
  /** ISO date string when the row was flipped to verified, or null while pending. */
  verifiedAt: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present ONLY on the response to `POST /domains` (§0.2.5 #10). */
  verificationInstructions?: VerificationInstructions;
}

/** Response shape of `GET /api/v2/domains/verification-status` (§2.7, Q8). */
export interface VerificationStatusResponse {
  verified: boolean;
}
