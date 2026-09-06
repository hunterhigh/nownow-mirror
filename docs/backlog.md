# 观复开发 Backlog

更新日期：2026-09-06。范围依据 [`guanfu-master-development-plan.md`](../.omx/plans/guanfu-master-development-plan.md)。状态采用 `Idea → Ready → Doing → Review → User Check → Done`；候选池内容不自动进入本表。

## 路线状态

| ID | 切片 | 状态 | 进入条件／当前说明 |
| --- | --- | --- | --- |
| S0 | 稳定开发基线 | Done | 回退架构复审批准；deslop 与 Node 24.15.0 最终回归通过；低空间风险由用户明确接受 |
| S1 | 编辑器 P0 封板 | Doing | S1.1–S1.3 已完成；剩余正式登录隔离环境、真实 Storage 与真人 macOS IME 验收 |
| S2 | 个人工作信息架构定稿 | Idea | S0 Done；编辑器契约和核心闭环可演示 |
| S3 | 隔离环境与数据模型 ADR | Idea | S2 信息架构确认；用户单独授权隔离环境 |
| S4 | 观复视觉基础 | Idea | S2 信息层级确认；先做 4 套完整主题再扩展 |
| S5 | 工作区壳与周期文档 | Idea | S2、S3、S4 的相关契约通过 |
| S6 | 具名文档与元 | Idea | S3 数据 ADR 与迁移演练通过 |
| S7 | 任务语义与派生索引 | Idea | S3 数据 ADR 通过；任务最小状态由用户确认 |
| S8 | 个人行动闭环 | Idea | S5、S7 通过 |
| S9 | 搜索、历史、导出与恢复 | Idea | S6、S8 通过 |
| S10 | 性能、无障碍与全矩阵 QA | Idea | S1–S9 功能切片均达到 Review |
| S11 | 私有试用与发布准备 | Idea | S10 通过；用户单独批准发布目标 |
| S12 | 小团队增强 | Idea | 不属于个人首版；S11 稳定后重新确认范围 |

## S0 完成记录

- ID／标题：S0／稳定开发基线
- 状态／负责人：Done／Codex；用户已批准继续进入 S1
- 用户场景与价值：让后续每个编辑器、UI 和数据切片都建立在可重复、可恢复、不会误连原项目的开发环境上。
- 本次包含：审阅当前工作树；记录已有成果边界；刷新测试／lint／构建基线；固定 Node 24.15.0；建立 backlog；核对磁盘。
- 明确不做：业务功能、UI 重构、依赖升级、数据库连接／迁移、提交、推送、部署。
验收条件：

- 工作卷空间与 `ENOSPC` 风险已记录；用户明确选择继续，只有实际写入失败才阻断。
- 使用 Node 24.15.0 执行 `npm ci --ignore-scripts --no-audit --no-fund` 成功。
- `npm test` 不少于 8 个文件／71 条测试且 0 失败。
- `npm run lint` 为 0 errors，warning 不超过当前 2 条并逐项记录。
- `npm run build` 成功，包体警告与实际体积单独记录。
- `git diff --check` 通过；工作树中的现有源码、文档和测试变更均被归类，没有密钥、真实数据或意外迁移文件。

- 受影响文件：`.nvmrc`、`docs/backlog.md`、`docs/baseline.md`、`docs/README.md`、`.omx/context/` 与 Ralph 状态。
- 数据与权限影响：无；不访问 Supabase，不执行 SQL。
验证命令：

```bash
npx --yes --package=node@24.15.0 -c 'node --version && npm --version && npm ci --ignore-scripts --no-audit --no-fund && npm test && npm run lint && npm run build'
git diff --check
df -k /System/Volumes/Data
git status --short --branch
```

- 说明：上述第一条命令把 Node 24.15.0 放到临时 PATH 首位，npm 及所有 npm scripts 都使用该版本；无需依赖本机安装 nvm，也不会替换系统 Node。
- 风险／回滚：`.nvmrc`、backlog 和基线均可删除／恢复；磁盘清理只能由用户确认具体目标，Codex 不删除用户文件。
- 证据／未验证：回退架构复审 APPROVED；`ai-slop-cleaner` 仅合并重复磁盘叙述并补充历史快照覆盖说明；Node 24.15.0 最终回归为 71/71 测试、lint 0 errors／2 warnings、构建和 diff check 通过。当前约 4.4 GiB，用户拒绝继续清理并明确接受风险；完整输出见 [`docs/evidence/s0-verification-2026-09-06.md`](evidence/s0-verification-2026-09-06.md)。

## 当前任务卡

- ID／标题：S1.1／Slash 命令注册表与逐项回归
- 状态／负责人：Done／Codex
- 用户场景与价值：在任意正文位置用 `/` 搜索并执行内容命令，得到真实语义节点，可继续编辑并能一次撤销。
- 本次包含：抽离 15 个正式菜单项；保持顺序、名称和搜索词；验证语义、焦点、触发文字、picker 与 Undo。
- 明确不做：新增 Slash 项、视觉重做、真人 IME、数据模型、迁移或部署。
- 验收条件：15 个菜单项均有自动测试；隐私开关不改变其余顺序；语义项生成预期节点；picker 项打开回调；全部聚焦并可一次 Undo；全量测试、lint、build 和 diff check 通过。
- 受影响文件：`src/components/DocEditor.jsx`、`src/components/SlashCommandItems.js`、`test/slashCommands.test.js`、编辑器契约与计划。
- 数据与权限影响：无；不访问 Supabase，不更改 `doc_json` schema。
- 验证证据：回退架构复审 APPROVED；deslop 后目标测试 22/22；全量 9 文件／93 测试；lint 0 errors／2 warnings；构建通过，主 JS gzip 476.56 kB。
- 未验证：真实浏览器仍沿用此前 Slash 键盘流证据；本切片没有改变菜单渲染与键盘处理。

### S1.2／粘贴四路与嵌套结构

- 状态／负责人：Done／Codex
- 用户场景与价值：从网页、Markdown、纯文本或图片粘贴时得到预期内容，不串路、不扁平化嵌套任务。
- 本次包含：HTML 优先；Markdown 语义 paste；显式纯文本；图片路由；嵌套任务往返与 sink／lift。
- 明确不做：真实 Storage、正式账号刷新／离线、真人 IME、数据模型或视觉重构。
- 验收条件：四类路由互斥；图片绕过条件完整；三层任务结构与 checked 往返；浏览器主路径和错误控制台检查；全量测试、lint、build、diff check。
- 数据与权限影响：无；图片浏览器测试使用本地网络拦截，不连接真实 Supabase。
- 验证证据：回退架构审查 APPROVED；deslop 后目标自动测试 43/43；全量 9 文件／102 测试；lint 0 errors／2 warnings；构建与扩展空白检查通过；Chromium 五条路径通过且 console 0 errors。
- 未验证：真实 Storage 持久化等待隔离环境；正式登录应用的刷新／离线属于下一切片。

### S1.3／离线恢复与导出再导入

- 状态／负责人：Done／Codex
- 用户场景与价值：断网编辑并刷新后仍能看到草稿，恢复联网后安全同步；导出的 Markdown 可以重新解析而不丢正文语义。
- 本次包含：聚合导出构建器；任务／Callout／高亮再导入；离线模块重载与联网重放；程序性加载 Undo；正式 DocBlock 浏览器恢复。
- 明确不做：真实登录、真实 Supabase／Storage、可恢复多文档边界的完整备份包、数据迁移。
- 验收条件：草稿带原版本；重载恢复；联网按原版本保存并清草稿；聚合导出不修改源 JSON且可重解析；程序加载不污染 Undo；浏览器恢复无控制台错误。
- 数据与权限影响：无 schema 变化；浏览器 REST 请求全部本地拦截。
- 验证证据：回退架构审查 APPROVED；deslop 后目标 3 文件／46 测试；全量 10 文件／107 测试；lint 0 errors／2 warnings；构建与扩展空白检查通过；DocBlock 浏览器刷新／重放步骤见 [`docs/evidence/s1.3-browser-recovery-2026-09-06.md`](evidence/s1.3-browser-recovery-2026-09-06.md)。
- 未验证：正式登录及真实后端等待隔离环境；真人 macOS IME 需要人工执行。
