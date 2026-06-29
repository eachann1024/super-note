import type { BlockNoteEditor } from "@blocknote/core";
import type { PartialBlock } from "@blocknote/core/blocks";
import { isPasteableClipboardImageFile } from "./pasteClipboardImage";

function insertOrUpdateBlock(
  editor: BlockNoteEditor<any, any, any>,
  referenceBlock: { id: string; content?: unknown },
  newBlock: PartialBlock<any, any, any>,
  placement: "before" | "after" = "after",
): string {
  const ref = referenceBlock as Parameters<typeof editor.updateBlock>[0];
  if (Array.isArray(referenceBlock.content) && referenceBlock.content.length === 0) {
    return editor.updateBlock(ref, newBlock).id;
  }
  return editor.insertBlocks([newBlock], ref, placement)[0].id;
}

function resolveImageBlockType(editor: BlockNoteEditor<any, any, any>): string {
  if (editor.schema.blockSpecs.imageResize) return "imageResize";
  return "image";
}



/**
 * Mac 剪贴板常无 dataTransfer.types 中的 "Files"（仅有 image/png 等），
 * BlockNote handleFileInsertion 会直接 return；此处遍历 items 插入并 uploadFile。
 */
export async function pasteClipboardFilesFromClipboard(
  event: ClipboardEvent,
  editor: BlockNoteEditor<any, any, any>,
): Promise<void> {
  const data = event.clipboardData;
  if (!data?.items?.length || !editor.uploadFile) return;

  event.preventDefault();

  const currentBlock = editor.getTextCursorPosition().block;

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;

    if (!isPasteableClipboardImageFile(file, item.type)) continue;

    const type = resolveImageBlockType(editor);

    const fileBlock = {
      type,
      props: { name: file.name },
    } as PartialBlock<any, any, any>;

    const insertedBlockId = insertOrUpdateBlock(editor, currentBlock, fileBlock);

    try {
      const updateData = await editor.uploadFile(file, insertedBlockId);
      const updatedFileBlock =
        typeof updateData === "string"
          ? ({ props: { url: updateData } } as PartialBlock<any, any, any>)
          : { ...updateData };
      editor.updateBlock(insertedBlockId, updatedFileBlock);
    } catch (err) {
      console.error("[pasteClipboardFiles] upload failed", err);
      editor.removeBlocks([insertedBlockId]);
    }
  }
}