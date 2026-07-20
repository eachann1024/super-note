# 产品边界

- 这是原生 macOS Markdown 编辑器，不是 uTools 插件、Tauri 应用、Electron 应用或浏览器产品。
- AppKit 负责应用生命周期、窗口、菜单、侧边栏、搜索、标签页、文件面板和 Markdown 文件读写。
- 单一 WKWebView 只负责 BlockNote 编辑器、选区、输入法组合和编辑器内浮层。
- 用户选择的本地 Markdown 文件是正文的唯一事实来源。应用不得创建正文数据库、笔记库 JSON 或隐藏副本。
- BlockNote 数据只存在于当前编辑器进程中。可无损往返的内容转换为 Markdown 保存；无法无损往返的内容必须使用源码模式原样编辑。
- 未发生编辑时不得用编辑器转换结果写回文件。
- 应用只打开和创建 `.md`、`.markdown` 文件。文件访问必须通过系统打开方式或文件面板取得。
- 不加入 AI、MCP、速记小窗、WebDAV、Quick Look、Sparkle、Amore、外部 LLM、浏览器后端或多宿主兼容分支。
- 新功能必须先判断属于原生壳、编辑器或桥接协议，再落到对应目录。

# 桥接规则

- 所有 Swift 与 JavaScript 消息必须带协议版本、请求 ID、页面 ID 和修订号。
- 只接受白名单命令。禁止向 WebView 暴露通用文件系统、任意脚本执行或网络凭据。
- 切页、失焦、关闭窗口和退出前必须刷新当前草稿。
- 原生层只接受与当前文件和当前修订匹配的编辑事件。过期事件必须返回冲突结果。
- 保存状态必须区分正在保存、已保存和保存失败，并向辅助技术播报。

# 设计规则

- 设计令牌的唯一来源是 `Design/tokens.json`。
- 修改令牌后运行 `bun run tokens`，不得手工改生成的 Swift 或 CSS 文件。
- 保持克制的暖中性色、白色编辑纸面和少量珊瑚色动作反馈。
- 所有交互必须覆盖默认、悬停、聚焦、按下、选中、禁用、加载和错误状态。
- 保留系统焦点环、系统文本服务、右键菜单、VoiceOver 和减少动态支持。
- 界面文案使用大陆简体中文。

# 验证

- 修改 Web 编辑器后运行 `bun run check:web` 和 `bun run test:e2e`。
- 修改 Swift 或桥接后运行 `bun run build:native` 和 `bun run test:native`。
- 修改边界、依赖或构建配置后运行 `bun run audit:boundaries`。
- UI 变更必须完成浏览器验收，并运行真实 macOS 应用核对窗口、菜单、沙盒和 WKWebView。
