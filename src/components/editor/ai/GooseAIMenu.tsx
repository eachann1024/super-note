import { useCallback } from "react";
import { useBlockNoteEditor, useExtension } from "@blocknote/react";
import { AIExtension, AIMenu, type AIMenuProps } from "@blocknote/xl-ai";
import { toast } from "sonner";
import {
  applyBlockTypeTransformToEditor,
  createBlockTypeTransformSelectionSnapshot,
  getBlockTypeTransformTargetLabel,
  resolveBlockTypeTransformIntent,
  resolveGeneratedBlockStructureExpectation,
  validateGeneratedBlockStructure,
  type BlockTypeTransformBlock,
} from "@/lib/ai-write";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";

/**
 * 在 BlockNote 默认 AI 菜单之上拦截确定性的块类型转换。
 * 其它提示仍完整交给 xl-ai，避免改变已有的生成、润色和改写行为。
 */
export function GooseAIMenu(props: AIMenuProps) {
  const editor = useBlockNoteEditor();
  const ai = useExtension(AIExtension);
  const { page } = useEditorPageContext();

  const handleManualPromptSubmit = useCallback(
    async (userPrompt: string) => {
      const transformIntent = resolveBlockTypeTransformIntent(userPrompt);
      if (!transformIntent) {
        const structureExpectation =
          resolveGeneratedBlockStructureExpectation(userPrompt);
        if (structureExpectation) {
          const beforeBlocks = structuredClone(
            editor.document,
          ) as BlockTypeTransformBlock[];
          await ai.invokeAI({
            userPrompt,
            useSelection: editor.getSelection() !== undefined,
          });

          const menuState = ai.store.state.aiMenuState;
          if (menuState !== "closed" && menuState.status === "user-reviewing") {
            const validation = validateGeneratedBlockStructure({
              beforeBlocks,
              afterBlocks: editor.document as BlockTypeTransformBlock[],
              expectation: structureExpectation,
            });
            if (!validation.ok) {
              ai.rejectChanges();
              toast.error(validation.reason);
            }
          }
          return;
        }

        if (props.onManualPromptSubmit) {
          props.onManualPromptSubmit(userPrompt);
          return;
        }
        void ai.invokeAI({
          userPrompt,
          useSelection: editor.getSelection() !== undefined,
        });
        return;
      }

      let menuClosed = false;
      try {
        if (page.isLocked || page.trashedAt) {
          throw new Error("当前页面不可编辑，未转换待办事项。");
        }
        if (page.localFilePath && page.localReadState === "error") {
          throw new Error("本地页面读取失败，未转换待办事项。");
        }
        const snapshot = createBlockTypeTransformSelectionSnapshot(editor, {
          pageId: page.id,
          protectFirstTitle: !page.localFilePath,
        });
        ai.closeAIMenu();
        menuClosed = true;
        const result = applyBlockTypeTransformToEditor(
          editor,
          snapshot,
          transformIntent,
        );
        const targetLabel = getBlockTypeTransformTargetLabel(result.target);
        toast.success(`已转换为 ${result.convertedCount} 个${targetLabel}块`);
      } catch (error) {
        const targetLabel = getBlockTypeTransformTargetLabel(transformIntent);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : `转换为${targetLabel}失败，内容未修改。`,
        );
      } finally {
        if (!menuClosed) ai.closeAIMenu();
      }
    },
    [ai, editor, page, props],
  );

  return <AIMenu {...props} onManualPromptSubmit={handleManualPromptSubmit} />;
}
