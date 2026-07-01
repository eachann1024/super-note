import type { PartialBlock } from "@blocknote/core";
import type { BlockNoteContent } from "./emptyContent";
import { createEmptyLocalPageContent } from "./emptyContent";
import { hasStructuredBlocks, simpleExtractText } from "./normalize";

type BlockSpecLike = {
  config?: {
    content?: string;
    propSchema?: Record<string, unknown>;
  };
};

type EditorSchemaLike = {
  blockSpecs?: Record<string, BlockSpecLike>;
};

function getBlockSpecs(schema: unknown): Record<string, BlockSpecLike> {
  const specs = (schema as EditorSchemaLike | undefined)?.blockSpecs;
  return specs && typeof specs === "object" ? specs : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeInlineContent(content: unknown): PartialBlock["content"] {
  if (typeof content === "string") return content;
  if (Array.isArray(content) && !hasStructuredBlocks(content))
    return content as PartialBlock["content"];
  return simpleExtractText({ content });
}

function sanitizeProps(
  type: string,
  props: unknown,
  spec: BlockSpecLike | undefined,
): PartialBlock["props"] | undefined {
  if (!isPlainObject(props)) return undefined;

  const propSchema = spec?.config?.propSchema;
  const allowedKeys =
    propSchema && typeof propSchema === "object"
      ? new Set(Object.keys(propSchema))
      : null;
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (value == null) continue;
    next[key] = value;
  }

  if (type === "heading") {
    const level = Number(next.level);
    next.level = Number.isFinite(level) ? Math.min(Math.max(level, 1), 3) : 1;
  }

  return Object.keys(next).length > 0
    ? (next as PartialBlock["props"])
    : undefined;
}

function sanitizeTableContent(
  content: unknown,
): PartialBlock["content"] | null {
  const rows = (content as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rows)) return null;

  const sanitizedRows: Array<{ cells: unknown[] }> = [];
  for (const row of rows) {
    const cells = (row as { cells?: unknown } | undefined)?.cells;
    if (!Array.isArray(cells)) continue;
    const sanitizedCells = cells.map((cell) => {
      if (typeof cell === "string") return cell;
      if (Array.isArray(cell) && !hasStructuredBlocks(cell)) return cell;
      return simpleExtractText({ content: cell });
    });
    if (sanitizedCells.length > 0) {
      sanitizedRows.push({ cells: sanitizedCells });
    }
  }

  return sanitizedRows.length > 0
    ? ({ type: "tableContent", rows: sanitizedRows } as PartialBlock["content"])
    : null;
}

function fallbackBlocksFromUnsupported(
  block: Record<string, unknown>,
  specs: Record<string, BlockSpecLike>,
): PartialBlock[] {
  const nested = [
    ...(hasStructuredBlocks(block.content) ? block.content : []),
    ...(Array.isArray(block.children) ? block.children : []),
  ];
  const children = sanitizeBlocks(nested, specs);
  const text =
    simpleExtractText(block).trim() ||
    String(
      (block.props as Record<string, unknown> | undefined)?.url ?? "",
    ).trim();

  if (!text) return children;

  return [
    {
      type: "paragraph",
      content: text,
      ...(children.length > 0 ? { children } : {}),
    } as PartialBlock,
  ];
}

function sanitizeBlock(
  block: unknown,
  specs: Record<string, BlockSpecLike>,
): PartialBlock[] {
  if (!isPlainObject(block)) return [];

  const rawType = typeof block.type === "string" ? block.type : "";
  const spec = specs[rawType];
  if (!rawType || !spec) {
    return fallbackBlocksFromUnsupported(block, specs);
  }

  const contentKind = spec.config?.content;
  const next = { type: rawType } as PartialBlock;
  const props = sanitizeProps(rawType, block.props ?? block.attrs, spec);
  if (props) next.props = props;

  if (contentKind === "table") {
    const tableContent = sanitizeTableContent(block.content);
    if (!tableContent) return fallbackBlocksFromUnsupported(block, specs);
    next.content = tableContent;
  } else if (contentKind !== "none" && block.content !== undefined) {
    next.content =
      rawType === "codeBlock"
        ? simpleExtractText(block)
        : normalizeInlineContent(block.content);
  }

  const children = sanitizeBlocks(block.children, specs);
  if (children.length > 0) next.children = children;

  return [next];
}

function sanitizeBlocks(
  blocks: unknown,
  specs: Record<string, BlockSpecLike>,
): PartialBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block) => sanitizeBlock(block, specs));
}

export function createEditorSafeContent(
  content: unknown,
  schema: unknown,
): BlockNoteContent {
  const sanitized = sanitizeBlocks(content, getBlockSpecs(schema));
  return sanitized.length > 0
    ? (sanitized as BlockNoteContent)
    : createEmptyLocalPageContent();
}
