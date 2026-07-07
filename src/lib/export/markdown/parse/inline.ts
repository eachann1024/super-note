/**
 * 给一组 inline 节点统一附加样式（用于 <u>…</u> / <span style> 内部嵌套解析后合并样式）。
 * 纯字符串节点会被提升为 styled text 节点。
 */
function applyStyles(nodes: any[], extra: Record<string, any>): any[] {
  return nodes.map((node) => {
    if (typeof node === "string") {
      return { type: "text", text: node, styles: { ...extra } };
    }
    if (node?.type === "text") {
      return { ...node, styles: { ...(node.styles || {}), ...extra } };
    }
    return node;
  });
}

function toLinkContent(nodes: any[]): any[] {
  return nodes.flatMap((node) => {
    if (typeof node === "string") {
      return [{ type: "text", text: node, styles: {} }];
    }
    if (node?.type === "text") {
      return [{ ...node, styles: node.styles || {} }];
    }
    if (node?.type === "link" && Array.isArray(node.content)) {
      return toLinkContent(node.content);
    }
    return [];
  });
}

export function parseInlineMarkdown(text: string): any[] {
  const result: any[] = [];
  if (!text) return result;

  // 优先级：$math$ > <u>underline</u> > <span style>…</span> > ==highlight== >
  //         **bold** > *italic* > ~~strike~~ > `code` > [link](url)
  // <u> 与 <span> 内部递归解析，支持下划线/颜色与其他标记的嵌套组合
  const regex =
    /(\$((?:\\\$|[^\$])+?)\$|<u>(.+?)<\/u>|<span\s+style="([^"]+)">(.+?)<\/span>|==(.+?)==|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  function pushPlain(t: string) {
    if (!t) return;
    result.push(t);
  }

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushPlain(text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined) {
      // $math$
      pushPlain(`$${match[2]}$`);
    } else if (match[3] !== undefined) {
      // <u>underline</u>：内部递归，整体附加 underline
      result.push(...applyStyles(parseInlineMarkdown(match[3]), { underline: true }));
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // <span style="…">…</span>：内部递归，整体附加颜色样式
      const style = match[4];
      const styles: Record<string, any> = {};

      const colorMatch = style.match(/(?:^|;)\s*color:\s*([^;]+)/);
      if (colorMatch) {
        styles.textColor = colorMatch[1].trim();
      }

      const bgMatch = style.match(/background-color:\s*([^;]+)/);
      if (bgMatch) {
        styles.backgroundColor = bgMatch[1].trim();
      }

      result.push(...applyStyles(parseInlineMarkdown(match[5]), styles));
    } else if (match[6] !== undefined) {
      // ==highlight== → yellow
      result.push({
        type: "text",
        text: match[6],
        styles: { backgroundColor: "yellow" },
      });
    } else if (match[7] !== undefined) {
      result.push({ type: "text", text: match[7], styles: { bold: true } });
    } else if (match[8] !== undefined) {
      result.push({ type: "text", text: match[8], styles: { italic: true } });
    } else if (match[9] !== undefined) {
      result.push({ type: "text", text: match[9], styles: { strike: true } });
    } else if (match[10] !== undefined) {
      result.push({ type: "text", text: match[10], styles: { code: true } });
    } else if (match[11] !== undefined && match[12] !== undefined) {
      result.push({
        type: "link",
        href: match[12],
        content: toLinkContent(parseInlineMarkdown(match[11])),
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    pushPlain(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}
