import type { Page } from "@/types";
import { DEFAULT_FONT_NAMES } from "@/lib/fontLoader";

interface FontSelectorProps {
  value: Page["fontFamily"];
  onChange: (value: Page["fontFamily"]) => void;
}

const defaultFonts = [
  { value: "default" as const, label: "默认", defaultFont: DEFAULT_FONT_NAMES.default },
  { value: "serif" as const, label: "衬线体", defaultFont: DEFAULT_FONT_NAMES.serif },
  { value: "mono" as const, label: "等宽体", defaultFont: DEFAULT_FONT_NAMES.mono },
];

export function FontSelector({ value, onChange }: FontSelectorProps) {
  const { customFonts } = useSettings();

  return (
    <div className="flex gap-1 p-1">
      {defaultFonts.map((font) => {
        const customFont = customFonts[font.value];
        const label = customFont.label || font.label;
        const fontName = customFont.font || font.defaultFont;

        return (
          <button
            key={font.value}
            type="button"
            onClick={() => onChange(font.value)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 transition-all duration-200",
              "flex flex-col items-center justify-center border border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "hover:bg-accent/50",
              value === font.value && "bg-background ring-2 ring-primary text-primary shadow-sm",
            )}
          >
            <span
              className="text-2xl leading-none mb-1"
              style={{ fontFamily: `"${fontName}"` }}
            >
              Ag
            </span>
            <span className="text-xs" style={{ fontFamily: `"${fontName}"` }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
