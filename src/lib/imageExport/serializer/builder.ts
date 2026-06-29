import type { CardTheme } from "../themes";
import type { WatermarkConfig } from "../watermark";
import { DEFAULT_WATERMARK_CONFIG, getWatermarkHTML, normalizeWatermarkConfig } from "../watermark";
import { escapeHtml } from "./utils";

function getGoogleFontsUrl(): string {
  const families = [
    "Inter:wght@400;500;600;700;800;900",
    "Noto+Sans+SC:wght@300;400;500;600;700",
    "Noto+Serif+SC:wght@400;600;700",
    "JetBrains+Mono:wght@400;500",
    "Georgia",
    "Courier+Prime:wght@400;700",
    "ZCOOL+XiaoWei",
    "Ma+Shan+Zheng",
    "Geist:wght@400;500;600;700",
    "Geist+Mono:wght@400;500",
    "Space+Grotesk:wght@400;500;600;700",
    "Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600",
    "IBM+Plex+Sans:wght@400;500;600",
    "IBM+Plex+Mono:wght@400;500",
  ];
  return `https://fonts.googleapis.com/css2?family=${families.join("&family=")}&display=swap`;
}

export function buildStyledHTML(params: {
  title: string;
  blocksHtml: string;
  theme: CardTheme;
  isSelection?: boolean;
  watermarkConfig?: WatermarkConfig;
}): string {
  const { title, blocksHtml, theme } = params;
  const wm = normalizeWatermarkConfig(params.watermarkConfig);
  const t = theme;

  const decoStyle = t.showDecorations
    ? `
    .gooseshot-container::before {
      content: '';
      position: absolute;
      top: -120px; right: -80px;
      width: 360px; height: 360px;
      background: radial-gradient(circle, ${t.decorationColor} 0%, transparent 70%);
      border-radius: 50%;
    }
    .gooseshot-container::after {
      content: '';
      position: absolute;
      bottom: -100px; left: -60px;
      width: 280px; height: 280px;
      background: radial-gradient(circle, ${t.decorationColor} 0%, transparent 70%);
      border-radius: 50%;
    }`
    : "";

  const titleStyle = `
    font-family: ${t.titleFont};
    font-size: ${t.titleFontSize}px;
    font-weight: ${t.titleFontWeight};
    line-height: ${t.titleLineHeight};
    letter-spacing: ${t.titleLetterSpacing};
    color: ${t.textColor};
    text-align: ${t.titleAlign};
  `;

  const headerBorder = "margin-bottom: 24px; padding-bottom: 0; border-bottom: none;";

  const bodyTextAlign = t.id === "academic" ? "text-align: justify;" : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${getGoogleFontsUrl()}">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: ${t.bodyFont};
  color: ${t.textColor};
  line-height: ${t.bodyLineHeight};
  font-size: ${t.bodyFontSize}px;
  letter-spacing: ${t.bodyLetterSpacing};
  ${bodyTextAlign}
}
.gooseshot-container {
  background: ${t.background};
  padding: ${t.containerPaddingY}px ${t.containerPaddingX}px;
  min-width: 680px;
  max-width: 1200px;
  position: relative;
  overflow: hidden;
}
${decoStyle}
.gooseshot-card {
  background: ${t.cardBg};
  border-radius: ${t.cardRadius}px;
  padding: ${t.cardPaddingY}px ${t.cardPaddingX}px;
  box-shadow: ${t.cardShadow};
  position: relative;
  z-index: 1;
  border: ${t.cardBorder};
}
.gooseshot-header {
  ${headerBorder}
}
.gooseshot-title {
  ${titleStyle}
}
.gooseshot-content > * { margin-bottom: 14px; }
.gooseshot-content > *:last-child { margin-bottom: 0; }
.gooseshot-content h1 {
  font-family: ${t.titleFont};
  font-size: ${Math.round(t.titleFontSize * 0.85)}px;
  font-weight: ${t.titleFontWeight};
  margin-top: 28px;
  margin-bottom: 14px;
  color: ${t.textColor};
  line-height: 1.3;
}
.gooseshot-content h2 {
  font-family: ${t.titleFont};
  font-size: ${Math.round(t.titleFontSize * 0.7)}px;
  font-weight: ${Math.max(t.titleFontWeight - 100, 400)};
  margin-top: 24px;
  margin-bottom: 12px;
  color: ${t.textColor};
}
.gooseshot-content h3 {
  font-family: ${t.titleFont};
  font-size: ${Math.round(t.titleFontSize * 0.6)}px;
  font-weight: 600;
  margin-top: 20px;
  margin-bottom: 10px;
  color: ${t.textColor};
}
.gooseshot-content p {
  margin-bottom: 12px;
  line-height: ${t.bodyLineHeight};
}
.gooseshot-content ul, .gooseshot-content ol {
  margin-bottom: 12px;
  padding-left: 22px;
}
.gooseshot-content li {
  margin-bottom: 5px;
  line-height: 1.75;
}
.gooseshot-content ul li::marker { color: ${t.secondaryText}; }
.gooseshot-content code {
  font-family: ${t.codeFont};
  font-size: 0.86em;
  background: ${t.codeBg};
  padding: 2px 6px;
  border-radius: 4px;
  color: ${t.codeTextColor ?? t.textColor};
}
.gooseshot-content pre {
  background: ${t.codeBg};
  border-radius: 10px;
  padding: 16px 18px;
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid ${t.tableBorder};
  color: ${t.codeTextColor ?? t.textColor};
}
.gooseshot-content pre code {
  background: transparent;
  padding: 0;
  font-size: 13px;
  line-height: 1.7;
  font-family: ${t.codeFont};
  color: inherit;
}
.gooseshot-content blockquote {
  border-left: 3px solid ${t.quoteBorder};
  padding-left: 18px;
  margin: 16px 0;
  color: ${t.secondaryText};
  font-style: italic;
}
.gooseshot-content img {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  margin: 16px 0;
}
.gooseshot-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
.gooseshot-content th, .gooseshot-content td {
  border: 1px solid ${t.tableBorder};
  padding: 8px 12px;
  text-align: left;
}
.gooseshot-content th {
  background: ${t.codeBg};
  font-weight: 600;
}
.gooseshot-content hr {
  border: none;
  border-top: 1px solid ${t.divider};
  margin: 20px 0;
}
.gooseshot-content .callout {
  background: ${t.calloutBg};
  border-radius: 10px;
  padding: 14px 18px;
  margin: 14px 0;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.gooseshot-content .callout-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}
.gooseshot-content .callout-text {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  line-height: 1.75;
}
.gooseshot-content .nested-children {
  margin-left: 22px;
  margin-top: 6px;
}
.gooseshot-content .toggle-summary {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.gooseshot-content .toggle-marker {
  flex-shrink: 0;
  color: ${t.secondaryText};
  line-height: inherit;
}
.gooseshot-content .toggle-children {
  margin-left: 22px;
  margin-top: 6px;
  border-left: 2px solid ${t.divider};
  padding-left: 14px;
}
/* 嵌套容器内的块间距：.gooseshot-content > * 只命中直接子级，嵌套块需单独补 */
.gooseshot-content .nested-children > *,
.gooseshot-content .toggle-children > * {
  margin-bottom: 8px;
}
.gooseshot-content .nested-children > *:last-child,
.gooseshot-content .toggle-children > *:last-child {
  margin-bottom: 0;
}
/* 嵌套进 callout/折叠块的宽内容（表格、代码块）兜底，避免撑破 flex 容器 */
.gooseshot-content .callout-text pre,
.gooseshot-content .nested-children table,
.gooseshot-content .toggle-children table {
  max-width: 100%;
}
.gooseshot-watermark {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid ${t.divider};
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.gooseshot-watermark-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.gooseshot-watermark-icon {
  font-size: 16px;
  line-height: 1;
}
.gooseshot-watermark-brand {
  color: ${t.watermark};
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.gooseshot-watermark-date {
  color: ${t.watermark};
  font-size: 11px;
  font-weight: 400;
}
.gooseshot-content strong { font-weight: 600; }
.gooseshot-content em { font-style: italic; }
.gooseshot-content del { text-decoration: line-through; }
.gooseshot-content a {
  color: ${t.accent};
  text-decoration: none;
}
.gooseshot-content a:hover { text-decoration: underline; }
.gooseshot-content .task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 5px;
}
.gooseshot-content .task-checkbox {
  width: 16px;
  height: 16px;
  border: 2px solid ${t.tableBorder};
  border-radius: 4px;
  flex-shrink: 0;
  margin-top: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gooseshot-content .task-checkbox.checked {
  background: ${t.accent};
  border-color: ${t.accent};
}
.gooseshot-content .task-checkbox.checked::after {
  content: '✓';
  color: white;
  font-size: 11px;
}
.gooseshot-selection-tag {
  display: inline-block;
  background: ${t.accent}15;
  color: ${t.accent};
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  margin-bottom: 12px;
  letter-spacing: 0.02em;
}
</style>
</head>
<body>
<div class="gooseshot-container">
  <div class="gooseshot-card">
    ${wm.showTitle ? `<div class="gooseshot-header">
      <div class="gooseshot-title">${escapeHtml(title || "无标题")}</div>
    </div>` : ""}
    <div class="gooseshot-content">
      ${blocksHtml}
    </div>
    ${getWatermarkHTML(theme, wm)}
  </div>
</div>
</body>
</html>`;
}
