/**
 * Apex "remember-last-tenant" cookie — UX hint, NOT an auth credential.
 *
 * **What this is.** When a user logs in successfully on the apex
 * (`localhost` / `www.assixx.com`), we plant a small non-secret cookie
 * `lastTenantSlug=<slug>` on the apex origin. The next time the user lands on
 * apex `/login`, the load function reads it and redirects them straight to
 * `<slug>.<apex>/`. The subdomain's (app) layout reuses its own auth cookies
 * (origin-scoped, NOT shared from apex per ADR-050 §"Cookies: Browser-Native
 * Isolation") and shows the dashboard — no second login required.
 *
 * **What this is NOT.** This cookie carries zero auth meaning. It is a
 * routing-hint, equivalent to Slack's "Recent workspaces" widget on
 * `slack.com`. If an attacker forges or steals this cookie, the worst they
 * can do is redirect the victim's apex visit to a different subdomain — and
 * that subdomain's (app) layout still requires a valid JWT cookie which the
 * forger does NOT have. The cookie is therefore deliberately readable to
 * client JS (`httpOnly: false`) — there is no secret to protect, and a
 * future client-side "Recent workspaces" picker (ADR-050 followup) will
 * read it.
 *
 * **Why this is in `$lib/server/`.** Read by the apex login load function
 * (server-side `cookies.get()`); set by the apex login action and 2FA verify
 * action (server-side `cookies.set()`). The architectural test in
 * `shared/src/architectural.test.ts` asserts the cookie name is touched only
 * by this file and the two server files that legitimately consume it.
 *
 * **Cookie attributes — host-scoped on apex by design.**
 * - No `domain:` option → host-only, scoped to the exact origin that set it
 *   (the apex). Subdomains do NOT see this cookie. ADR-050 §R1 forbids any
 *   cookie set with a `domain:` option in this codebase.
 * - `sameSite: 'lax'` → survives top-level navigation from email/IDP links.
 * - `secure` → derived from `url.protocol` (NOT `NODE_ENV`), mirroring the
 *   auth cookie discipline in `auth-cookies.ts`. RFC 6265bis §4.1.2.5
 *   otherwise drops Set-Cookie silently on local-prod-test (HTTP).
 * - `maxAge: 30 days` → matches Slack/Linear "remembered workspace" UX. Far
 *   shorter than a real auth lifetime (which has 30-min access + 7-day
 *   refresh; this cookie is just for routing).
 *
 * **Slug validation.** The cookie value MUST match the same regex shape as
 * `extract-slug.ts` (`[a-z0-9][a-z0-9-]*[a-z0-9]`). Reading invalid slugs
 * returns `null` so a tampered cookie produces a no-op (apex falls back to
 * the login form), not a redirect to a malformed URL.
 *
 * @see docs/infrastructure/adr/ADR-050-tenant-subdomain-routing.md
 *      §"Followup deferred: Remember-last-tenant-slug" (this file IS the followup)
 * @see frontend/src/lib/server/auth-cookies.ts (real auth cookies — different concern)
 * @see frontend/src/lib/utils/extract-slug.ts (slug regex source of truth)
 */
import type { Cookies } from '@sveltejs/kit';

/**
 * Cookie name constant — single source of truth.
 *
 * Architectural test (`shared/src/architectural.test.ts`) asserts this string
 * literal appears only in this file and the apex login server file.
 * Renaming requires touching both the test allowlist and the consumers.
 */
export const LAST_TENANT_COOKIE_NAME = 'lastTenantSlug';

/** 30 days in seconds — matches Slack/Linear "Recent workspaces" lifetime. */
const LAST_TENANT_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Slug shape — kept in sync with `extract-slug.ts::SUBDOMAIN_REGEX` capture
 * group. Cannot directly import that regex (it is anchored on the apex-host
 * suffix, not a bare slug). The two patterns must remain compatible: any
 * slug that `extract-slug.ts` returns MUST validate here. The reverse is
 * NOT required — this regex is more permissive (no host constraint) and
 * that is correct because we only validate the slug substring, not a host.
 *
 * Anchored intentionally: rejects whitespace, control chars, dots, slashes,
 * uppercase, etc. A tampered cookie carrying a path-traversal payload or a
 * bogus hostname fails this check and falls through to the no-redirect path.
 */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/** Detect transport security from the request URL — see `auth-cookies.ts` rationale. */
function isHttpsRequest(url: URL): boolean {
  return url.protocol === 'https:';
}

/**
 * Set the apex remember-last-tenant cookie.
 *
 * **Caller contract.** Only call this from the apex (`locals.hostSlug === null`)
 * — calling it from a tenant subdomain plants a useless cookie on the wrong
 * origin and would never be read on apex visits. The action sites (`login/
 * +page.server.ts`, `2fa-server-helpers.ts`) gate this call accordingly.
 *
 * **Validation.** Silently no-ops if `slug` is null/empty/malformed. We do not
 * throw because an invalid slug is a backend contract drift (greenfield prod
 * always populates `tenants.subdomain` per ADR-050) — surfacing it as a
 * runtime exception during a login flow would be a worse UX than skipping the
 * hint. Backend contract drift surfaces in the auth/handoff path itself, not
 * here.
 */
export function setLastTenantSlug(
  cookies: Cookies,
  url: URL,
  slug: string | null | undefined,
): void {
  if (slug === null || slug === undefined || slug === '') return;
  if (!SLUG_REGEX.test(slug)) return;

  // Host-only by design — no scope-widening attribute. ADR-050 §R1 ban
  // (architectural test in shared/src/architectural.test.ts greps for the
  // forbidden option name inside cookies.set bodies, so this rationale
  // intentionally lives ABOVE the call rather than as an inline comment).
  cookies.set(LAST_TENANT_COOKIE_NAME, slug, {
    path: '/',
    httpOnly: false, // intentional — see file header §"What this is NOT".
    secure: isHttpsRequest(url),
    sameSite: 'lax',
    maxAge: LAST_TENANT_MAX_AGE,
  });
}

/**
 * Read + validate the apex remember-last-tenant cookie.
 *
 * Returns `null` for any of: missing, empty, non-slug-shape. Tamper-resistant:
 * a hand-crafted cookie value like `../foo` or `https://evil.com` fails the
 * regex and is treated as missing — the redirect simply does not happen.
 */
export function getLastTenantSlug(cookies: Cookies): string | null {
  const raw = cookies.get(LAST_TENANT_COOKIE_NAME);
  if (raw === undefined || raw === '') return null;
  return SLUG_REGEX.test(raw) ? raw : null;
}

/**
 * Clear the apex remember-last-tenant cookie.
 *
 * Called from the apex login load when the user has just logged out
 * (`?logout=success`) or got bounced for a tenant mismatch
 * (`?session=forbidden`). Deliberately NOT called on `?session=expired` —
 * an expired session means the user wants to log back in to the same tenant
 * they just used; preserving the hint shortens the next-login round trip.
 */
export function clearLastTenantSlug(cookies: Cookies): void {
  cookies.delete(LAST_TENANT_COOKIE_NAME, { path: '/' });
}

/**
 * Convenience wrapper: set the hint cookie ONLY when the current host is the
 * apex (`hostSlug === null`). On any subdomain origin this is a no-op — the
 * cookie API is scoped to that subdomain and writing the hint there would
 * never be readable on a future apex visit, only confuse a debugger.
 *
 * Both action call sites (apex credentials login + apex 2FA verify handoff)
 * use this so the apex-only invariant lives behind ONE function instead of
 * being repeated as `if (hostSlug === null)` in two places — and so the
 * action bodies stay below the per-function cyclomatic ceiling enforced by
 * frontend ESLint (sonarjs/cognitive-complexity = 10, complexity = 10,
 * Power-of-Ten Rule §10).
 */
export function setLastTenantSlugIfApex(
  cookies: Cookies,
  url: URL,
  hostSlug: string | null,
  slug: string | null | undefined,
): void {
  if (hostSlug !== null) return;
  setLastTenantSlug(cookies, url, slug);
}
