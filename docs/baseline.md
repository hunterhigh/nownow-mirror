# 代码与环境基线

初始核验日期：2026-09-04（Asia/Shanghai）。这是本地源码与检查结果的快照，不是线上环境审计。

## 当前开发快照 · 2026-09-06

- 分支仍为 `codex/workstation-init`。2026-09-06 16:10 CST，本执行流程之外出现本地提交 `d602c45`（作者为仓库用户，主题为 `Refactor editor extensions and add Markdown import support`），收录 S0 与 S1.1 之前的工作；`origin/main` 仍停在 `29fd692`，没有发现推送。S1.2 改动仍在未提交工作树中。
- S0 功能基线为 8 个测试文件、71 条测试。2026-09-06 使用项目级 Node 24.15.0 执行干净安装与全量验证：`npm ci --ignore-scripts --no-audit --no-fund` 安装 362 个依赖；71/71 测试通过；lint 0 errors／2 warnings；生产构建通过，主 JS 1,517.34 kB、gzip 476.47 kB，并保留超过 500 kB 的既有 chunk warning。
- S1 第一个代码切片加入 Slash 注册表矩阵后，deslop 最终回归为 9 个测试文件、93 条测试；lint 仍为 0 errors／2 warnings；主 JS gzip 476.56 kB。
- S1 第二个代码切片完成四类粘贴与嵌套任务后，当前为 9 个测试文件、102 条测试；lint 仍为 0 errors／2 warnings；主 JS gzip 476.66 kB。
- S1 第三个代码切片加入导出再导入与离线刷新闭环后，当前为 10 个测试文件、107 条测试；lint 仍为 0 errors／2 warnings；主 JS gzip 476.69 kB。
- 新增 `.nvmrc` 固定 Node `24.15.0`，因为系统 Node `24.13.0` 低于 jsdom 在 Node 24 线声明的最低 `24.15.0`。本轮使用独立下载的 Node 24.15.0 可执行文件直接启动 npm、Vitest、ESLint 与 Vite，没有改动系统 Node。
- 磁盘曾在约 1.7 GiB 时触发 Vitest `ENOSPC`。用户分两次授权删除共 12 个可重建缓存；空间仍因工作区外占用在约 2.2–10 GiB 间波动，第二次删除后约 4.4 GiB。用户明确拒绝继续删除 Google 或其他缓存并要求进入开发，因此低空间只保留警告，实际发生 `ENOSPC` 时再停止。
- 当前没有 `.env.local`、隔离 Supabase 或目标发布环境；没有执行数据库迁移、种子、备份、远程 schema preflight 或真实数据访问。
- S0 回退架构复审 APPROVED；deslop 后在 Node 24.15.0 再次验证 71/71 测试、lint 0 errors／2 warnings、构建和 `git diff --check` 通过。验证后空间约 4.4 GiB，未出现 `ENOSPC`。

### 当前工作树分类

| 类别 | 文件范围 | 结论 |
| --- | --- | --- |
| 项目流程 | `AGENTS.md`、`docs/`、`.omx/plans/`、`.gitignore`、`.nvmrc`、根 `README.md` | 观复约定、产品／设计／编辑器契约、主计划、backlog 与环境固定文件 |
| 编辑器与导入 | `src/components/Callout.js`、`DocEditor.jsx`、`SlashCommand.js`、`MarkdownInputRules.js`、`src/lib/markdown*.js`、`editor*.js`、`mentionIds.js` | 四个已记录的 Markdown P0 开发切片；保留为待审阅成果 |
| 接线改动 | `src/Board.jsx`、`DocBlock.jsx`、`DocTimeline.jsx`、`SettingsModal.jsx` | 将 Markdown 新建／追加导入接入现有 NowNow 模块，并更新观复导出名称 |
| 回归测试 | `test/markdown*.test.js`、`test/mentionIds.test.js` | Markdown 往返、输入、导入、性能与 mention ID 共 71 条全量基线的一部分 |
| 受保护且未改 | `package.json`、`package-lock.json`、`public/`、`scripts/`、`supabase/` | 没有依赖升级、部署脚本、worker 或 migration 差异 |

对上述差异执行凭据模式扫描，只命中 `AGENTS.md` 中“不得写入 service-role key／数据库密码”的禁止性说明；未发现凭据值、真实用户数据或连接字符串。

### 磁盘清理记录

用户明确授权后，2026-09-06 删除以下五个可重建缓存；对应工具或应用可能按需重新下载：

- `~/.npm/_npx`：约 1.0 GiB。
- `~/.cache/puppeteer`：约 1.0 GiB。
- `~/Library/Caches/com.microsoft.VSCode.ShipIt`：约 1.5 GiB。
- `~/Library/Caches/LarkShell`：约 1.8 GiB。
- `~/Library/Caches/Homebrew`：约 840 MiB。

删除后逐项确认路径不存在。项目级 Node 验证重新生成了 `~/.npm/_npx` 中的 Node 24.15.0 临时运行时；一次版本探测误生成的 Node 26.8.1 缓存已单独删除。不建议为本任务清理 `~/Library/Caches/com.openai.codex`，以免影响当前 Codex 运行；其他用户目录不在既有授权范围。

固定版本的可复制命令与完整输出见 [`docs/evidence/s0-verification-2026-09-06.md`](evidence/s0-verification-2026-09-06.md)。

当前快照的进行中任务与验收证据见 [`docs/backlog.md`](backlog.md)；以下内容保留为 2026-09-04 的初始克隆基线。

## 来源与初始化范围

| 项目 | 核验结果 |
| --- | --- |
| 用户镜像 | `hunterhigh/nownow-mirror`，私有仓库，GitHub 元数据 `isFork=false` |
| 镜像来源说明 | GitHub 仓库描述为 `Openhaitao/NowNow` 的个人非商业开发镜像；本轮未独立核验上游同步关系或授权范围 |
| 本地目录 | `/Users/raozhiheng/Desktop/main/workstation`；克隆前为空目录 |
| 基础分支／提交 | `origin/main` · `29fd692365850f690fe5c86efd4abcd3f86dac9e` |
| 提交说明／日期 | `Harden custom avatars after review; guard the deploy order` · 2026-08-10 |
| 本地工作分支 | `codex/workstation-init`，保留原有 `main` 与 Git 历史 |
| 业务与依赖声明 | 本轮未修改 `src/`、`public/`、`scripts/`、`supabase/`、`package.json` 或锁文件 |
| 本轮变更 | 新增工作文档与 `AGENTS.md`，原 README 增加定制入口，忽略本地流程运行记录 |
| 远程操作 | 仅读取 GitHub 元数据和克隆；没有提交、推送、PR、云资源创建或部署 |

## 已有能力与扩展位置

以下来自本次源码静态核验，不代表已在真实后端逐项体验。

| 能力／边界 | 当前实现 | 代码证据 |
| --- | --- | --- |
| 技术栈 | React 18、Vite、Tiptap 3、Tailwind 4、Supabase；沿用 JS 工程 | [package.json](../package.json)，第 18–58 行 |
| 页面与导航 | `Board` 管理我的目标、成员、通知、反馈、设置；文档按今日／本周／本月／收集箱组织 | [Board.jsx](../src/Board.jsx)，第 972、1157、1230 行 |
| 编辑器待办 | Tiptap `TaskList/TaskItem`，作为整篇文档 JSON 保存，并非已存在的独立个人任务记录 | [DocEditor.jsx](../src/components/DocEditor.jsx)，第 164 行；[docsApi.js](../src/lib/docsApi.js)，第 100 行 |
| 收集箱 | 无时间线的文档区，不等同于通知列表或独立任务池 | [DocTimeline.jsx](../src/components/DocTimeline.jsx)，第 113 行 |
| @ 协作 | `doc_mentions` 的已读／忽略／完成及完成知会，与编辑器待办生命周期不同 | [NotificationsPage.jsx](../src/components/NotificationsPage.jsx)，第 80 行；[docMentionsApi.js](../src/lib/docMentionsApi.js)，第 72 行 |
| 内容搬移 | 已有搬到今天的接口，但不能直接等同于任务改期；含 @ 的搬移有通知副作用 | [docsApi.js](../src/lib/docsApi.js)，第 192 行 |
| 标签范围 | 当前按 owner 与 section 隔离，不自动构成跨时间区的项目分类 | [tagsApi.js](../src/lib/tagsApi.js)，第 56 行 |
| 历史旧模型 | `entries/mentions` 旧查询已停用，不能把旧收件箱当当前任务系统复用 | [Board.jsx](../src/Board.jsx)，第 271、833 行 |
| 保存保护 | 存在本地草稿、重试、冲突前置条件等回归测试 | [resilientDocs.test.js](../test/resilientDocs.test.js)，第 42 行起 |
| 隐私边界 | 文档公开投影、读取视图和权限需要共同保留 | [ARCHITECTURE.md](../ARCHITECTURE.md)，第 22 行起；[migration-020](../supabase/migration-020-doc-privacy.sql)，第 1 行起 |

优先讨论的扩展面：个人主入口、任务与笔记关系、收集到安排的操作路径、跨区分类、通知是否能显式转为任务。以上是讨论入口，不是已批准的实施方案。

## 已执行的本地检查

运行环境：Node `v24.13.0`，npm `11.6.2`。本轮没有升级全局运行时。

| 命令／检查 | 结果 | 限制／后续 |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 成功安装 362 个包 | 按锁文件安装，未执行依赖生命周期脚本；未做依赖安全审计 |
| `npm test` | 3 个测试文件、27 个测试全部通过 | 仅仓库现有测试，不代表 UI、数据库或权限已端到端验证 |
| `npm run lint` | 退出码 0；0 errors、8 warnings | 原有 React Hooks 依赖警告，未在初始化时修改 |
| `npm run build` | 成功；本次实际 Vite 版本 `6.4.3` | JS 主包 1,507.31 kB，gzip 474.06 kB，有超过 500 kB 的 chunk 警告 |
| `git diff --check` | 通过 | 用于检查已跟踪差异的空白问题；新增文档另查链接与文件存在性 |
| 业务／锁文件差异检查 | 无差异 | `git diff --exit-code -- package.json package-lock.json src public scripts supabase` 通过 |

安装时的运行时警告：`jsdom@30.0.1` 声明 Node `^22.22.2 || ^24.15.0 || >=26.0.0`，当前 `24.13.0` 不在支持范围。虽然本次测试与构建通过，仍应在技术准备阶段选定兼容版本并重新验证、固定团队运行时；本轮不将当前版本标为长期支持基线。

lint 警告分布：`src/Board.jsx:195` 六处 memo／effect／callback 依赖提示，`src/components/DocBlock.jsx:52` 一处 ref 清理提示，`src/components/FeedbackPage.jsx:51` 一处 effect 依赖提示。后续只在涉及相应代码时有针对性处理，不通过禁用规则消除提示。

## 尚未完成的运行环境

- 没有创建 `.env.local` 或填入 Supabase 凭据。
- 没有启动应用做浏览器验收，也没有验证登录、存储、通知或实时连接。
- `src/lib/supabase.js:6` 在缺少 URL／anon key 时直接阻止加载，因此“构建成功”不代表现在已有可用的业务界面。
- 后续需讨论采用独立开发数据库还是先做隔离的样例数据 UI 原型；不默认使用原项目数据库。
- 没有执行迁移、种子、备份、部署或远程 schema preflight。

## 开发前必须处理的边界

### 1. 原项目云配置仍然存在

`.env.example:2` 含原项目 Supabase 地址；`scripts/deploy-production.sh:4` 起默认指向原项目 Pages 与 Supabase；`scripts/deploy-staging.sh:4` 含原 staging 名称；`public/_worker.js:4` 与第 34 行保留原项目后端及域名逻辑。本轮保留这些文件以保持镜像基线，不能直接拿它们部署定制版。

接入前需记录并核对独立 Supabase、Pages、代理 origin、认证跳转、存储和发布目标；只在确认的隔离环境中使用测试账号。

### 2. 数据库说明与源码版本不同步

原 README 的 Run locally 只列到 migration-027，`ARCHITECTURE.md:118` 列到 032，而仓库实际已有 [migration-036](../supabase/migration-036-custom-avatar.sql)。此外 architecture 中关于 migration-020 的 STEP 2 仍被注释的叙述，已与当前 SQL 文件第 45 行之后不符。

不能简单根据 README 或编号批量执行：migration-010 包含删除旧模型，migration-020 涉及分阶段隐私切换，现有库还可能有仓库之外的状态。后续需区分全新空库与已有库，审阅完整执行清单，在隔离库验证并记录迁移状态；本轮未声称任何数据库已经准备好。

### 3. 公开／分发边界未确认

本次仓库文件扫描未发现独立的 LICENSE 文件。仓库描述中的“个人非商业开发”仅作为来源信息记录；若以后要公开或分发，需先确认上游许可与授权。本轮只做私有本地开发准备，不调整许可或品牌。
