import createDOMPurify from "dompurify";

const ALLOWED_SVG_TAGS = [
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "title",
  "desc",
] as const;

const ALLOWED_SVG_ATTRS = [
  "aria-hidden",
  "aria-label",
  "class",
  "clip-path",
  "clip-rule",
  "cx",
  "cy",
  "d",
  "dx",
  "dy",
  "fill",
  "fill-opacity",
  "fill-rule",
  "font-family",
  "font-size",
  "font-weight",
  "gradientTransform",
  "gradientUnits",
  "height",
  "id",
  "mask",
  "offset",
  "opacity",
  "points",
  "preserveAspectRatio",
  "r",
  "role",
  "rx",
  "ry",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "style",
  "text-anchor",
  "transform",
  "viewBox",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
] as const;

function stripExternalUrlReferences(svg: string): string {
  return svg
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\s(?:href|xlink:href|src)=["'][^"']*["']/gi, "")
    .replace(/url\(\s*(['"]?)(?!#)[^)]+\1\s*\)/gi, "none");
}

function fallbackSanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<(?:iframe|image|use|animate|set)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function sanitizeWithDomPurify(svg: string): string {
  if (typeof window === "undefined") return fallbackSanitizeSvg(svg);

  const purifierFactory = createDOMPurify as unknown as
    | { sanitize?: typeof createDOMPurify.sanitize }
    | ((root: Window) => { sanitize: typeof createDOMPurify.sanitize });
  const purifier =
    typeof purifierFactory === "function"
      ? purifierFactory(window)
      : purifierFactory;

  if (typeof purifier.sanitize !== "function") return fallbackSanitizeSvg(svg);

  return purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: false },
    ALLOWED_TAGS: [...ALLOWED_SVG_TAGS],
    ALLOWED_ATTR: [...ALLOWED_SVG_ATTRS],
    FORBID_TAGS: ["script", "foreignObject", "iframe", "image", "use", "animate", "set"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}

export function sanitizeSvgMarkup(svg: string): string {
  return stripExternalUrlReferences(sanitizeWithDomPurify(svg)).trim();
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
