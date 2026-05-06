<script lang="ts">
  /**
   * FolderSidebar — Phase 4.9b: per-category count badges dropped (W3 /
   * Known Limitation #11). Pre-migration counts derived from the loaded
   * subset only and were silently wrong on tenants with > 20 docs per
   * scope. Total count remains visible in the page-header stats. The
   * `chat` row keeps its `chatFoldersTotalCount` aggregate because that
   * value comes from the dedicated `/documents/chat-folders` endpoint
   * (server-side aggregate, NOT subject to the documents-list limit).
   *
   * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.9b §D18 W3
   */
  import { FOLDER_DEFINITIONS } from './constants';

  import type { DocumentCategory } from './types';

  interface Props {
    currentCategory: DocumentCategory;
    chatFoldersTotalCount: number;
    onnavigate: (category: DocumentCategory) => void;
  }

  const { currentCategory, chatFoldersTotalCount, onnavigate }: Props = $props();
</script>

<div class="w-64 border-r border-(--border-color) bg-(--background-secondary)">
  <nav
    id="folder-tree"
    class="p-2"
  >
    <ul class="space-y-1">
      {#each FOLDER_DEFINITIONS as folder (folder.category)}
        {@const isActive = folder.category === currentCategory}
        <li>
          <button
            type="button"
            class="folder-item flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors {(
              isActive
            ) ?
              'bg-surface-3 text-primary-500'
            : 'text-content-primary hover:bg-surface-3'}"
            data-category={folder.category}
            onclick={() => {
              onnavigate(folder.category);
            }}
          >
            <span class={isActive ? 'text-primary-500' : 'text-content-secondary'}>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- Safe: icon from hardcoded folder config -->
              {@html folder.icon}
            </span>
            <span class="text-sm {isActive ? 'font-medium' : ''}">{folder.label}</span>
            {#if folder.category === 'chat'}
              <span class="text-content-tertiary ml-auto text-xs">{chatFoldersTotalCount}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </nav>
</div>
