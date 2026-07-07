import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { getContentSignature } from "@/components/editor/utils/blocknote-content";
import { countWords } from "@/components/editor/utils/content-text-extractor";
import { resolveHistoryBackend, type HistoryBackend } from "./backend";
import { usePages } from "@/stores/usePages";
import type {
  HistoryIndexEntry,
  HistoryTrigger,
  HistoryVersion,
} from "./types";

/** 单页面历史版本硬上限。超过时淘汰最旧的非里程碑。 */
const MAX_VERSIONS_PER_PAGE = 50;

function genVersionId(now: number): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function estimateSize(content: BlockNoteContent): number {
  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
}

async function isSameAsLatestVersion(
  pageId: string,
  index: { versions: Array<{ versionId: string }> },
  content: BlockNoteContent,
  backend: HistoryBackend,
): Promise<boolean> {
  const latestEntry = index.versions[index.versions.length - 1];
  if (!latestEntry) return false;
  const latest = await backend.loadVersion(pageId, latestEntry.versionId);
  if (!latest) return false;
  return getContentSignature(latest.content) === getContentSignature(content);
}

export interface RecordSnapshotParams {
  pageId: string;
  workspaceId: string;
  content: BlockNoteContent;
  trigger: HistoryTrigger;
  isMilestone?: boolean;
  label?: string;
}

/**
 * 落一个完整快照版本。返回新创建的索引条目；若与最新版本无差异且非手动，则返回 null 跳过。
 */
export async function recordHistorySnapshot(
  params: RecordSnapshotParams,
): Promise<HistoryIndexEntry | null> {
  const { pageId, workspaceId, content, trigger, isMilestone, label } = params;

  const backend = resolveHistoryBackend(pageId);
  const index = await backend.loadIndex(pageId);
  const now = Date.now();
  const charCount = countWords(content);
  const charDelta = charCount - index.lastVersionCharCount;

  if (trigger === "idle" && charDelta === 0 && !isMilestone) {
    if (await isSameAsLatestVersion(pageId, index, content, backend)) {
      return null;
    }
  }

  const versionId = genVersionId(now);
  const size = estimateSize(content);

  // 本地文件夹页面额外保存 frontmatter
  const page = usePages.getState().pages[pageId];
  const localFrontmatter = page?.localFrontmatter;

  const version: HistoryVersion = {
    versionId,
    pageId,
    workspaceId,
    createdAt: now,
    trigger,
    isMilestone: !!isMilestone,
    label,
    charCount,
    charDelta,
    size,
    content,
    ...(localFrontmatter !== undefined ? { localFrontmatter } : {}),
  };

  await backend.saveVersion(version);

  const entry: HistoryIndexEntry = {
    versionId,
    createdAt: now,
    trigger,
    isMilestone: !!isMilestone,
    label,
    charCount,
    charDelta,
    size,
  };

  let nextVersions = [...index.versions, entry];

  if (nextVersions.length > MAX_VERSIONS_PER_PAGE) {
    while (nextVersions.length > MAX_VERSIONS_PER_PAGE) {
      const evictIdx = nextVersions.findIndex((v) => !v.isMilestone);
      if (evictIdx === -1) break;
      const evicted = nextVersions[evictIdx];
      await backend.removeVersion(pageId, evicted.versionId);
      nextVersions = nextVersions.filter((_, i) => i !== evictIdx);
    }
  }

  await backend.saveIndex({
    pageId,
    versions: nextVersions,
    lastVersionCharCount: charCount,
  });

  return entry;
}

async function patchEntry(
  pageId: string,
  versionId: string,
  patch: Partial<HistoryIndexEntry>,
): Promise<void> {
  const backend = resolveHistoryBackend(pageId);
  const index = await backend.loadIndex(pageId);
  const nextVersions = index.versions.map((v) =>
    v.versionId === versionId ? { ...v, ...patch } : v,
  );
  await backend.saveIndex({ ...index, versions: nextVersions });

  const version = await backend.loadVersion(pageId, versionId);
  if (version) {
    await backend.saveVersion({ ...version, ...patch });
  }
}

export async function markMilestone(
  pageId: string,
  versionId: string,
  label?: string,
): Promise<void> {
  await patchEntry(pageId, versionId, {
    isMilestone: true,
    ...(label !== undefined ? { label } : {}),
  });
}

export async function unmarkMilestone(
  pageId: string,
  versionId: string,
): Promise<void> {
  await patchEntry(pageId, versionId, { isMilestone: false });
}

export async function renameVersion(
  pageId: string,
  versionId: string,
  label: string,
): Promise<void> {
  await patchEntry(pageId, versionId, { label });
}

export async function deleteVersion(
  pageId: string,
  versionId: string,
): Promise<void> {
  const backend = resolveHistoryBackend(pageId);
  const index = await backend.loadIndex(pageId);
  const nextVersions = index.versions.filter((v) => v.versionId !== versionId);
  await backend.removeVersion(pageId, versionId);
  await backend.saveIndex({ ...index, versions: nextVersions });
}
