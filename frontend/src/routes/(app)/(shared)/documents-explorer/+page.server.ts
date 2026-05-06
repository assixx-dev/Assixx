/**
 * Documents Explorer — Server-Side Data Loading (Phase 4.9b URL-driven state)
 * @module documents-explorer/+page.server
 *
 * URL is the single source of truth for pagination + filter state per
 * FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN §4.9b (Session 10b). Mirrors the
 * 4.6 blackboard reference impl (`/blackboard/+page.server.ts`).
 *
 * URL contract (every key is optional; defaults are NEVER emitted per R5
 * mitigation §0.2):
 *   - `?page=N`             — 1-indexed page number, default 1
 *   - `?search=TERM`        — ILIKE on filename, default ''
 *   - `?accessScope=SCOPE`  — `personal|team|department|company|payroll|blackboard|chat`, default 'all' (= no filter)
 *   - `?sort=KEY`           — `newest|oldest|name|size`, default 'newest' (server-side dispatch since 4.9a §D18 W2)
 *   - `?conversationId=N`   — narrows chat-scope to a single conversation
 *
 * Permission gate (3-layer per ADR-045):
 *   Layer 0 — `(shared)/+layout.server.ts` (route group RBAC, ADR-012)
 *   Layer 1 — `requireAddon('documents')` (addon subscription gate, ADR-033)
 *   Layer 2 — backend `@RequirePermission(documents, documents-files,
 *             'canRead')` produces 403 → `apiFetchPaginatedWithPermission`
 *             surfaces it as `permissionDenied: true` so `+page.svelte`
 *             renders `<PermissionDenied />` (ADR-020).
 *
 * Wrinkles per masterplan §D18:
 *   W1 — pagination UI must be ADDED in 4.9b (page had no pagination block
 *        pre-migration; backend `limit=20` was silently capping).
 *   W2 — `?sort=` is now server-side dispatch (was FE-only over loaded
 *        subset pre-4.9a) — masterplan §D11 anti-dishonest-UI rule kept
 *        all 4 sort options working across all pages.
 *   W3 — folder-sidebar count badges dropped (Known Limitation #11 — the
 *        pre-migration counts derived from the loaded subset only and were
 *        silently wrong; same class as KVP `BadgeCounts` Option-C deferred
 *        per §D9). Total document count remains visible in page-header stats.
 */
import { redirect } from '@sveltejs/kit';

import { apiFetch, apiFetchPaginatedWithPermission } from '$lib/server/api-fetch';
import { requireAddon } from '$lib/utils/addon-guard';
import { buildLoginUrl } from '$lib/utils/build-apex-url';
import { readFilterFromUrl, readPageFromUrl, readSearchFromUrl } from '$lib/utils/url-pagination';

import type { PageServerLoad } from './$types';
import type { ChatFolder, Document } from './_lib/types';

/**
 * Page size — matches backend `ListDocumentsQuerySchema.limit` default (20).
 * Kept as a single constant so `+page.svelte` can reuse the value when
 * computing slice ranges or empty-state copy.
 */
const PAGE_SIZE = 20;

/**
 * Backend wraps documents in `items` post-Phase-4.9a (§D18). Field names use
 * a backend snake-camel mix (`fileSize`, `createdAt`, `createdBy`); FE maps
 * to the canonical `Document` interface (`size`, `uploadedAt`, `uploadedBy`).
 * Mapping was inherited from pre-4.9b legacy unpacking; preserved here so
 * downstream component code (DocumentListView/DocumentGridView/EditModal)
 * is unchanged.
 */
interface RawDocument {
  id: number;
  fileSize?: number;
  size?: number;
  createdAt?: string;
  uploadedAt?: string;
  createdBy?: number;
  uploadedBy?: number;
  [key: string]: unknown;
}

/** `/documents/chat-folders` response — separate aggregator endpoint (not paginated). */
interface ChatFoldersResponse {
  folders: ChatFolder[];
  total: number;
}

/**
 * accessScope URL allow-list — mirrors backend `ACCESS_SCOPE_VALUES` (§D5,
 * verbatim, no FE-side aliasing) plus an `'all'` sentinel for "no filter".
 * `'all'` is NEVER emitted into the URL (R5 mitigation).
 */
const ACCESS_SCOPE_VALUES = [
  'all',
  'personal',
  'team',
  'department',
  'company',
  'payroll',
  'blackboard',
  'chat',
] as const;
type AccessScopeFilter = (typeof ACCESS_SCOPE_VALUES)[number];

/**
 * Sort URL allow-list — mirrors backend `SORT_VALUES` enum verbatim (§D5).
 * Server-side dispatch via `buildDocumentsOrderByClause` (4.9a §D18 W2).
 */
const SORT_VALUES = ['newest', 'oldest', 'name', 'size'] as const;
type SortValue = (typeof SORT_VALUES)[number];

interface UrlState {
  page: number;
  search: string;
  accessScope: AccessScopeFilter;
  sort: SortValue;
  conversationId: number | null;
}

/**
 * URL → state. Each helper applies a safe default on missing/tampered input;
 * `conversationId` is parsed defensively (NaN/non-positive falls to null so
 * the backend never sees an invalid value).
 */
function readUrlState(url: URL): UrlState {
  const conversationIdRaw = url.searchParams.get('conversationId');
  const conversationIdNum =
    conversationIdRaw !== null ? Number.parseInt(conversationIdRaw, 10) : Number.NaN;
  return {
    page: readPageFromUrl(url),
    search: readSearchFromUrl(url),
    accessScope: readFilterFromUrl<AccessScopeFilter>(
      url,
      'accessScope',
      ACCESS_SCOPE_VALUES,
      'all',
    ),
    sort: readFilterFromUrl<SortValue>(url, 'sort', SORT_VALUES, 'newest'),
    conversationId:
      Number.isFinite(conversationIdNum) && conversationIdNum > 0 ? conversationIdNum : null,
  };
}

/**
 * State → backend query string. Every default (page=1, search='',
 * accessScope='all', sort='newest', conversationId=null) is omitted to keep
 * the URL clean (R5 mitigation §0.2).
 */
function buildBackendParams(state: UrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(state.page));
  params.set('limit', String(PAGE_SIZE));
  if (state.search !== '') params.set('search', state.search);
  if (state.accessScope !== 'all') params.set('accessScope', state.accessScope);
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.conversationId !== null) params.set('conversationId', String(state.conversationId));
  return params;
}

/**
 * Field aliasing kept from pre-4.9b legacy mapping — backend names
 * (`fileSize`/`createdAt`/`createdBy`) ≠ FE `Document` interface
 * (`size`/`uploadedAt`/`uploadedBy`). Preserves downstream component contract.
 */
function mapRawDocument(doc: RawDocument): Document {
  return {
    ...doc,
    size: doc.fileSize ?? doc.size ?? 0,
    uploadedAt: doc.createdAt ?? doc.uploadedAt ?? new Date().toISOString(),
    uploadedBy: doc.createdBy ?? doc.uploadedBy ?? 0,
  } as Document;
}

export const load: PageServerLoad = async ({ cookies, fetch, parent, url }) => {
  const token = cookies.get('accessToken');
  if (token === undefined || token === '') {
    redirect(302, buildLoginUrl('session-expired', undefined, url));
  }

  const parentData = await parent();
  requireAddon(parentData.activeAddons, 'documents');

  const state = readUrlState(url);
  const params = buildBackendParams(state);

  // Parallel fetch: paginated documents (permission-aware, ADR-020) +
  // chat-folders aggregator. The chat-folders endpoint stays separate from
  // the paginated documents stream — it returns conversation-level rows
  // (folder cards), not documents, and is intentionally NOT paginated.
  const [documentsResult, chatFoldersData] = await Promise.all([
    apiFetchPaginatedWithPermission<RawDocument>(`/documents?${params.toString()}`, token, fetch),
    apiFetch<ChatFoldersResponse>('/documents/chat-folders', token, fetch),
  ]);

  if (documentsResult.permissionDenied) {
    return {
      permissionDenied: true as const,
      documents: [] as Document[],
      pagination: documentsResult.pagination,
      chatFolders: [] as ChatFolder[],
      currentUser: parentData.user,
      search: '',
      accessScope: 'all',
      sort: 'newest',
      conversationId: null as number | null,
    };
  }

  return {
    permissionDenied: false as const,
    documents: documentsResult.data.map(mapRawDocument),
    pagination: documentsResult.pagination,
    chatFolders: chatFoldersData?.folders ?? [],
    currentUser: parentData.user,
    search: state.search,
    accessScope: state.accessScope,
    sort: state.sort,
    conversationId: state.conversationId,
  };
};

// Re-export the URL-contract types so `+page.svelte` and child components can
// type their props without re-deriving the allow-lists. Single source of
// truth: the readonly tuples above.
export type { AccessScopeFilter, SortValue };
