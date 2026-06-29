import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { blobToBase64 } from "@/lib/imageStorage/utils";
import {
  isLocalFilePath,
  readLocalFileAsBase64,
} from "@/lib/imageStorage/strategies/file-system";

let imageStoragePromise: Promise<{
  imageStorage: { load: (ref: string) => Promise<Blob | null> };
}> | null = null;

const getImageStorage = async () => {
  if (!imageStoragePromise) {
    imageStoragePromise = import("@/lib/imageStorage");
  }
  return imageStoragePromise;
};

function guessMimeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  return `image/${ext}`;
}

/**
 * 将 content 内所有 image 块的 url 就地替换为 data:base64
 * - uuid:/att: → imageStorage 加载
 * - 本地文件路径（绝对路径或 file://）→ fs 读取
 * - http(s) / 已是 base64 → 保留
 */
export async function inlineImagesAsBase64(
  content: BlockNoteContent,
): Promise<void> {
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "image" && block.props?.url) {
      const src: string = block.props.url;
      const mutableProps = block.props as { url: string };

      if (src.startsWith("uuid:") || src.startsWith("att:")) {
        try {
          const { imageStorage } = await getImageStorage();
          const blob = await imageStorage.load(src);
          if (blob) mutableProps.url = await blobToBase64(blob);
        } catch (e) {
          console.warn("[export] 内联图片失败 (uuid/att):", src, e);
        }
      } else if (
        isLocalFilePath(src) &&
        (src.startsWith("/") || /^[A-Za-z]:[\\/]/.test(src))
      ) {
        try {
          const base64 = readLocalFileAsBase64(src);
          if (base64) {
            mutableProps.url = `data:${guessMimeFromPath(src)};base64,${base64}`;
          }
        } catch (e) {
          console.warn("[export] 内联图片失败 (local file):", src, e);
        }
      }
    }

    if (Array.isArray(block.children) && block.children.length) {
      await inlineImagesAsBase64(block.children);
    }
  }
}
