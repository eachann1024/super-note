import { Copy, Download, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { saveBlobAndReveal } from "@/lib/export/fileSave";
import { shell } from "@/lib/utools/shell";

interface ArtifactActionsProps {
  copySource: string;
  downloadSource: string;
  filename: string;
  mimeType: string;
  onInsert?: () => Promise<boolean> | boolean;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard?.writeText(text);
    toast.success("已复制");
    return;
  } catch {
    shell.copyText(text);
    toast.success("已复制");
  }
}

async function downloadText(text: string, filename: string, mimeType: string) {
  try {
    const blob = new Blob([text], { type: mimeType });
    await saveBlobAndReveal(blob, filename);
    toast.success("已保存");
  } catch {
    toast.error("保存失败");
  }
}

export function ArtifactActions({
  copySource,
  downloadSource,
  filename,
  mimeType,
  onInsert,
}: ArtifactActionsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-[8px] border border-border/80 bg-background/95 p-1 opacity-0 shadow-[0_8px_22px_rgba(15,23,42,0.08)] transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-white/15">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-[7px] text-muted-foreground hover:text-foreground"
              aria-label="复制源码"
              onClick={() => void copyText(copySource)}
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>复制源码</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-[7px] text-muted-foreground hover:text-foreground"
              aria-label="下载 SVG"
              disabled={!downloadSource}
              onClick={() => void downloadText(downloadSource, filename, mimeType)}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>下载 SVG</TooltipContent>
        </Tooltip>
        {onInsert ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-[7px] text-muted-foreground hover:text-foreground"
                aria-label="插入当前笔记"
                onClick={async () => {
                  const ok = await onInsert();
                  toast[ok ? "success" : "error"](ok ? "已插入当前笔记" : "未找到当前笔记");
                }}
              >
                <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>插入当前笔记</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
