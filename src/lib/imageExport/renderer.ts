import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import { toPng } from "html-to-image";
import type { CardThemeId } from "./themes";
import { getCardTheme } from "./themes";
import type { WatermarkConfig } from "./watermark";
import { normalizeWatermarkConfig } from "./watermark";
import { buildStyledHTML, renderBlocks } from "./domSerializer";
import { resolveImageUrls } from "./remoteImageResolver";
import { renderMermaidBlocksAsImages } from "./mermaid";
import { renderMathBlocksAsImages } from "./math";

// ── Loading Overlay ────────────────────────────────────────────
function createLoadingOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.id = "goose-image-export-loading";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:rgba(8,8,14,0.6);
    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    animation:ge-in .5s cubic-bezier(.16,1,.3,1) both;
    overflow:hidden;
  `;

  const C = ["#58d7b8","#4f9cf7","#9b72f2","#f472b6","#ffb56a","#22d3ee"];
  const particles = Array.from({ length: 14 }, (_, i) => {
    const c = C[i % C.length];
    const x = 34 + i * 2.4;
    const s = 2 + (i % 3);
    const d = (i * 0.32).toFixed(1);
    const dur = (3 + (i % 4) * 0.8).toFixed(1);
    return `<div style="position:absolute;left:${x}%;bottom:38%;width:${s}px;height:${s}px;border-radius:50%;background:${c};box-shadow:0 0 ${s * 3}px ${c};opacity:0;animation:ge-float ${dur}s ease-out ${d}s infinite;will-change:transform,opacity"></div>`;
  }).join("");

  overlay.innerHTML = `<style>
@keyframes ge-in{from{opacity:0}to{opacity:1}}
@keyframes ge-out{to{opacity:0;transform:scale(1.06)}}
@keyframes ge-blob1{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(40px,-28px) scale(1.1)}66%{transform:translate(-28px,32px) scale(.92)}}
@keyframes ge-blob2{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(-36px,28px) scale(1.14)}66%{transform:translate(32px,-36px) scale(.86)}}
@keyframes ge-blob3{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(28px,36px) scale(.94)}66%{transform:translate(-36px,-16px) scale(1.1)}}
@keyframes ge-conic{to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes ge-glow{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.14);opacity:1}}
@keyframes ge-cw{to{transform:rotate(360deg)}}
@keyframes ge-ccw{to{transform:rotate(-360deg)}}
@keyframes ge-pulse{0%{transform:scale(.85);opacity:.5}50%{transform:scale(1.3);opacity:0}100%{transform:scale(.85);opacity:0}}
@keyframes ge-pulse2{0%{transform:scale(.85);opacity:.4}50%{transform:scale(1.4);opacity:0}100%{transform:scale(.85);opacity:0}}
@keyframes ge-float{0%{transform:translateY(0) scale(1);opacity:0}12%{opacity:.8}80%{opacity:.5}100%{transform:translateY(-150px) scale(.2);opacity:0}}
@keyframes ge-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
@keyframes ge-enter{from{transform:scale(.55);opacity:0}to{transform:scale(1);opacity:1}}
@media(prefers-reduced-motion:reduce){#goose-image-export-loading,#goose-image-export-loading *{animation-duration:.01s!important;animation-iteration-count:1!important}}
</style>

<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">
  <div style="position:absolute;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(88,215,184,.22),transparent 70%);top:calc(50% - 240px);left:calc(50% - 90px);filter:blur(72px);animation:ge-blob1 8s ease-in-out infinite;will-change:transform"></div>
  <div style="position:absolute;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(159,114,242,.22),transparent 70%);top:calc(50% - 60px);left:calc(50% + 40px);filter:blur(72px);animation:ge-blob2 10s ease-in-out infinite;will-change:transform"></div>
  <div style="position:absolute;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(255,181,106,.18),transparent 70%);top:calc(50% - 180px);left:calc(50% - 240px);filter:blur(72px);animation:ge-blob3 12s ease-in-out infinite;will-change:transform"></div>
</div>

<div style="position:relative;width:120px;height:120px;display:flex;align-items:center;justify-content:center;animation:ge-enter .65s cubic-bezier(.16,1,.3,1) .08s both">
  <div style="position:absolute;inset:-46px;border-radius:50%;border:.5px solid rgba(255,181,106,.1);animation:ge-cw 22s linear infinite;will-change:transform"></div>
  <div style="position:absolute;inset:-28px;border-radius:50%;border:1px solid rgba(159,114,242,.16);animation:ge-ccw 13s linear infinite;will-change:transform"></div>
  <div style="position:absolute;inset:-12px;border-radius:50%;border:1.5px dashed rgba(88,215,184,.28);animation:ge-cw 5.5s linear infinite;will-change:transform"></div>

  <div style="position:absolute;width:80px;height:80px;border-radius:50%;border:1.5px solid rgba(88,215,184,.25);animation:ge-pulse 2.8s ease-out infinite;will-change:transform,opacity"></div>
  <div style="position:absolute;width:80px;height:80px;border-radius:50%;border:1.5px solid rgba(159,114,242,.2);animation:ge-pulse2 2.8s ease-out 1.4s infinite;will-change:transform,opacity"></div>

  <div style="position:relative;width:56px;height:56px;border-radius:50%;overflow:hidden;animation:ge-glow 2.6s ease-in-out infinite;will-change:transform,opacity">
    <div style="position:absolute;inset:-30%;width:160%;height:160%;top:50%;left:50%;background:conic-gradient(from 0deg,#58d7b8,#4f9cf7,#9b72f2,#f472b6,#ffb56a,#22d3ee,#58d7b8);animation:ge-conic 3s linear infinite;will-change:transform"></div>
    <div style="position:absolute;inset:5px;border-radius:50%;background:rgba(10,10,18,.88);backdrop-filter:blur(4px)"></div>
  </div>

  <div style="position:absolute;inset:-8px;animation:ge-cw 3.2s linear infinite;will-change:transform"><div style="position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:6px;height:6px;border-radius:50%;background:#58d7b8;box-shadow:0 0 10px rgba(88,215,184,.8)"></div></div>
  <div style="position:absolute;inset:-22px;animation:ge-ccw 5s linear infinite;will-change:transform"><div style="position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#ffb56a;box-shadow:0 0 8px rgba(255,181,106,.8)"></div></div>
  <div style="position:absolute;inset:-38px;animation:ge-cw 7.5s linear infinite;will-change:transform"><div style="position:absolute;top:50%;right:-2px;transform:translateY(-50%);width:4px;height:4px;border-radius:50%;background:#9b72f2;box-shadow:0 0 8px rgba(159,114,242,.7)"></div></div>
  <div style="position:absolute;inset:-16px;animation:ge-cw 4s linear infinite;will-change:transform"><div style="position:absolute;left:-2px;top:50%;transform:translateY(-50%);width:3px;height:3px;border-radius:50%;background:#f472b6;box-shadow:0 0 6px rgba(244,114,182,.7)"></div></div>
</div>

<div style="margin-top:30px;font-size:15px;font-weight:600;letter-spacing:.05em;background:linear-gradient(90deg,#58d7b8,#4f9cf7,#9b72f2,#f472b6,#ffb56a,#58d7b8);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:ge-shimmer 2.5s linear infinite,ge-enter .65s cubic-bezier(.16,1,.3,1) .18s both">正在生成图片</div>

<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">${particles}</div>`;

  document.body.appendChild(overlay);
  return overlay;
}

function removeLoadingOverlay(): void {
  const overlay = document.getElementById("goose-image-export-loading");
  if (!overlay) return;
  overlay.style.animation = "ge-out .4s cubic-bezier(.33,1,.68,1) forwards";
  setTimeout(() => overlay.remove(), 420);
}

// ── Core Capture ───────────────────────────────────────────────
async function waitForImages(container: HTMLElement): Promise<void> {
  const images = container.querySelectorAll("img");
  if (images.length === 0) return Promise.resolve();

  const promises = Array.from(images).map((img) => {
    return new Promise<void>((resolve) => {
      if (img.complete) { resolve(); return; }
      img.onload = () => resolve();
      img.onerror = () => resolve();
      setTimeout(() => resolve(), 3000);
    });
  });

  return Promise.all(promises).then(() => {});
}

async function captureElementToPng(element: HTMLElement, filename: string) {
  const overlay = createLoadingOverlay();

  try {
    await Promise.all([
      document.fonts.ready,
      waitForImages(element),
    ]);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    const dataUrl = await toPng(element, {
      pixelRatio: 4,
      quality: 0.92,
      cacheBust: false,
      skipFonts: true,
      imagePlaceholder:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">' +
          '<rect width="200" height="80" rx="6" fill="#f3f4f6"/>' +
          '<text x="100" y="44" font-family="sans-serif" font-size="13" fill="#9ca3af" text-anchor="middle">图片加载失败</text>' +
          '</svg>',
        ),
    });

    const response = await fetch(dataUrl);
    const blob = await response.blob();

    const { saveBlobAndReveal } = await import("../export");
    const saved = await saveBlobAndReveal(blob, filename);
    const { toast } = await import("sonner");
    if (saved) {
      toast.success("图片已保存到下载文件夹");
    } else {
      throw new Error("保存图片失败");
    }
  } catch (error) {
    const { toast } = await import("sonner");
    toast.error("导出图片失败，请重试");
    console.error("[imageExport] capture failed:", error);
  } finally {
    removeLoadingOverlay();
  }
}

// ── File Name Helpers ──────────────────────────────────────────
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "untitled";
}

function buildFileName(title: string, theme: ReturnType<typeof getCardTheme>, suffix?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const parts = [sanitizeFileName(title || "untitled"), sanitizeFileName(theme.nameEn), ts];
  if (suffix) parts.splice(1, 0, suffix);
  return `${parts.join("_")}.png`;
}

// ── Public API: Full Page Export ───────────────────────────────
export async function exportPageToImage(
  page: Page,
  themeId: CardThemeId = "notion",
  watermarkConfig?: WatermarkConfig,
) {
  const theme = getCardTheme(themeId);
  const wm = normalizeWatermarkConfig(watermarkConfig);
  const title = extractTitleFromContent(page.content);
  const content = structuredClone(page.content) as BlockNoteContent;
  await resolveImageUrls(content);
  await renderMermaidBlocksAsImages(content, theme);
  await renderMathBlocksAsImages(content, theme);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  document.body.appendChild(container);

  try {
    const firstBlock = content[0];
    const blocksToRender =
      wm.showTitle && firstBlock?.type === "heading"
        ? content.slice(1)
        : content;
    const blocksHtml = renderBlocks(blocksToRender, theme);
    const html = buildStyledHTML({ title, blocksHtml, theme, watermarkConfig: wm });
    container.innerHTML = html;

    const cardElement = container.querySelector(".gooseshot-container") as HTMLElement;
    if (!cardElement) throw new Error("Failed to create preview element");

    await captureElementToPng(cardElement, buildFileName(title, theme));
  } finally {
    document.body.removeChild(container);
  }
}

// ── Public API: Selection Export ───────────────────────────────
export async function exportSelectionToImage(
  selectionBlocks: BlockNoteContent,
  pageTitle?: string,
  themeId: CardThemeId = "notion",
  watermarkConfig?: WatermarkConfig,
) {
  if (!Array.isArray(selectionBlocks) || selectionBlocks.length === 0) return;

  const theme = getCardTheme(themeId);
  const wm = normalizeWatermarkConfig(watermarkConfig);
  const title = pageTitle || "选中内容";

  const clonedBlocks = structuredClone(selectionBlocks) as BlockNoteContent;
  await resolveImageUrls(clonedBlocks);
  await renderMermaidBlocksAsImages(clonedBlocks, theme);
  await renderMathBlocksAsImages(clonedBlocks, theme);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  document.body.appendChild(container);

  try {
    const blocksHtml = renderBlocks(clonedBlocks, theme);

    const html = buildStyledHTML({
      title,
      blocksHtml,
      theme,
      isSelection: true,
      watermarkConfig: wm,
    });
    container.innerHTML = html;

    const cardElement = container.querySelector(".gooseshot-container") as HTMLElement;
    if (!cardElement) throw new Error("Failed to create preview element");

    await captureElementToPng(cardElement, buildFileName(title, theme, "选中"));
  } finally {
    document.body.removeChild(container);
  }
}

// ── Legacy alias ───────────────────────────────────────────────
export async function exportToImage(page: Page, themeId: CardThemeId = "notion") {
  return exportPageToImage(page, themeId);
}
