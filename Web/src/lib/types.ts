export type Appearance = "light" | "dark";
export type EditorFont = "sans" | "serif" | "mono";

export interface EditorPagePayload {
  version: 1;
  generation: number;
  pageID: string;
  revision: number;
  title: string;
  markdown: string;
  appearance: Appearance;
  editorFont: EditorFont;
  fullWidth: boolean;
  reduceMotion: boolean;
  increaseContrast: boolean;
}

export interface EditorPreferences {
  appearance: Appearance;
  editorFont: EditorFont;
  fullWidth: boolean;
  reduceMotion: boolean;
  increaseContrast: boolean;
}

export interface EditorDraft {
  version: 1;
  requestID: string;
  pageID: string;
  baseRevision: number;
  title: string;
  markdown: string;
  hasChanges: boolean;
}

export interface SaveAcknowledgement {
  version: 1;
  requestID: string;
  pageID: string;
  revision: number;
  status: "saved" | "conflict" | "failed";
  message?: string;
}

export interface HostMessage extends EditorDraft {
  type: "change";
}

export interface ReadyMessage {
  version: 1;
  type: "ready";
}

export interface ReloadMessage {
  version: 1;
  type: "reloadRequest";
  pageID: string;
}

export interface DirtyMessage {
  version: 1;
  type: "dirty";
  pageID: string;
}

export type BridgeMessage = HostMessage | ReadyMessage | ReloadMessage | DirtyMessage;

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        gooseNotes?: { postMessage: (message: BridgeMessage) => void };
      };
    };
    gooseEditor: GooseEditorAPI;
  }
}

export interface GooseEditorAPI {
  receivePage: (page: EditorPagePayload) => void;
  receiveAcknowledgement: (acknowledgement: SaveAcknowledgement) => void;
  updatePreferences: (preferences: EditorPreferences) => void;
  clear: () => void;
  dispatchCommand: (command: { name: string }) => void;
  flushAndGetDraft: () => Promise<EditorDraft>;
  focusEditor: () => void;
}
