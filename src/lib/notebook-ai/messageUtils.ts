import type { NotebookAiMessage } from "./types";

const INPUT_ONLY_TOOL_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNotebookAiToolPart(
  part: unknown,
): part is {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
} {
  return isObject(part) && typeof part.type === "string" && part.type.startsWith("tool-");
}

function shouldDropFinishedToolPart(part: unknown) {
  if (!isNotebookAiToolPart(part)) return false;
  const state = part.state ?? "";
  const hasTerminalPayload =
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    part.output !== undefined ||
    Boolean(part.errorText);

  return INPUT_ONLY_TOOL_STATES.has(state) && !hasTerminalPayload;
}

function hasModelRelevantPart(part: unknown) {
  if (!isObject(part) || typeof part.type !== "string") return false;
  if (part.type === "step-start") return false;
  return true;
}

export function sanitizeNotebookAiMessages(
  messages: NotebookAiMessage[],
): NotebookAiMessage[] {
  const nextMessages: NotebookAiMessage[] = [];
  let changed = false;

  for (const message of messages) {
    const parts = message.parts ?? [];
    const nextParts = parts.filter((part) => !shouldDropFinishedToolPart(part));

    if (nextParts.length !== parts.length) changed = true;

    if (message.role === "assistant" && !nextParts.some(hasModelRelevantPart)) {
      changed = true;
      continue;
    }

    nextMessages.push(
      nextParts === parts
        ? message
        : ({
            ...message,
            parts: nextParts,
          } as NotebookAiMessage),
    );
  }

  return changed ? nextMessages : messages;
}
