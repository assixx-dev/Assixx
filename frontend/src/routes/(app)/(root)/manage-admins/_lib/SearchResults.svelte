<!--
  @deprecated 2026-05-05 (Phase 4.2) — orphan file, no consumers.

  Removed in Phase 4.2 of FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN. Search
  is now server-side via `?search=` on `/users?role=admin`; the result
  table itself spans all matching pages, so a separate dropdown of "first
  5 hits" is no longer needed (R8 mitigation §0.2: "use server-side
  `?search=` and accept narrower scope").

  File deletion is user-gated per CLAUDE.md ("Permission denied for any
  git or rm commands. Tell user to do it!"). Once removed, also drop the
  `SearchResultUser` import lookup since this was its only consumer in
  manage-admins (`SearchResultUser` itself remains in `$lib/components/`
  for use by other pages).

  @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.2
-->
<script lang="ts">
  // Intentionally empty. Markup also empty so the component renders nothing
  // if a stale `<SearchResults ... />` reference exists somewhere — fail
  // open-and-silent rather than throwing at runtime.
</script>
