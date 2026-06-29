import {
  autoPlacement,
  offset,
  shift,
  size,
  type Middleware,
} from "@floating-ui/react";
import type { FloatingUIOptions } from "@blocknote/react";

const QUICKNOTE_SLASH_VIEWPORT_PADDING = 18;

/** 速记小窗：斜杠菜单贴底/贴顶时留足边距，并让浮层高度受视口约束（避免最后一项被裁切）。 */
export function getQuicknoteSlashMenuFloatingOptions(): FloatingUIOptions {
  const middleware: Middleware[] = [
    offset(6),
    autoPlacement({
      allowedPlacements: ["bottom-start", "top-start"],
      padding: QUICKNOTE_SLASH_VIEWPORT_PADDING,
    }),
    shift({ padding: QUICKNOTE_SLASH_VIEWPORT_PADDING }),
    size({
      apply({ elements, availableHeight }) {
        const h = Math.max(0, availableHeight);
        elements.floating.style.maxHeight = `${h}px`;
        elements.floating.style.overflow = "hidden";
      },
      padding: QUICKNOTE_SLASH_VIEWPORT_PADDING,
    }),
  ];

  return {
    useFloatingOptions: {
      placement: "bottom-start",
      middleware,
    },
    elementProps: {
      style: { zIndex: 200 },
      onMouseDownCapture: (event: React.MouseEvent) => event.preventDefault(),
    },
  };
}