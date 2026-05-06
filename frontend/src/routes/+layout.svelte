<script lang="ts">
  import '$lib/actions/modal-dropdown-scroll';
  import '../app.css';
  import CookieBanner from '$lib/components/CookieBanner.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import { cookieConsent } from '$lib/utils/cookie-consent.svelte';

  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  const { children }: Props = $props();
</script>

<svelte:head>
  <meta
    name="theme-color"
    content="#121212"
  />
</svelte:head>

<!-- Global Toast Container (1:1 like legacy #) -->
<ToastContainer />

{@render children()}

<!--
  Cookie Banner (DSGVO/TDDDG §25). Disabled by default — see audit
  2026-05-05: today only strictly-necessary storage is used (auth, 2FA,
  E2E IndexedDB, theme/UI prefs, banner-dismissals) and Sentry stores
  nothing on the device, so a banner is not legally required. Flip the
  flag the moment a non-essential consumer (analytics SDK, tracker,
  session-replay) is added.

  Toggle: Doppler / .env → PUBLIC_COOKIE_BANNER_ENABLED=true
  Code path: $lib/utils/cookie-consent.svelte → COOKIE_BANNER_ENABLED
-->
{#if cookieConsent.enabled}
  <CookieBanner />
{/if}
