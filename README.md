# 鹅的笔记

原生 macOS Markdown 编辑器。AppKit 负责窗口、菜单、本地文件和系统能力，单一 WKWebView 承载 BlockNote 编辑器。

## 当前核心

- 直接新建、打开和编辑本地 `.md`、`.markdown` 文件
- 打开本地文件夹，递归浏览其中的 Markdown 文件并默认选中第一篇
- BlockNote 块编辑器与修订确认式自动保存
- 不可无损转换的 Markdown 自动使用源码保护模式，未编辑时绝不重写原文件
- 多文件标签、文件夹内搜索和即时切换编辑
- 系统文件面板、菜单、快捷键和 Finder 定位
- 注册为 Markdown 编辑器，支持从 Finder 使用本应用打开
- 可在“鹅的笔记 → 设置”中通过系统确认设为 Markdown 默认应用
- 不创建正文数据库、笔记库 JSON 或隐藏内容副本

## 开发

1. 安装依赖：`bun install`
2. 生成设计令牌、内嵌编辑器和 Xcode 工程：`bun run project`
3. 构建原生应用：`bun run build:native`
4. 快速打包通用版应用与 ZIP：`bun run package:mac`

`GooseNotes.xcodeproj`、`GooseNotes/Resources/Web` 和生成的 Swift、CSS 设计令牌均由上述命令重建，不纳入版本控制。

浏览器验收使用 `bun run dev`，打开 `http://127.0.0.1:6001/harness.html`。该页面只提供开发替身，不是生产存储后端。

打包结果位于 `output/GooseNotes.app` 和 `output/GooseNotes-macOS-universal.zip`。脚本会构建 `arm64 + x86_64` 通用二进制并执行签名、架构和 Markdown 文档类型检查。

## 验证

- `bun run check`
- `bun run test:e2e`
- `bun run test:native`
- `bun run audit:boundaries`

## 技术组成

- AppKit 与 WebKit 提供原生应用外壳和本地编辑器容器。
- BlockNote 提供块编辑能力，仅运行在应用内的单一 WKWebView 中。
- 第三方组件及其许可统一记录在 `THIRD_PARTY_NOTICES.md`。

## 许可

MIT。第三方声明见 `THIRD_PARTY_NOTICES.md`。
