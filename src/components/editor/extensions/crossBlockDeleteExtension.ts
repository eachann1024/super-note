import { createExtension } from "@blocknote/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * 跨块选区删除：把选中的 block 当作结构单位删除，而不是只清空每个 block 内部文本。
 *
 * 默认行为：选区从「标题中间」一直拖到「下一个段落」，按删除键时 ProseMirror 会删掉
 * 标题尾部 + 块边界 + 段落头部，于是下个段落整段被并入标题（见用户反馈截图）。
 * 这破坏「第一行恒为标题一」的语义。
 *
 * 旧修复改为逐块删除 inline 内容并保留块容器；这会导致「多选 block + 删除」后标题、
 * 表格、引用等空壳还留在页面里。现在跨 ≥2 个 block 时改为：
 * - 选中的非首块：整块 removeBlocks。
 * - 首块标题：只清掉被选中的 inline 内容，绝不删除物理首块。
 * - 删除后光标落到相邻的保留块。
 */

type BlockHit = {
  id: string;
  /** blockContainer 内容节点（heading/paragraph/...）在文档中的起止（inline 内容坐标）。 */
  contentFrom: number;
  contentTo: number;
  /** 选区在该内容块内覆盖的 inline 区间。 */
  selFrom: number;
  selTo: number;
};

type BlockLike = {
  id: string;
  children?: BlockLike[];
};

type FlatBlock = {
  block: BlockLike;
  parentId: string | null;
};

/** 收集选区跨越的所有顶层 blockContainer 内容块，及选区在每块内的覆盖区间。 */
function collectSelectedBlocks(state: EditorState): BlockHit[] {
  const { from, to } = state.selection;
  const hits: BlockHit[] = [];

  state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== "blockContainer") return true;
    const content = node.firstChild;
    if (!content || !content.isTextblock) return true; // 仅处理 inline 内容块

    const contentFrom = pos + 2; // blockContainer(+1) → 内容节点(+1) → 内部首位
    const contentTo = contentFrom + content.content.size;

    // 该内容块与选区有交集？
    const overlapFrom = Math.max(from, contentFrom);
    const overlapTo = Math.min(to, contentTo);
    if (overlapFrom <= overlapTo && overlapTo >= contentFrom && overlapFrom <= contentTo) {
      // 有重叠（含零长度边界接触；零长度的端点块跳过，避免空删）
      if (overlapFrom < overlapTo) {
        hits.push({
          id: String(node.attrs.id),
          contentFrom,
          contentTo,
          selFrom: overlapFrom,
          selTo: overlapTo,
        });
      }
    }
    return false; // 不下钻嵌套块（嵌套子块由上层处理足够覆盖常见场景）
  });

  return hits;
}

/** 文档第一个 blockContainer 内容节点的 inline 起始坐标（用于判断选区是否起于首块）。 */
function getFirstBlockContentFrom(state: EditorState): number | null {
  let result: number | null = null;
  state.doc.descendants((node: PMNode, pos: number) => {
    if (result !== null) return false;
    if (node.type.name === "blockContainer") {
      const content = node.firstChild;
      if (content && content.isTextblock) result = pos + 2;
      return false;
    }
    return true;
  });
  return result;
}

function deleteWithinBlocks(state: EditorState): Transaction | null {
  const hits = collectSelectedBlocks(state);
  if (hits.length < 2) return null; // 单块或无跨块：交还默认行为

  // 仅用于选区触及首块标题时清理 H1 内联内容；非首块随后会被整块删除。
  const firstContentFrom = getFirstBlockContentFrom(state);
  if (firstContentFrom === null || hits[0].contentFrom !== firstContentFrom) {
    return null;
  }

  let tr = state.tr;
  // 从后往前删，避免前面的删除使后面坐标失效。
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (h.selTo > h.selFrom) {
      tr = tr.delete(h.selFrom, h.selTo);
    }
  }
  if (!tr.docChanged) return null;

  // 光标落到第一个块的删除起点（映射到删除后的坐标）。
  const caret = tr.mapping.map(hits[0].selFrom);
  try {
    tr = tr.setSelection(TextSelection.create(tr.doc, caret));
  } catch {
    /* 映射越界时退回默认选区 */
  }
  return tr.scrollIntoView();
}

function collectSelectedBlockIdsFromPm(state: EditorState): string[] {
  const { from, to } = state.selection;
  const ids: string[] = [];

  state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== "blockContainer") return true;
    const id = node.attrs.id;
    if (!id) return false;

    const nodeFrom = pos;
    const nodeTo = pos + node.nodeSize;
    if (Math.max(from, nodeFrom) < Math.min(to, nodeTo)) {
      ids.push(String(id));
    }
    return false;
  });

  return ids;
}

function flattenBlocks(blocks: readonly BlockLike[], parentId: string | null = null): FlatBlock[] {
  return blocks.flatMap((block) => [
    { block, parentId },
    ...flattenBlocks(block.children ?? [], block.id),
  ]);
}

function hasSelectedAncestor(
  blockId: string,
  selectedIds: Set<string>,
  parentById: Map<string, string | null>,
) {
  let parentId = parentById.get(blockId) ?? null;
  while (parentId) {
    if (selectedIds.has(parentId)) return true;
    parentId = parentById.get(parentId) ?? null;
  }
  return false;
}

function deleteSelectedBlocks(editor: any): boolean {
  const state = editor.prosemirrorState as EditorState;
  if (state.selection.empty) return false;

  const selection = editor.getSelection?.();
  const selectionBlocks = selection?.blocks ?? [];
  const selectedBlocks =
    selectionBlocks.length >= 2
      ? selectionBlocks
      : collectSelectedBlockIdsFromPm(state)
          .map((id) => editor.getBlock?.(id))
          .filter(Boolean);
  if (selectedBlocks.length < 2) return false;

  const firstBlockId = editor.document[0]?.id as string | undefined;
  if (!firstBlockId) return false;

  const flat = flattenBlocks(editor.document as BlockLike[]);
  const flatIndexById = new Map(flat.map((item, index) => [item.block.id, index]));
  const parentById = new Map(flat.map((item) => [item.block.id, item.parentId]));
  const selectedIds = new Set<string>(selectedBlocks.map((block: BlockLike) => block.id));

  const blocksToRemove = selectedBlocks.filter((block: BlockLike) => {
    if (block.id === firstBlockId) return false;
    return !hasSelectedAncestor(block.id, selectedIds, parentById);
  });
  if (blocksToRemove.length === 0) return false;

  const removeIds = new Set<string>(blocksToRemove.map((block: BlockLike) => block.id));
  const firstRemoveIndex = Math.min(
    ...blocksToRemove.map((block: BlockLike) => flatIndexById.get(block.id) ?? Infinity),
  );
  const lastRemoveIndex = Math.max(
    ...blocksToRemove.map((block: BlockLike) => flatIndexById.get(block.id) ?? -1),
  );

  const isRemovedOrInsideRemoved = (blockId: string) =>
    removeIds.has(blockId) || hasSelectedAncestor(blockId, removeIds, parentById);

  const prevTarget = flat
    .slice(0, firstRemoveIndex)
    .reverse()
    .find((item) => !isRemovedOrInsideRemoved(item.block.id))?.block;
  const nextTarget = flat
    .slice(lastRemoveIndex + 1)
    .find((item) => !isRemovedOrInsideRemoved(item.block.id))?.block;

  const titleTextTr = selectedIds.has(firstBlockId) ? deleteWithinBlocks(state) : null;
  if (titleTextTr) {
    editor.prosemirrorView.dispatch(titleTextTr);
  }

  editor.transact(() => {
    editor.removeBlocks(blocksToRemove);
    if (prevTarget) {
      editor.setTextCursorPosition(prevTarget, "end");
    } else if (nextTarget) {
      editor.setTextCursorPosition(nextTarget, "start");
    }
  });

  return true;
}

export const gooseCrossBlockDeleteExtension = createExtension({
  key: "goose-cross-block-delete",
  keyboardShortcuts: {
    Backspace: ({ editor }) => {
      return deleteSelectedBlocks(editor);
    },
    Delete: ({ editor }) => {
      return deleteSelectedBlocks(editor);
    },
  },
});
