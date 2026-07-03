import { expect, test } from "playwright/test";
import { createEditorSafeContent } from "../../src/components/editor/utils/blocknote-content/editorSafeContent";

const inlineSchema = {
  blockSpecs: {
    paragraph: { config: { content: "inline", propSchema: {} } },
    table: { config: { content: "table", propSchema: {} } },
  },
};

const linkedInlineContent = [
  { type: "text", text: "Open " },
  {
    type: "link",
    href: "https://example.com",
    content: [{ type: "text", text: "Example" }],
  },
  { type: "text", text: " now" },
];

test("createEditorSafeContent preserves inline links", () => {
  const sanitizedParagraph = createEditorSafeContent(
    [{ type: "paragraph", content: linkedInlineContent }],
    inlineSchema,
  );

  expect(sanitizedParagraph).toEqual([
    { type: "paragraph", content: linkedInlineContent },
  ]);

  const sanitizedTable = createEditorSafeContent(
    [
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [linkedInlineContent] }],
        },
      },
    ],
    inlineSchema,
  );

  expect(sanitizedTable).toEqual([
    {
      type: "table",
      content: {
        type: "tableContent",
        rows: [{ cells: [linkedInlineContent] }],
      },
    },
  ]);
});
