/*
 * Root layout server load.
 *
 * Sole responsibility: read the BetaBanner dismiss cookie so the server
 * decides BEFORE sending HTML whether the banner should render. This is
 * the only mechanism that fully eliminates both the dismiss-flash AND the
 * first-paint CLS — see BetaBanner.svelte for the design rationale.
 *
 * Cookie classification: TDDDG §25 strictly-necessary functional cookie
 * (project-level legal posture documented in src/routes/+layout.svelte
 * lines 32-35: "banner-dismissals" listed as strictly-necessary storage).
 * Pattern mirrors SingleRootWarningBanner / UnverifiedDomainBanner which
 * solved the same flash problem the same way (commit 2026-04-22).
 */
import type { LayoutServerLoad } from './$types';

// Cookie name — MUST stay in sync with `DISMISS_COOKIE` in
// `src/lib/components/BetaBanner.svelte`. Session cookie (no Max-Age) so
// it dies on browser close, mirroring sessionStorage semantics for
// "first-time visitors must always see the banner" guarantee.
const BETA_BANNER_DISMISS_COOKIE = 'assixx_beta_banner_dismissed';

export const load: LayoutServerLoad = ({ cookies }) => {
  return {
    betaBannerDismissed: cookies.get(BETA_BANNER_DISMISS_COOKIE) === '1',
  };
};
