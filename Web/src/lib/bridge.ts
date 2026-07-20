import type { BridgeMessage } from "./types";

let browserHandler: ((message: BridgeMessage) => void) | null = null;

export function installBrowserBridge(handler: (message: BridgeMessage) => void) {
  browserHandler = handler;
  return () => {
    if (browserHandler === handler) browserHandler = null;
  };
}

export function postToHost(message: BridgeMessage) {
  const nativeHandler = window.webkit?.messageHandlers?.gooseNotes;
  if (nativeHandler) {
    nativeHandler.postMessage(message);
    return;
  }
  browserHandler?.(message);
}
