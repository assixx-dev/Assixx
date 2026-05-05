<!--
  BetaBanner.svelte

  Slim full-width banner above the LandingHeader on every public page
  (Landing, Impressum, Datenschutz, Disclaimer, Roadmap).

  WHY visible everywhere on the public surface: user explicitly required
  "ganz wichtig" — first-time visitors must see the beta caveat regardless
  of the page they land on (signup vs. landing vs. legal).

  Visual style mirrors SingleRootWarningBanner.svelte: same warning-triangle
  SVG, same `--banner-warning-*` token set, same layout.

  Dismiss = session cookie `assixx_beta_banner_dismissed` (no Max-Age, dies
  on browser close — mirrors a "per-tab session" guarantee at the browser-
  session granularity). Server reads the cookie in /+layout.server.ts and
  exposes `betaBannerDismissed` on `page.data`. We render only when that
  flag is false → SSR HTML never contains the banner after dismiss → no
  flash, no first-paint CLS.

  Why cookie over sessionStorage: sessionStorage is browser-only, so the
  server cannot honor it pre-render. A pre-paint inline-script hack works
  in theory but had race conditions in practice — switched to the cookie
  pattern already proven by SingleRootWarningBanner / UnverifiedDomainBanner
  (commit 2026-04-22). Project-wide legal posture explicitly classifies
  banner-dismissals as TDDDG §25 strictly-necessary (see
  src/routes/+layout.svelte lines 32-35).

  Linked from /disclaimer — see FEAT_BETA_HOSTING_MASTERPLAN §7.1 for the
  related post-login Beta-T&C modal (separate, acceptance-tracked UX flow).
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  // Cookie name — MUST stay in sync with BETA_BANNER_DISMISS_COOKIE in
  // src/routes/+layout.server.ts. Session cookie semantics (no Max-Age).
  const DISMISS_COOKIE = 'assixx_beta_banner_dismissed';

  // Local hide handles the in-session click without requiring a reload —
  // SSR/server-side dismissed state comes from page.data.betaBannerDismissed,
  // which is already true if the user previously dismissed (via cookie).
  let locallyDismissed = $state(false);

  // Banner is hidden if EITHER the server told us it's dismissed
  // (page.data.betaBannerDismissed from cookie) OR the user just clicked X
  // in this session. $derived so navigation between public pages
  // re-evaluates page.data correctly.
  const dismissed = $derived(locallyDismissed || page.data.betaBannerDismissed === true);

  function close(): void {
    if (browser) {
      // SameSite=Lax: harmless for a cosmetic-state cookie; Path=/ so
      // every public route honors it; no Secure so http://*.localhost
      // works during dev (browser ignores Secure on localhost anyway).
      document.cookie = `${DISMISS_COOKIE}=1; Path=/; SameSite=Lax`;
    }
    locallyDismissed = true;
  }
</script>

{#if !dismissed}
  <div
    class="beta-banner"
    id="beta-banner"
    role="alert"
  >
    <div class="beta-banner-content">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        class="banner-icon"
        aria-hidden="true"
      >
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
      </svg>
      <span>
        <strong>Beta-Phase:</strong>
        Assixx startet am 01.06.2026 in die offene Beta. Datenverlust ist in seltenen Fällen möglich.
        <a
          href={resolve('/disclaimer')}
          class="beta-banner-link">Disclaimer lesen</a
        >
      </span>
      <button
        type="button"
        class="beta-banner-close"
        title="Banner schließen"
        aria-label="Banner schließen"
        onclick={close}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
          />
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  /* CSS-Variablen + Layout 1:1 vom SingleRootWarningBanner übernommen,
     damit beide Banner visuell identisch wirken (--banner-warning-*).
     Klassen sind via Svelte component-scoped — keine Kollision. */
  .beta-banner {
    z-index: var(--z-notification);
    background: var(--banner-warning-bg);
    border-bottom: 1px solid var(--banner-warning-border);
    padding: var(--spacing-5) var(--spacing-6);
    width: 100%;
  }

  .beta-banner-content {
    display: flex;
    position: relative;
    justify-content: center;
    align-items: center;
    gap: var(--spacing-2);
    color: var(--banner-warning-text);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-none);
  }

  .beta-banner-content strong {
    color: var(--banner-warning-text-strong);
    font-weight: var(--font-weight-semibold);
  }

  .beta-banner-link {
    margin-left: var(--spacing-2);
    color: var(--banner-warning-text-strong);
    font-weight: var(--font-weight-semibold);
    text-decoration: underline;
  }

  .banner-icon {
    flex-shrink: 0;
    color: var(--banner-warning-icon);
  }

  /* Dismiss button: absolute-positioned right edge to keep the
     headline horizontally centered (mirrors RoleSwitchBanner pattern). */
  .beta-banner-close {
    display: inline-flex;
    position: absolute;
    right: 0;
    align-items: center;
    justify-content: center;
    background: transparent;
    cursor: pointer;
    border: none;
    border-radius: var(--radius-sm);
    padding: var(--spacing-1);
    color: var(--banner-warning-text);
    line-height: var(--line-height-none);
    transition: background-color 0.15s ease;
  }

  .beta-banner-close:hover,
  .beta-banner-close:focus-visible {
    background: var(--banner-warning-border);
    outline: none;
  }
</style>
