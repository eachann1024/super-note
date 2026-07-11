export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const BLOCKNOTE_TEXT_COLORS: Record<string, string> = {
  gray: "#9b9a97",
  brown: "#64473a",
  red: "#e03e3e",
  orange: "#d9730d",
  yellow: "#dfab01",
  green: "#4d6461",
  blue: "#0b6e99",
  purple: "#6940a5",
  pink: "#ad1a72",
};

export const BLOCKNOTE_BACKGROUND_COLORS: Record<string, string> = {
  gray: "#ebeced",
  brown: "#e9e5e3",
  red: "#fbe4e4",
  orange: "#f6e9d9",
  yellow: "#fbf3db",
  green: "#ddedea",
  blue: "#ddebf1",
  purple: "#eae4f2",
  pink: "#f4dfeb",
};


/** 深色卡片上的语义色：提亮色度，避免浅色盘在暗底上发闷、发脏 */
export const BLOCKNOTE_TEXT_COLORS_DARK: Record<string, string> = {
  gray: "#a1a1aa",
  brown: "#d4a574",
  red: "#f87171",
  orange: "#fb923c",
  yellow: "#fbbf24",
  green: "#4ade80",
  blue: "#60a5fa",
  purple: "#c084fc",
  pink: "#f472b6",
};

export const BLOCKNOTE_BACKGROUND_COLORS_DARK: Record<string, string> = {
  gray: "rgba(161,161,170,0.22)",
  brown: "rgba(212,165,116,0.22)",
  red: "rgba(248,113,113,0.2)",
  orange: "rgba(251,146,60,0.2)",
  yellow: "rgba(251,191,36,0.18)",
  green: "rgba(74,222,128,0.18)",
  blue: "rgba(96,165,250,0.18)",
  purple: "rgba(192,132,252,0.2)",
  pink: "rgba(244,114,182,0.2)",
};

export function resolveExportColor(
  value: unknown,
  palette: Record<string, string>,
): string | null {
  if (typeof value !== "string" || value === "" || value === "default") return null;
  return palette[value] || value;
}
