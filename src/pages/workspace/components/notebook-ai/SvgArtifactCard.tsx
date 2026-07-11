import { useMemo, type RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { sanitizeSvgMarkup } from "@/lib/notebook-ai/svgSanitizer";
import { ArtifactActions } from "./ArtifactActions";
import { createSvgArtifactBlocks, insertArtifactBlocks } from "./insertArtifact";

interface SvgArtifactCardProps {
  title?: string;
  svg: string;
  editorRef?: RefObject<EditorRef | null>;
}

export function SvgArtifactCard({ title, svg, editorRef }: SvgArtifactCardProps) {
  const sanitizedSvg = useMemo(() => sanitizeSvgMarkup(svg), [svg]);

  return (
    <div className="group relative my-2 overflow-hidden rounded-[8px] border border-border bg-background">
      <ArtifactActions
        copySource={sanitizedSvg}
        downloadSource={sanitizedSvg}
        filename="artifact.svg"
        mimeType="image/svg+xml;charset=utf-8"
        onInsert={() => insertArtifactBlocks(
          editorRef,
          createSvgArtifactBlocks(title, sanitizedSvg),
        )}
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
            className="notebook-ai-artifact-svg mx-auto flex min-w-full w-max justify-center"
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
