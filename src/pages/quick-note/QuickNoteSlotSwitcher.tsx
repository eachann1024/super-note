import { useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  QUICKNOTE_SLOTS,
  type QuickNoteSlot,
} from "@/stores/useQuickNote";

interface QuickNoteSlotSwitcherProps {
  activeSlot: QuickNoteSlot;
  onChange: (slot: QuickNoteSlot) => void;
}

/**
 * 标题栏居中的 1–5 便签切换器。
 * 默认只居中显示当前数字；hover / focus-within 时展开全部槽位。
 */
export function QuickNoteSlotSwitcher({
  activeSlot,
  onChange,
}: QuickNoteSlotSwitcherProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = hovered || focused;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = QUICKNOTE_SLOTS.indexOf(activeSlot);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(QUICKNOTE_SLOTS[(idx + 1) % QUICKNOTE_SLOTS.length]!);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(
        QUICKNOTE_SLOTS[(idx - 1 + QUICKNOTE_SLOTS.length) % QUICKNOTE_SLOTS.length]!,
      );
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      onChange(1);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      onChange(5);
      return;
    }
    if (/^[1-5]$/.test(e.key)) {
      e.preventDefault();
      onChange(Number(e.key) as QuickNoteSlot);
    }
  };

  return (
    <div
      className="quicknote-slot-switcher"
      data-expanded={expanded ? "true" : "false"}
      role="radiogroup"
      aria-label="切换便签"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      onKeyDown={onKeyDown}
    >
      {QUICKNOTE_SLOTS.map((slot) => {
        const active = slot === activeSlot;
        return (
          <button
            key={slot}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`便签 ${slot}`}
            tabIndex={active ? 0 : -1}
            data-active={active ? "true" : "false"}
            className="quicknote-slot-btn"
            onClick={() => onChange(slot)}
          >
            <span className="quicknote-slot-btn-label">{slot}</span>
          </button>
        );
      })}
    </div>
  );
}
