/**
 * Subdomain handoff URL builder (ADR-050 §"OAuth: Centralized Callback,
 * Post-Callback Handoff").
 *
 * Used by every server-side action that needs to redirect a freshly-
 * authenticated user from the apex (or a wrong subdomain) to the user's
 * correct tenant subdomain. Concrete consumers:
 *
 *   - `(public)/login/+page.server.ts::buildHandoffRedirect` — OAuth-bypass
 *     login (no 2FA) where the backend returns tokens in the body.
 *   - `(public)/login/_lib/2fa-server-helpers.ts::handleVerifyAction` —
 *     password+2FA login where the verify endpoint returns a handoff token
 *     after ADR-054 made 2FA mandatory (see ADR-050 §"OAuth" and the
 *     2026-05-01 controller change in `two-factor-auth.controller.ts`).
 *
 * Pre-2026-05-01 the helper lived inline in `+page.server.ts` and was
 * unreachable from the 2FA verify path. Lifting it out fixes the
 * cross-origin handoff for password logins under ADR-054 and removes the
 * looming code-duplication that a verify-side copy would have introduced.
 *
 * Pure utility: no SvelteKit context, no I/O, no async. Server-side only
 * because the action sites import it from `+page.server.ts` files which
 * SvelteKit refuses to ship to the browser anyway — `$lib/server/` adds the
 * compiler-enforced "never reaches the client" guarantee on top.
 *
 * @see docs/infrastructure/adr/ADR-050-tenant-subdomain-routing.md §OAuth
 * @see docs/infrastructure/adr/ADR-054-mandatory-email-2fa.md §"Three Covered Scenarios"
 */

/**
 * Pure host-swap: derive the absolute origin of the user's tenant subdomain
 * from the current request URL.
 *
 * Rules:
 *   - `localhost`                     → `{slug}.localhost` (dev)
 *   - `assixx.com` / `www.assixx.com` → `{slug}.assixx.com` (prod apex)
 *   - subdomain already               → swap first label (cross-subdomain redirect)
 *
 * Preserves protocol + port from the current request URL, so dev on `:5173`
 * stays on `:5173` and prod stays on 443.
 *
 * Internal helper — shared between {@link buildSubdomainHandoffUrl} (handoff
 * token branch) and {@link buildSubdomainRootUrl} (apex remember-last-tenant
 * branch, ADR-050 followup 2026-05-05). DRY: both consumers need the exact
 * same host-swap; diverging copies would silently break dev/prod parity.
 */
function deriveSubdomainOrigin(slug: string, request: Request): string {
  const url = new URL(request.url);
  const hostname = url.hostname;

  let newHost: string;
  if (hostname === 'localhost' || hostname === 'assixx.com') {
    newHost = `${slug}.${hostname}`;
  } else if (hostname === 'www.assixx.com') {
    newHost = `${slug}.assixx.com`;
  } else {
    // Subdomain context (incl. `foo.localhost`) — replace first label.
    const parts = hostname.split('.');
    parts[0] = slug;
    newHost = parts.join('.');
  }

  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${newHost}${port}`;
}

/**
 * Build the subdomain-scoped handoff URL the browser should navigate to
 * after apex-login mint (Session 12c).
 *
 * @param slug    Target tenant subdomain (e.g. `'assixx'`, `'firma-a'`).
 * @param token   Opaque 64-hex handoff token from `OAuthHandoffService.mint`.
 * @param request The incoming SvelteKit `Request` — only `request.url` is read.
 */
export function buildSubdomainHandoffUrl(slug: string, token: string, request: Request): string {
  return `${deriveSubdomainOrigin(slug, request)}/signup/oauth-complete?token=${encodeURIComponent(token)}`;
}

/**
 * Build the subdomain `/login` URL `<protocol>//<slug>.<apex>:<port>/login`
 * for the "remember-last-tenant" UX redirect on apex login (ADR-050 followup
 * 2026-05-05).
 *
 * Different from {@link buildSubdomainHandoffUrl}: this URL carries NO auth
 * material — it relies on the user's existing subdomain-scoped session cookies
 * (set by an earlier successful login on this browser) to satisfy the
 * subdomain `/login` load function's auth probe. The probe (`/users/me` with
 * the subdomain-scoped accessToken) decides:
 *
 *   - **valid session** → load throws `redirect(302, getRedirectPath(role))`
 *     so the user lands on the role-specific dashboard (one extra server-side
 *     hop, but role-aware which the apex side cannot be without holding auth).
 *   - **invalid / expired session** → load clears stale cookies and renders
 *     the credentials form on the subdomain. From the user's perspective
 *     they are still on a subdomain `/login`, which is the same endpoint
 *     they would have reached via apex anyway.
 *
 * Why `/login` and not `/` (subdomain root):
 *
 *   - `/` resolves to the public landing/marketing page, NOT a role-aware
 *     dispatcher — it has no auth probe and therefore would not redirect
 *     a logged-in user anywhere.
 *   - `/login` already has the auth probe + role-based dashboard redirect
 *     (`+page.server.ts::load` reads `accessToken` and calls `/users/me`).
 *     Reusing it keeps the dispatch logic in ONE place instead of duplicating
 *     it onto the root route.
 *
 * If the subdomain session is gone AND the form is then submitted, the apex
 * hint cookie keeps pointing at the same tenant — the user is back where
 * they wanted to be after re-auth. No loop, no stale-tenant trap.
 *
 * @param slug    Target tenant subdomain. Caller MUST validate against the
 *                slug regex BEFORE passing — this function performs no
 *                validation and would happily build a malformed URL.
 * @param request The incoming SvelteKit `Request` — only `request.url` is read.
 */
export function buildSubdomainLoginUrl(slug: string, request: Request): string {
  return `${deriveSubdomainOrigin(slug, request)}/login`;
}
