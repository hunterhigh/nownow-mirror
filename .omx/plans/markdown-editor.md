# 观复 Markdown 编辑器实施计划

权威需求见 [`docs/editor-contract.md`](../../docs/editor-contract.md)。该能力为 P0，优先级高于继续增加视觉样式和侧栏功能。

## 第一纵向切片结果 · 2026-09-04

- 已建立 15 条 Markdown 转换／往返测试、4 条剪贴板／IME 测试和 1 条 mention ID 测试；配合原有测试共 45 条通过。
- Markdown clipboard 已接入正式 `DocEditor`；纯文本快捷粘贴走明确绕过路径。
- `.md` 导入采用预览后确认追加，不静默覆盖，可一次撤销。
- mention ID 生成抽成共享领域函数，导入、HTML、实时插入和旧文档修复统一规则。
- 东方字色／高亮已落入现有 BubbleMenu。
- 架构复核经过两轮阻断修复后批准；去冗余和最终回归通过。

后续继续执行第 2–6 节中尚未完成的共享扩展工厂、更多 input rules、完整导入策略、真实 IME 与长文验收；不得把本切片描述为整个 Markdown P0 已完成。

## 第二纵向切片结果 · 2026-09-04

- 第 2 节共享扩展工厂已完成：正式编辑器与转换器共用可携带 schema，UI／Suggestion 扩展继续只留在 DocEditor。
- 第 3 节完成第一组直接 input rules：任务、带类型 GFM Callout、高亮，并验证一次撤销。
- Callout 改为保留 kind，并实现 `> [!TYPE]` 解析／序列化；私密 Callout 使用观复注释标记保持隐私属性。
- 第 6 节自动长文基线完成：5 万字、200 块往返保持结构与全文，不修改源 JSON。
- 针对该切片的架构复核先因 Callout 类型丢失拒绝，修复 GFM 类型与私密往返后批准。
- 最终回归为 7 个测试文件、51 条测试通过；构建通过；lint 0 errors、8 个既有 warnings。

后续重点转向真实 macOS IME 人工验收、更多快捷输入边界、导入到新文档的产品策略和正式观复 UI。P0 总契约仍未全部完成。

## 第三纵向切片结果 · 2026-09-05

- 真实逐键浏览器验收发现任务与 Callout 标记分别被普通列表、普通引用规则提前截获；现已增加上下文转换规则，保留 checked 与 Callout kind。
- 自动输入矩阵覆盖 20 条剪贴板／输入规则／IME 边界，含逐字符任务、逐字符 Callout、六类标准块语法及单步 input-rule 恢复。
- Slash 与成员建议统一使用 composition 守卫，并在 768 宽度下验证合成期间不弹菜单、结束后恢复。
- 正式 `DocEditor` 在 1440×900 和 768×800 的 Chromium 中完成任务、Callout、高亮、Slash 键盘流与成员建议验收；无运行时控制台错误。
- 最终回归为 7 个测试文件、64 条测试通过；构建通过；lint 0 errors、8 个既有 warnings。

后续仍需真人执行 macOS 拼音／双拼／五笔检查。Markdown 导入策略已由用户确认为默认新建、追加次选。

## 第四纵向切片结果 · 2026-09-05

- 导入预览改为三操作：取消、追加到当前、新建文档；新建是默认焦点与主按钮，支持 Enter／Space，Escape 取消。
- 新增纯领域适配器处理文件名、重名顺延、创建顺序和韧性保存；现阶段使用当前入口的 `doc_tag` 作为具名文档槽，不改数据库 schema。
- Board 将创建能力沿 `DocTimeline → DocBlock → DocEditor` 注入；编辑器只依赖回调，不绑定 Supabase 或标签实现。
- 浏览器验证新建、追加、一次撤销和失败四条路径；新建不改变当前文档，错误在对话框内部以 `alert` 呈现。
- 最终回归为 8 个测试文件、71 条测试通过；构建通过；lint 0 errors、2 个既有 warnings。

后续若引入真正的独立 document entity，只替换 `createMarkdownDocument` 的持久化适配与工作区导航，不改变 Markdown 解析及编辑器对话框协议。

## 第五纵向切片结果 · 2026-09-06

- 将 `DocEditor` 内联的 15 个 Slash 项提取到独立注册表，菜单顺序、名称、关键词、日期冻结、隐私和 picker 行为保持不变。
- 新增 22 条 Slash 注册表测试：12 类语义节点、日期戳、图片／导入 picker、搜索、隐私开关、异步焦点和单步撤销。
- deslop 后全量回归为 9 个测试文件、93 条测试通过；构建通过；lint 0 errors、2 个既有 warnings。

下一切片继续验证 HTML／Markdown／纯文本／图片粘贴四路与嵌套列表，不将本切片单独描述为编辑器 P0 已完成。

## 现状判断

保留现有 Tiptap、`doc_json`、Slash、离线保存、版本历史和隐私架构。Markdown 扩展、新建／追加导入、剪贴板与自动长文基线已经接入；当前主要缺口是真实 macOS 中文 IME 人工验收、独立文档长期数据模型和完整观复 UI。

## 实施切片

### 1. 建立 Markdown fixture 与保真基线

- 为标准 Markdown 与观复扩展建立 Markdown、期望 Tiptap JSON、期望导出文本 fixture。
- 覆盖标题、行内 marks、嵌套列表、任务、引用、代码、表格、链接、图片、Callout、日期戳、颜色和私密块。
- 测试 `Markdown → JSON`、`JSON → Markdown` 及双向语义等价。
- 先记录当前失败，不在同一提交中掩盖格式损失。

通过条件：契约中的所有语法有 fixture；已知不保真项有明确失败测试和转换决策。

### 2. 统一编辑器与转换器扩展集

- 提取共享 extension factory，避免 `DocEditor.jsx` 与 `markdown.js` 节点能力漂移。
- 明确标准 Markdown 和观复扩展的解析／序列化规则。
- 保持 `doc_json` 真源、程序事务 `addToHistory:false` 和现有隐私投影不变。

通过条件：编辑器创建与 headless 转换器使用同一份扩展契约；现有数据安全测试通过。

### 3. 完成语义化 Markdown 输入

- 审计并补齐 StarterKit input rules；实现任务、高亮、围栏代码、Callout 等缺口。
- Slash 只执行节点／mark 命令，补齐搜索、键盘、焦点、单次 Undo 和 IME composition guard。
- 选区 BubbleMenu 支持观复东方字色，同时满足主题对比度。

通过条件：直接语法、Slash 和工具条对同一内容产生相同节点；所有命令可一次撤销。

### 4. Markdown 粘贴与导入

- 增加“粘贴为 Markdown”命令及多行解析，保留现有 HTML、纯文本与图片粘贴路径。
- 恢复 `.md` 导入 UI，提供预览、追加／新建策略、图片和冲突提示。
- 禁止导入静默覆盖当前内容；导入也走本地草稿保护。

通过条件：四类粘贴互不串路；导入失败可恢复且不改原文档。

### 5. 导出与可携带性

- 单文档／全部文档导出使用同一序列化器。
- 实现 Callout、颜色、下划线、日期戳、成员和私密块规则。
- 用导出文件重新导入，验证标准内容语义等价及扩展内容的约定降级。

通过条件：fixture 往返测试通过；公开导出不含私密内容。

### 6. 中文 IME、长文与可靠保存验收

- 建立组合输入、列表编辑、Slash、选区、撤销、粘贴的浏览器测试矩阵。
- 建立 5 万字／200 块长文基准，记录 long task、保存频率和输入响应。
- 联合验证离线草稿、冲突重试、刷新恢复、版本历史与编辑器 Undo。

通过条件：无丢字／重字／光标跳动；现有 27 条测试及新增编辑器测试全部通过；lint 不新增警告；构建通过。

### 7. 观复视觉整合

- 在功能契约通过后再落地明体／宋体、东方字色、背景主题和固定 Logo 印色映射。
- 删除顶部“插入”，日／周／月与显示保留在桌面工具栏；内容类型由 Markdown 快捷输入、Slash 和选区工具完成。

通过条件：视觉改造不改变序列化结果、光标、输入法和键盘行为。

## 主要风险

- `tiptap-markdown` 与 Tiptap 3 的扩展兼容或序列化边界不完整：先用 fixture 验证，再决定补 serializer 还是替换库。
- 自定义节点无法无损表示为标准 Markdown：采用可读扩展语法，并定义不支持消费者的降级行为。
- IME 与 Suggestion／input rule 竞争：composition 期间禁止触发转换，浏览器与人工双重验收。
- 导入或转换触发自动保存覆盖：所有程序性 setContent／迁移事务标记 `addToHistory:false`，并复用本地草稿保护。

## 验证命令

```bash
npm test
npm run lint
npm run build
```

此外必须完成真实浏览器的中文 IME、Markdown 粘贴／导入、导出再导入和长文测试；仅构建成功不算完成。
