import type { FileAttachmentAttrs } from "@/types";
import {
  resolveImageMimeForUpload,
  shouldUploadViaImageStorage,
} from "./pasteClipboardImage";

export interface EditorFileUploadDeps {
  getBlock: ((id: string) => { type?: string } | null | undefined) | null;
  imageStorage: {
    save: (blob: Blob, mimeType: string) => Promise<string>;
  };
  fileStorage: {
    save: (file: File) => Promise<FileAttachmentAttrs>;
  };
  getFileUploadAvailability: () => { enabled: boolean; reason?: string };
}

export async function uploadEditorFile(
  file: File,
  blockId: string | undefined,
  deps: EditorFileUploadDeps,
): Promise<string> {
  const getBlock = deps.getBlock
    ? (id: string) => deps.getBlock?.(id) ?? undefined
    : null;
  const targetBlock = blockId && getBlock ? getBlock(blockId) : undefined;

  if (
    targetBlock?.type !== "file" &&
    shouldUploadViaImageStorage(file, blockId, getBlock)
  ) {
    const mime = resolveImageMimeForUpload(file);
    return deps.imageStorage.save(file, mime);
  }

  const availability = deps.getFileUploadAvailability();
  if (!availability.enabled) {
    throw new Error(availability.reason || "当前笔记本不支持附件上传");
  }

  const saved = await deps.fileStorage.save(file);
  return saved.storageRef;
}
