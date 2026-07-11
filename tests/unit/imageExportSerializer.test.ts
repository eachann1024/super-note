import { expect, test } from "playwright/test";
import { CARD_THEMES, getCardTheme } from "../../src/lib/imageExport/themes";
import { buildStyledHTML } from "../../src/lib/imageExport/serializer/builder";
import {
  renderBlock,
  renderBlocks,
  renderInline,
} from "../../src/lib/imageExport/serializer/renderer";

test("checkListItem 使用行高包裹盒 + em 尺寸 checkbox", () => {
  const theme = getCardTheme("brutalist");
  const html = renderBlock(
    {
      type: "checkListItem",
      props: { checked: true },
      content: [{ type: "text", text: "完成任务", styles: {} }],
    },
    theme,
  );
  expect(html).toContain("task-checkbox-wrap");
  expect(html).toContain("task-item checked");
  expect(html).toContain("task-text");
  expect(html).toContain("task-checkbox checked");
});

test("heading level 正确输出 h1/h2/h3", () => {
  const theme = getCardTheme("brutalist");
  for (const level of [1, 2, 3] as const) {
    const html = renderBlock(
      {
        type: "heading",
        props: { level },
        content: [{ type: "text", text: `标题${level}`, styles: {} }],
      },
      theme,
    );
    expect(html).toContain(`<h${level}>`);
    expect(html).toContain(`标题${level}`);
  }
});

test("小 titleFontSize 主题的正文 h3 不低于 body 比例保底", () => {
  const theme = getCardTheme("kenya-hara");
  const html = buildStyledHTML({
    title: "测试",
    blocksHtml: "<h3>小节</h3><p>正文</p>",
    theme,
  });
  const m = html.match(/\.gooseshot-content h3 \{[\s\S]*?font-size: (\d+)px/);
  expect(m).toBeTruthy();
  const h3Size = Number(m![1]);
  expect(h3Size).toBeGreaterThanOrEqual(Math.round(theme.bodyFontSize * 1.22));
});

test("全部主题都包含 checklist 居中与标题 CSS", () => {
  for (const theme of CARD_THEMES) {
    const html = buildStyledHTML({
      title: "本周任务",
      blocksHtml:
        '<div class="task-item"><div class="task-checkbox-wrap"><div class="task-checkbox"></div></div><span class="task-text">x</span></div>',
      theme,
    });
    expect(html).toContain(".task-checkbox-wrap");
    expect(html).toContain(`height: ${theme.bodyLineHeight}em`);
    expect(html).toContain("width: 1em");
    expect(html).toMatch(/\.gooseshot-content h3 \{/);
    expect(html).toContain(".empty-block");
  }
});

test("Vercel 极黑浅色 accent 勾选对号用深色", () => {
  const theme = getCardTheme("vercel-dark");
  const html = buildStyledHTML({
    title: "Dark",
    blocksHtml: "<p>hi</p>",
    theme,
  });
  expect(html).toContain("color: #0a0a0a");
});

test("深色主题粉色文字映射到提亮色盘", () => {
  const theme = getCardTheme("obsidian");
  const html = renderBlock(
    {
      type: "paragraph",
      content: [{ type: "text", text: "备注", styles: { textColor: "pink" } }],
    },
    theme,
  );
  expect(html).toContain("#f472b6");
});

test("空段落输出 empty-block 占位", () => {
  const theme = getCardTheme("notion");
  const html = renderBlock({ type: "paragraph", content: [] }, theme);
  expect(html).toContain('class="empty-block"');
  expect(html).toContain("data-empty");
  expect(html).toContain("<br>");
});

test("段内 hardBreak 与文本换行转 br", () => {
  const theme = getCardTheme("notion");
  expect(renderInline([{ type: "hardBreak" }], theme)).toBe("<br>");
  expect(
    renderInline([{ type: "text", text: "a\nb", styles: {} }], theme),
  ).toContain("<br>");
});

test("链接 type=link 递归 content 不丢文字", () => {
  const theme = getCardTheme("notion");
  const html = renderInline(
    [
      { type: "text", text: "见", styles: {} },
      {
        type: "link",
        href: "https://example.com",
        content: [
          { type: "text", text: "文档", styles: { bold: true } },
        ],
      },
    ],
    theme,
  );
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain("<strong>文档</strong>");
  expect(html).not.toMatch(/<a href="[^"]*"><\/a>/);
});

test("连续 bullet/numbered 合并为 ul/ol.bn-list", () => {
  const theme = getCardTheme("notion");
  const html = renderBlocks(
    [
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "一", styles: {} }],
      },
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "二", styles: {} }],
      },
      {
        type: "numberedListItem",
        content: [{ type: "text", text: "甲", styles: {} }],
      },
      {
        type: "numberedListItem",
        content: [{ type: "text", text: "乙", styles: {} }],
      },
    ],
    theme,
  );
  expect(html).toContain('<ul class="bn-list">');
  expect(html).toContain('<ol class="bn-list">');
  expect(html).toContain("<li");
  expect(html).toContain("一");
  expect(html).toContain("乙");
  // 不应出现「两个独立裸 li 无容器」——至少有成对的 ul/ol
  expect((html.match(/<ul class="bn-list">/g) || []).length).toBe(1);
  expect((html.match(/<ol class="bn-list">/g) || []).length).toBe(1);
});

test("表格 headerRows=0 时首行仍为 td；默认首行 th", () => {
  const theme = getCardTheme("notion");
  const makeTable = (headerRows: number | undefined) =>
    renderBlock(
      {
        type: "table",
        content: {
          type: "tableContent",
          ...(headerRows !== undefined ? { headerRows } : {}),
          rows: [
            {
              cells: [
                [{ type: "text", text: "A", styles: { bold: true } }],
                [{ type: "text", text: "B", styles: {} }],
              ],
            },
            {
              cells: [
                [{ type: "text", text: "1", styles: {} }],
                [
                  {
                    type: "link",
                    href: "https://x.test",
                    content: [{ type: "text", text: "链", styles: {} }],
                  },
                ],
              ],
            },
          ],
        },
      },
      theme,
    );

  const withHeader = makeTable(undefined);
  expect(withHeader).toContain("<th>");
  expect(withHeader).toContain("<strong>A</strong>");
  expect(withHeader).toContain('href="https://x.test"');
  expect(withHeader).toContain("链");

  const noHeader = makeTable(0);
  expect(noHeader).not.toContain("<th>");
  expect(noHeader).toContain("<td>");
});

test("图片 caption 输出 figure；非图片 file 输出 file-card", () => {
  const theme = getCardTheme("notion");
  const fig = renderBlock(
    {
      type: "image",
      props: { url: "https://example.com/a.png", caption: "说明图" },
    },
    theme,
  );
  expect(fig).toContain('class="export-figure"');
  expect(fig).toContain("<figcaption>说明图</figcaption>");

  const file = renderBlock(
    {
      type: "file",
      props: { url: "https://example.com/doc.pdf", name: "报告.pdf" },
    },
    theme,
  );
  expect(file).toContain('class="file-card"');
  expect(file).toContain("报告.pdf");
  expect(file).not.toContain("<img");
});

test("codeBlock 输出 code-block 壳与语言标签", () => {
  const theme = getCardTheme("notion");
  const html = renderBlock(
    {
      type: "codeBlock",
      props: { language: "typescript", wrap: true },
      content: [
        { type: "text", text: "const x = 1", styles: {} },
        { type: "hardBreak" },
        { type: "text", text: "const y = 2", styles: {} },
      ],
    },
    theme,
  );
  expect(html).toContain('class="code-block"');
  expect(html).toContain("code-lang");
  expect(html).toContain("typescript");
  expect(html).toContain("code-wrap");
  expect(html).toContain("const x = 1");
  expect(html).toContain("const y = 2");
});

test("isSelection 插入选中内容标签", () => {
  const theme = getCardTheme("notion");
  const html = buildStyledHTML({
    title: "t",
    blocksHtml: "<p>x</p>",
    theme,
    isSelection: true,
  });
  expect(html).toContain("gooseshot-selection-tag");
  expect(html).toContain("选中内容");
});

test("块级 backgroundColor / textColor 输出 style", () => {
  const theme = getCardTheme("notion");
  const html = renderBlock(
    {
      type: "paragraph",
      props: { backgroundColor: "yellow", textColor: "blue", textAlignment: "center" },
      content: [{ type: "text", text: "色块", styles: {} }],
    },
    theme,
  );
  expect(html).toContain("text-align:center");
  expect(html).toContain("background-color:");
  expect(html).toContain("color:");
});

test("主题字体与水印微调生效", () => {
  expect(getCardTheme("academic").titleFont).toContain("Noto Serif SC");
  expect(getCardTheme("academic").codeFont).toContain("JetBrains Mono");
  expect(getCardTheme("typewriter").bodyFont).toContain("Noto Serif SC");
  expect(getCardTheme("vercel-dark").watermark).toBe("#8b8b93");
  expect(getCardTheme("tokyo-night").watermark).toBe("#7a83b0");
  expect(getCardTheme("poster").watermark).toContain("0.45");
  expect(getCardTheme("synthwave").watermark).toContain("255,120,220");
  expect(getCardTheme("obsidian").secondaryText).toBe("#8b949e");
});
