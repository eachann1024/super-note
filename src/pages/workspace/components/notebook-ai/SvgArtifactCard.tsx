import { useMemo } from "react";
import { importMarkdownFragment } from "@/lib/export";
import { sanitizeSvgMarkup, svgToDataUrl } from "@/lib/notebook-ai/svgSanitizer";
import { usePages } from "@/stores/usePages";
import { ArtifactActions } from "./ArtifactActions";

interface SvgArtifactCardProps {
  title?: string;
  svg: string;
}

async function appendSvgToCurrentPage(title: string | undefined, sanitizedSvg: string) {
  const pageId = usePages.getState().activePageId;
  if (!pageId || !sanitizedSvg) return false;

  const markdown = `${title ? `### ${title}\n\n` : ""}![${title ?? "SVG"}](${svgToDataUrl(sanitizedSvg)})`;
  const blocks = importMarkdownFragment(markdown);
  if (!blocks) return false;
  return usePages.getState().appendPageContent(pageId, blocks);
}

export function SvgArtifactCard({ title, svg }: SvgArtifactCardProps) {
  const sanitizedSvg = useMemo(() => sanitizeSvgMarkup(svg), [svg]);

  return (
    <div className="group relative my-2 overflow-hidden rounded-[8px] border border-border bg-background">
      <ArtifactActions
        copySource={sanitizedSvg}
        downloadSource={sanitizedSvg}
        filename="artifact.svg"
        mimeType="image/svg+xml;charset=utf-8"
        onInsert={() => appendSvgToCurrentPage(title, sanitizedSvg)}
      />
      {title ? (
        <div className="border-b border-border/70 px-3 py-2 text-xs font-medium text-foreground">
          {title}
        </div>
      ) : null}
      <div className="min-h-[180px] overflow-x-auto px-3 py-4">
        {sanitizedSvg ? (
          <div
            aria-hidden="true"
            className="mx-auto flex min-w-max justify-center [&>svg]:max-h-[420px]"
            // Model SVG is allowlisted by sanitizeSvgMarkup before rendering.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
        ) : (
          <div className="flex min-h-[160px] items-center justify-center text-xs text-muted-foreground">
            SVG 无法显示
          </div>
        )}
      </div>
    </div>
  );
}
