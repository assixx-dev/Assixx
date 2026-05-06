<!--
  CookieBanner.svelte
  ───────────────────
  DSGVO/TDDDG-conformant cookie consent UI.

  Activation:
    Rendered only when `PUBLIC_COOKIE_BANNER_ENABLED='true'` (see
    `$lib/utils/cookie-consent.svelte`). Default OFF.

  Layout:
    Bottom-fixed glass card (non-blocking — user can still reach the privacy
    policy in the footer). On "Anpassen" the same card expands in-place to
    show three category toggles. No backdrop overlay by design — DSGVO is
    satisfied as long as no non-essential storage happens before consent
    (enforced in the consumers, not the banner).

  Design-system bindings (1:1 dark/light parity):
    - colours/shadows/radii/fonts via DS tokens (--main-bg,
      --color-glass-border, --shadow-glass, --radius-xl, --color-primary,
      --color-text-primary/secondary, --font-primary, --spacing-*).
    - Buttons: `.btn .btn-primary` / `.btn .btn-cancel` / `.btn` from
      design-system/primitives/buttons.
    - Toggles: `.toggle-switch.toggle-switch--sm.toggle-switch--no-label`
      from design-system/primitives/toggles.
    - Reduced-motion respected (transition disabled).
    - Mobile: actions stack column-reverse (primary CTA on top).

  Accessibility:
    - role="dialog", aria-modal="false" (non-blocking by design).
    - aria-labelledby + aria-describedby on the dialog root.
    - aria-label on each toggle input (no visible label text).
    - Esc key not bound: a decision is required, no implicit close.

  @see frontend/src/lib/utils/cookie-consent.svelte.ts
  @see docs/infrastructure/adr/ADR-005-authentication-strategy.md
-->
<script lang="ts">
  import { onMount } from 'svelte';

  import { resolve } from '$app/paths';

  import { cookieConsent } from '$lib/utils/cookie-consent.svelte';

  // Animation is CSS-only (see the style block below). Svelte's transition
  // directives would force `import { fly } from 'svelte/transition'` + easing,
  // which the pnpm-flat type-resolver in this repo flags as a no-duplicates
  // conflict with the base `svelte` import. CSS keyframes also have zero JS
  // runtime cost.

  let mode = $state<'compact' | 'settings'>('compact');
  let prefFunctional = $state(false);
  let prefAnalytics = $state(false);

  onMount(() => {
    cookieConsent.init();
  });

  function showSettings(): void {
    // Pre-fill toggles with the previous decision (for re-open via footer).
    prefFunctional = cookieConsent.consent?.functional ?? false;
    prefAnalytics = cookieConsent.consent?.analytics ?? false;
    mode = 'settings';
  }

  function backToCompact(): void {
    mode = 'compact';
  }

  function saveSelection(): void {
    cookieConsent.save({ functional: prefFunctional, analytics: prefAnalytics });
    mode = 'compact';
  }

  function acceptAll(): void {
    cookieConsent.acceptAll();
    mode = 'compact';
  }

  function rejectAll(): void {
    cookieConsent.rejectAll();
    mode = 'compact';
  }
</script>

{#if cookieConsent.isOpen}
  <div
    class="cookie-banner"
    class:cookie-banner--settings={mode === 'settings'}
    role="dialog"
    aria-modal="false"
    aria-labelledby="cookie-banner-title"
    aria-describedby="cookie-banner-desc"
  >
    <div class="cookie-banner__inner">
      <header class="cookie-banner__header">
        <h2
          id="cookie-banner-title"
          class="cookie-banner__title"
        >
          Datenschutz-Einstellungen
        </h2>
        <p
          id="cookie-banner-desc"
          class="cookie-banner__lead"
        >
          Assixx nutzt technisch notwendige Speicherung für Login, Session, Sicherheit und
          E2E-Verschlüsselung. Optionale Kategorien helfen uns, Assixx zu verbessern — du kannst sie
          jederzeit ändern.
          <a
            class="cookie-banner__link"
            href={resolve('/datenschutz')}
          >
            Datenschutzerklärung
          </a>
        </p>
      </header>

      {#if mode === 'settings'}
        <ul class="cookie-banner__categories">
          <li class="cookie-banner__cat">
            <div class="cookie-banner__cat-row">
              <div class="cookie-banner__cat-title">
                <strong>Technisch notwendig</strong>
                <span class="cookie-banner__badge">erforderlich</span>
              </div>
              <label
                class="toggle-switch toggle-switch--sm toggle-switch--success toggle-switch--no-label"
              >
                <input
                  type="checkbox"
                  class="toggle-switch__input"
                  checked
                  disabled
                  aria-label="Technisch notwendig — immer aktiv"
                />
                <span class="toggle-switch__slider"></span>
              </label>
            </div>
            <p class="cookie-banner__cat-desc">
              Auth-Tokens, 2FA-Challenge, Tenant-Subdomain-Hint, E2E-Schlüssel (IndexedDB). Ohne
              diese funktioniert Assixx nicht.
            </p>
          </li>

          <li class="cookie-banner__cat">
            <div class="cookie-banner__cat-row">
              <strong class="cookie-banner__cat-title">Funktional</strong>
              <label class="toggle-switch toggle-switch--sm toggle-switch--no-label">
                <input
                  type="checkbox"
                  class="toggle-switch__input"
                  bind:checked={prefFunctional}
                  aria-label="Funktional — UI-Einstellungen aktivieren"
                />
                <span class="toggle-switch__slider"></span>
              </label>
            </div>
            <p class="cookie-banner__cat-desc">
              Theme (Dark/Light), Sidebar-Zustand, Kalender-Filter, Banner-Dismissals. Komfort, kein
              Tracking.
            </p>
          </li>

          <li class="cookie-banner__cat">
            <div class="cookie-banner__cat-row">
              <strong class="cookie-banner__cat-title">Analyse &amp; Fehlerdiagnose</strong>
              <label class="toggle-switch toggle-switch--sm toggle-switch--no-label">
                <input
                  type="checkbox"
                  class="toggle-switch__input"
                  bind:checked={prefAnalytics}
                  aria-label="Analyse — Sentry-Fehlerdiagnose aktivieren"
                />
                <span class="toggle-switch__slider"></span>
              </label>
            </div>
            <p class="cookie-banner__cat-desc">
              Anonymisierte Fehler- und Performance-Daten via Sentry (EU-Region, AVV vorhanden).
              Kein Session-Replay, keine PII.
            </p>
          </li>
        </ul>
      {/if}

      <div class="cookie-banner__actions">
        <button
          type="button"
          class="btn btn-cancel"
          onclick={rejectAll}
        >
          Alle ablehnen
        </button>
        {#if mode === 'compact'}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={showSettings}
          >
            Anpassen
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onclick={acceptAll}
          >
            Alle akzeptieren
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={backToCompact}
          >
            Zurück
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onclick={saveSelection}
          >
            Auswahl speichern
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /*
   * Bottom-fixed glass card (non-blocking).
   * z-index 9000: above app content, below blackboard fullscreen (9999).
   * `inset` shorthand pins the card to the bottom with side margins.
   * Dark/light parity comes from --main-bg + --color-text-primary swapping
   * in variables-light.css / variables-dark.css; we never hardcode colours.
   */
  .cookie-banner {
    /* Pinned to bottom-right per design review. Mobile (<=640px) overrides
       this to full-width bottom — see @media block at the end of the file. */
    position: fixed;
    inset: auto var(--spacing-4) var(--spacing-4) auto;
    z-index: 9000;

    max-width: 720px;

    /* Border + glow colours are theme-scoped — see :global(html.dark) override
       below. Light mode: deep brand blue frames the glass against bright app
       chrome. Dark mode: near-white stroke for contrast against the dark glass.
       Glow shadow stacks on top of --shadow-glass to keep depth from the DS. */
    border: 1px solid #0a6fd6;
    border-radius: var(--radius-xl);

    background: color-mix(in oklch, var(--main-bg) 92%, transparent);
    backdrop-filter: blur(20px) saturate(180%);
    box-shadow:
      0 0 0 1px oklch(65% 0.169 248.81 / 18%),
      0 12px 40px -8px oklch(55% 0.17 250 / 35%),
      var(--shadow-glass);

    color: var(--color-text-primary);
    font-family: var(--font-primary);

    /* Slide-up + fade-in on mount. CSS keyframes — no JS runtime, respects
       reduced-motion via the @media block at the bottom of this stylesheet. */
    animation: cookie-banner-in 320ms cubic-bezier(0.33, 1, 0.68, 1) both;
  }

  /* Dark mode: swap the blue stroke for a near-white border so the card
     reads against the dark glass, while keeping the blue glow stack so the
     brand accent is preserved in both themes. */
  :global(html.dark) .cookie-banner {
    border-color: oklch(100% 0 0 / 22%);
  }

  @keyframes cookie-banner-in {
    from {
      transform: translateY(80px);
      opacity: 0%;
    }

    to {
      transform: translateY(0);
      opacity: 100%;
    }
  }

  .cookie-banner--settings {
    /* Slightly wider once the category list is shown. */
    max-width: 760px;
  }

  .cookie-banner__inner {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-4);
    padding: var(--spacing-5);
  }

  .cookie-banner__header {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2);
  }

  .cookie-banner__title {
    margin: 0;

    color: var(--color-text-primary);
    font-weight: 600;
    font-size: 1.125rem;
    line-height: 1.4;
  }

  .cookie-banner__lead {
    margin: 0;

    color: var(--color-text-secondary);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .cookie-banner__link {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .cookie-banner__link:hover {
    color: var(--color-primary-hover);
  }

  /* ============== Category list (settings mode) ============== */
  .cookie-banner__categories {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3);

    margin: 0;
    padding: 0;

    list-style: none;
  }

  .cookie-banner__cat {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2);

    padding: var(--spacing-3);

    border: 1px solid var(--color-glass-border);
    /* Inner radius slightly tighter than outer card — DS convention. */
    border-radius: calc(var(--radius-xl) - 4px);

    background: var(--glass-bg);
  }

  .cookie-banner__cat-row {
    display: flex;
    gap: var(--spacing-3);
    justify-content: space-between;
    align-items: center;
  }

  .cookie-banner__cat-title {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-2);

    color: var(--color-text-primary);
    font-weight: 600;
    font-size: 0.95rem;
  }

  .cookie-banner__badge {
    padding: 0.125rem 0.5rem;

    border-radius: 999px;

    background: color-mix(in oklch, var(--color-success) 22%, transparent);

    color: var(--color-success);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .cookie-banner__cat-desc {
    margin: 0;

    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  /* ============== Actions ============== */
  .cookie-banner__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-2);
    justify-content: flex-end;
  }

  /* Mobile: stack buttons full-width, primary CTA on top (column-reverse). */
  @media (width <= 640px) {
    .cookie-banner {
      inset: auto var(--spacing-2) var(--spacing-2) var(--spacing-2);
    }

    .cookie-banner__inner {
      padding: var(--spacing-4);
    }

    .cookie-banner__actions {
      flex-direction: column-reverse;
    }

    .cookie-banner__actions :global(.btn) {
      width: 100%;
    }
  }

  /* Reduced-motion respect — disables the keyframe slide-up. */
  @media (prefers-reduced-motion: reduce) {
    .cookie-banner {
      animation: none;
    }
  }
</style>
