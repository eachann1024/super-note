# 鹅的笔记

原生 macOS 笔记本。AppKit 负责窗口、菜单、侧边栏、数据和系统能力，单一 WKWebView 承载 BlockNote 编辑器。

## 当前核心

- 多笔记本与层级页面树
- VS Code 风格预览标签与固定标签
- 收藏、回收站和本地全文搜索
- BlockNote 块编辑器与修订确认式自动保存
- 系统外观、菜单、快捷键、导入与导出
- 沙盒内本地存储和恢复副本

## 开发

1. 安装依赖：`bun install`
2. 生成设计令牌、内嵌编辑器和 Xcode 工程：`bun run project`
3. 构建原生应用：`bun run build:native`

`GooseNotes.xcodeproj`、`GooseNotes/Resources/Web` 和生成的 Swift、CSS 设计令牌均由上述命令重建，不纳入版本控制。

浏览器验收使用 `bun run dev`，打开 `http://127.0.0.1:6001/harness.html`。该页面只提供开发替身，不是生产存储后端。

## 验证

- `bun run check`
- `bun run test:e2e`
- `bun run test:native`
- `bun run audit:boundaries`

## 架构来源

原生架构参考并合并了 [pluk-inc/markdown-preview](https://github.com/pluk-inc/markdown-preview) 的 MIT 许可历史。编辑器风格参考 [eachann1024/goose-note-tauri](https://github.com/eachann1024/goose-note-tauri)，未引入 Tauri 或 Rust 运行时。

## 许可

MIT。上游声明见 `THIRD_PARTY_NOTICES.md`。
