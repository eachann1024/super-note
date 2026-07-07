type EditorContentModePage =
  | {
      id?: string | null;
      localFilePath?: string | null;
    }
  | null
  | undefined;

export const QUICKNOTE_DRAFT_PAGE_ID = "__quicknote_draft__";

export function shouldUseRawEditorContent(
  page: EditorContentModePage,
): boolean {
  return Boolean(page?.localFilePath) || page?.id === QUICKNOTE_DRAFT_PAGE_ID;
}
