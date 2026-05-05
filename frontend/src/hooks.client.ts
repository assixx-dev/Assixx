/**
 * SvelteKit Client Hooks - Sentry Error Tracking
 *
 * Initializes Sentry on the client side for browser error tracking.
 *
 * Note: DSN is hardcoded because it's public (only allows event submission).
 * This also avoids TypeScript issues with $env/static/public during tsc checks.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/sveltekit/
 * @see https://docs.sentry.io/concepts/key-terms/dsn-explainer/
 */
import * as Sentry from '@sentry/sveltekit';

import { dev } from '$app/environment';

import { createLogger } from '$lib/utils/logger';

const log = createLogger('Sentry');

// DSN is public - hardcoding is the recommended approach per Sentry docs.
// Region: ingest.de.sentry.io → EU/Frankfurt data residency (GDPR-relevant).
// See: https://docs.sentry.io/concepts/key-terms/dsn-explainer/
const SENTRY_DSN =
  'https://afe0f8b38a0c3cc9c09d40f90743766a@o4510697769730048.ingest.de.sentry.io/4510697927802960';

Sentry.init({
  dsn: SENTRY_DSN,

  // Tunnel through our own server to bypass:
  // - Firefox Enhanced Tracking Protection
  // - Ad blockers
  // - Corporate firewalls
  // @see https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
  tunnel: '/sentry-tunnel',

  // Environment identification
  environment: dev ? 'development' : 'production',

  // Performance Monitoring
  // Dev: disabled (noisy, data is useless locally)
  // Prod: 10% sample rate
  tracesSampleRate: dev ? 0 : 0.1,

  // Session Replay: deliberately DISABLED everywhere.
  // Reason 1 (legal): TTDSG §25 + Art. 6/13 DSGVO would require an opt-in
  // consent banner, an explicit Sentry mention in the Datenschutzerklärung
  // (frontend/src/routes/datenschutz/+page.svelte today states "kein
  // nutzerbezogenes Tracking"), and a signed AVV with Functional Software Inc.
  // We have decided not to introduce a consent banner — therefore Replay
  // cannot be enabled, now or later, without revisiting that decision.
  // Reason 2 (perf): rrweb instruments setTimeout / addEventListener /
  // MutationObserver continuously even at low sample rates → measurable
  // overhead, especially in dev where it polluted flame graphs.
  // Error capture (handleErrorWithSentry below) is UNAFFECTED — Stack-Traces,
  // Breadcrumbs and unhandled rejections still flow to Sentry under the
  // legitimate-interest basis (Art. 6(1)(f)).
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Integrations
  // - Dev: BrowserTracing patches window.fetch + history.pushState which
  //   triggers SvelteKit dev-mode warnings. tracesSampleRate is 0 in dev
  //   anyway, so remove the integration entirely to silence the noise.
  // - Replay: never installed (see Session Replay block above). Not adding
  //   the integration is the only way to keep rrweb's wrappers off the page;
  //   sample rate 0 alone does not unhook them once the integration runs.
  integrations: (defaultIntegrations) =>
    dev ? defaultIntegrations.filter((i) => i.name !== 'BrowserTracing') : defaultIntegrations,
});

if (dev) {
  log.info('Frontend client initialized (replay: off, tracing: off)');
}

/**
 * Client-side error handler
 * Wraps the default error handler with Sentry error capture
 */
export const handleError = Sentry.handleErrorWithSentry();
