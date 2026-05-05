/**
 * Cookie Consent State Management — DSGVO / TDDDG §25 conformant.
 *
 * Activation:
 *   Set `PUBLIC_COOKIE_BANNER_ENABLED=true` in Doppler (or `.env`) to render
 *   the banner on every route. Default OFF.
 *
 * Why default OFF:
 *   Per the 2026-05-05 storage audit (see ADR-005 + ADR-046), Assixx today
 *   stores only strictly-necessary data in the user's terminal device
 *   (auth cookies, 2FA challenge, E2E IndexedDB keys, theme/UI preferences,
 *   banner-dismissals). Sentry runs in-memory + tunnel, no client storage.
 *   TDDDG §25 Abs. 2 Nr. 2 ("unbedingt erforderlich") therefore exempts us
 *   from a consent banner. Flip the flag the moment a non-essential
 *   consumer (analytics, tracking, ad SDK, session-replay) is added.
 *
 * State pattern: Svelte 5 Runes ($state in `.svelte.ts`) — mirrors
 *   `frontend/src/lib/stores/theme.svelte.ts`.
 *
 * Persistence: localStorage (the consent record itself = strictly necessary
 *   per DSK Orientierungshilfe 2021 §3.4 — "Speicherung der Tatsache, dass
 *   der Nutzer der Verwendung von Cookies widersprochen hat").
 *
 * Versioning: bump CONSENT_VERSION when categories change → re-prompts users
 *   so they can re-decide on the new options.
 *
 * @see docs/infrastructure/adr/ADR-005-authentication-strategy.md
 * @see docs/infrastructure/adr/ADR-046-oauth-sign-in.md
 */
import { browser } from '$app/environment';

import { env } from '$env/dynamic/public';

/** Master switch — only string `'true'` enables the banner. */
export const COOKIE_BANNER_ENABLED = env.PUBLIC_COOKIE_BANNER_ENABLED === 'true';

const STORAGE_KEY = 'assixx_cookie_consent';
const CONSENT_VERSION = 1;

export interface CookieConsent {
  version: number;
  /** ISO-8601 timestamp of the user's most recent decision. */
  decidedAt: string;
  /** Always true — strictly-necessary storage cannot be opted out. */
  essential: true;
  /** UI preferences (theme, sidebar, calendar filters, banner-dismissals). */
  functional: boolean;
  /** Sentry tracing/error sampling + future analytics. */
  analytics: boolean;
}

interface ConsentState {
  consent: CookieConsent | null;
  isOpen: boolean;
  initialized: boolean;
}

/**
 * Type-guard for a stored consent record. A failing check forces re-prompt —
 * unknown shape OR version drift are treated identically (user re-decides).
 * Extracted to keep `loadInitial` below the cyclomatic-complexity cap of 10.
 */
function isValidConsentShape(value: unknown): value is CookieConsent {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<CookieConsent>;
  return (
    c.version === CONSENT_VERSION &&
    typeof c.decidedAt === 'string' &&
    typeof c.functional === 'boolean' &&
    typeof c.analytics === 'boolean'
  );
}

function loadInitial(): CookieConsent | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === '') return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidConsentShape(parsed)) return null;
    return {
      version: CONSENT_VERSION,
      decidedAt: parsed.decidedAt,
      essential: true,
      functional: parsed.functional,
      analytics: parsed.analytics,
    };
  } catch {
    return null;
  }
}

const state = $state<ConsentState>({
  consent: null,
  isOpen: false,
  initialized: false,
});

function persist(c: CookieConsent): void {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

export const cookieConsent = {
  /** Build-time feature flag (read-only). */
  get enabled(): boolean {
    return COOKIE_BANNER_ENABLED;
  },
  get consent(): CookieConsent | null {
    return state.consent;
  },
  get isOpen(): boolean {
    return state.isOpen;
  },
  get hasDecided(): boolean {
    return state.consent !== null;
  },
  /** True only if the user explicitly opted in to analytics. */
  get analytics(): boolean {
    return state.consent?.analytics === true;
  },
  /** True only if the user explicitly opted in to functional storage. */
  get functional(): boolean {
    return state.consent?.functional === true;
  },

  /**
   * Lazy initialization from localStorage. Idempotent.
   * Opens the banner if no decision was stored yet.
   */
  init(): void {
    if (state.initialized || !browser) return;
    state.consent = loadInitial();
    state.isOpen = state.consent === null;
    state.initialized = true;
  },

  /** Re-open from a footer link (allows withdrawal / change of decision). */
  open(): void {
    state.isOpen = true;
  },

  /**
   * Close the banner. Only allowed once a decision exists — otherwise the
   * user could click outside and be tracked anyway (DSGVO violation).
   */
  close(): void {
    if (state.consent !== null) {
      state.isOpen = false;
    }
  },

  acceptAll(): void {
    this.save({ functional: true, analytics: true });
  },

  rejectAll(): void {
    this.save({ functional: false, analytics: false });
  },

  save(opts: { functional: boolean; analytics: boolean }): void {
    const next: CookieConsent = {
      version: CONSENT_VERSION,
      decidedAt: new Date().toISOString(),
      essential: true,
      functional: opts.functional,
      analytics: opts.analytics,
    };
    state.consent = next;
    state.isOpen = false;
    persist(next);
  },

  /** Wipe the stored decision (e.g. for testing). Re-opens the banner. */
  reset(): void {
    state.consent = null;
    state.isOpen = true;
    if (browser) {
      localStorage.removeItem(STORAGE_KEY);
    }
  },
};
