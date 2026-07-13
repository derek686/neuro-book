# Agent Chat Flow Snapshot 分页与有界投影

## Relative documents refs

- [Agent SSE Front-End Contract](../14-agent-sse-front-end-contract/README.md)
- [Agent Session Management](../15-agent-session-management/README.md)
- [Agent Session Tree UI](../49-agent-session-tree-ui/README.md)
- [Harness Contract / SSE Recovery](../62-harness-contract-sse-recovery-fixes/README.md)
- [Agent Session List Performance Pagination](../73-agent-session-list-performance-pagination/README.md)
- [Agent Command Performance](../74-agent-command-performance/README.md)
- [GitHub Issue #6](https://github.com/notnotype/neuro-book/issues/6)
- [参考 PR #7](https://github.com/notnotype/neuro-book/pull/7)

## User Request / Topic

- 长对话 session 的 append-only JSONL 可能膨胀到数 MB；当前 `GET /api/agent/sessions/:id` 构建并返回全量 snapshot，在服务端部署和弱网络环境下打开会话很慢。
- 保留原有 `GET /api/agent/sessions/:id` 作为 Agent Chat Flow 的唯一 session 查询入口，使它同时支持首屏恢复和 active path 向前分页；不为 entries、tree、context usage 拆出零散 GET 端点。
- 首屏默认只加载最近一段聊天历史；用户在 `AgentChatFlow.vue` 向上滚动接近顶部时，继续查询并前置更早历史。
- PR #7 只作为实现与测试参考，不直接合并，也不从其分支继续堆提交。
- 本任务只处理 Agent Chat Flow、session snapshot、历史分页和与之直接相关的返回体边界。

## Goal

让长 session 的首屏响应和历史翻页都具有可验证的规模上界，并保持 append-only session tree、active path 分支切换、SSE snapshot recovery 和 Chat Flow 消息投影正确：

- 首屏 snapshot 只返回最近一页 Chat Flow history，但仍包含恢复 SSE 和渲染当前 Agent 状态所需的 session shell。
- 历史页继续使用同一 GET 路由，只返回分页历史和 cursor/revision 元数据，不重复构建或传输昂贵 shell。
- 分页同时受 entry 数量与 UTF-8 字节预算约束，不能因单个巨大 tool result 失去上界。
- 分页边界保留 Chat Flow 的 assistant/tool result 关联，不产生孤立工具结果、重复消息或遗漏消息。
- JSONL、模型上下文和 append-only session tree 仍保存完整真相；有界化只发生在公开 Chat Flow DTO 投影层。
- 以真实 session 样本、repository/API 测试、前端 reducer 测试和 payload bytes 对比证明改进，同时保持 Task 14/62 的 SSE 恢复合同不回退。

若无法在不改变产品语义的前提下给公开 payload 建立上界，先报告具体 entry 类型、大小分布和用户可见影响，由用户拍板；禁止使用 offset、静默 cursor 回退、前端切字符串或任意丢弃历史等 hack。

## Diagnosis / Evidence

### 当前调用链

```text
AgentChatSurface / useAgentSessionStream
    -> useAgentSessionApi.getSession()
        -> GET /api/agent/sessions/:id
            -> server/agent/http.getAgentSessionSnapshot()
                -> NeuroAgentHarness.getSessionSnapshot()
                    -> buildSessionSnapshot()
                        -> JsonlSessionRepository.readSession()
                        -> reduce() / activePath() / tree()
                        -> snapshotSystemPrompt()
                        -> sessionContextUsage()
                        -> sessionRelations()
```

- `JsonlSessionRepository` 是 append-only JSONL 真相源；`activePath()` 从当前 leaf 沿 parentId 回溯。
- `activePathRevision()` 已有稳定语义：只在显式 move leaf 时变化，普通尾部 append 不变化。分页应复用它，不新增第二套 revision。
- `useAgentSession.applySnapshot()` 用 `entries` 投影聊天气泡；`tree` 用于 Session Tree Dialog 和消息气泡分支切换。
- `messages` 是 `repo.reduce()` 得到的 provider context，当前前端没有直接消费者，不应继续作为公开 snapshot 的第二份历史。
- `retry/tree` command 和 `POST /tree` 也可能返回 `buildSessionSnapshot()` 生成的完整 snapshot；只优化 GET 会留下相同的大响应回归入口。

### 真实 session 只读抽样（2026-07-13）

抽样来源：当前 Workspace Root `workspace/.nbook/agent/sessions/*.jsonl`。字节数为 UTF-8 `JSON.stringify()` 结果，不包含 HTTP 压缩。

| Session | JSONL | Active entries | Active bytes | Tail 120 | Provider messages | Tree |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 94 | 10.30 MB | 285 | 10.25 MB | 165 KB | 10.18 MB | 285 nodes / 107 KB |
| 61 | 1.52 MB | 70 | 1.51 MB | 1.51 MB | 1.49 MB | 72 nodes / 25 KB |
| 41 | 1.33 MB | 20 | 1.32 MB | 1.32 MB | 1.32 MB | 20 nodes / 6 KB |
| 160 | 1.31 MB | 18 | 61 KB | 61 KB | 57 KB | 851 nodes / 323 KB |
| 324 | 803 KB | 217 | 761 KB | 387 KB | 692 KB | 228 nodes / 86 KB |
| 489 | 672 KB | 126 | 648 KB | 619 KB | 620 KB | 133 nodes / 54 KB |

结论：

- 固定“最近 120 条”只能解决 session 94 这类条目多的会话，无法解决 session 41/61 这类条目少但单条巨大的会话。
- session 94 最大 tool result 约 9.56 MB；session 41/61 均存在约 1.30 MB 的单个 tool result。只做分页不能给响应体建立上界。
- `entries + messages` 在这些样本中接近重复传输同一历史，公开 DTO 删除无消费者的 `messages` 可直接消除一份主要放大项。
- session 160 的 active path 很小但 tree 有 851 节点 / 323 KB；tree 是独立增长维度，不能与 active path 分页混为一谈。

### 已有服务端耗时证据

- Task 74 记录过完整 snapshot 冷路径 `snapshotSystemPrompt=2264.6ms`、`total=2280.19ms`。
- 因此本任务必须同时观察：
  - JSONL 读取/解析与 active path/tree 投影耗时。
  - system prompt、context usage、relations 等 shell 构建耗时。
  - JSON 序列化后的字段 bytes。
- 历史页如果重复构建完整 shell，即使 entries 已分页，仍不能解决服务端冷慢问题。

## System Design

### 1. 单一路由，两种明确查询模式

继续使用 `GET /api/agent/sessions/:id`，不新增 entries/tree/context-usage GET 路由。

#### Recovery snapshot（无 `beforeEntryId`）

用于 initial load、`snapshot_required`、seq gap、event epoch change、active path change 和 manual refresh：

```http
GET /api/agent/sessions/123?limit=80&maxBytes=262144
```

返回：

- SSE recovery cursor 与 session live shell。
- 当前 active path revision。
- 最近一页公开 Chat Flow entries。
- 分页 metadata。
- 当前 lightweight session tree，保持现有分支切换和 Session Tree UI 能力。
- 是否返回 system prompt，见“需要用户决策”。

#### History page（有 `beforeEntryId`）

```http
GET /api/agent/sessions/123
    ?beforeEntryId=entry_xxx
    &activePathRevision=revision_xxx
    &limit=80
    &maxBytes=262144
```

返回：

- `sessionId`、`activePathRevision`。
- 本页公开 Chat Flow entries。
- `beforeEntryId`、`hasMoreBefore`、实际 entry/byte 统计。
- 不重复返回 tree、system prompt、context usage、relations、model 等 session shell。

同一路由可以返回判别联合 DTO，例如 recovery snapshot 与 history page 各有固定 `kind`；不要通过大量 optional 字段制造无法判断的半快照。

### 2. 公开 DTO 与持久化真相分层

- `SessionEntry` / `AgentMessage` 继续作为服务端持久化和模型运行类型。
- Chat Flow HTTP 不直接暴露无界原始 entry，而是输出独立、强类型的公开 entry 投影。
- 公开投影必须保留前端渲染所需字段：稳定 entry ID、parentId、timestamp、角色、assistant content/tool calls、tool result 状态和截断元数据。
- `AgentSessionSnapshotDto.messages` 退出公开 DTO；provider context 不属于 UI snapshot 合同。
- 不修改 JSONL，不回写截断内容，不影响 compaction、模型上下文、usage 和 Agent 继续运行。
- 不使用 `any` / `unknown` 逃避投影类型；异构 tool details 如确实只能为 unknown，必须限制在现有外部数据边界并说明原因。

### 3. 双预算分页

- `limit` 限制单页最大公开 entry/group 数量。
- `maxBytes` 限制公开 entries JSON 投影的 UTF-8 目标预算。
- 默认值必须由真实样本与渲染体验确认；初始测量候选为 `limit=80`、`maxBytes=256 KiB`，不是最终拍板。
- 页至少返回一个完整可渲染语义组；若该组经公开投影后仍超过预算，必须走明确的 oversized projection，不得无限突破预算。
- 响应返回实际 `entryCount`、`payloadBytes` 和 `oversizedEntryCount`，方便测试和后续观测；这些是 DTO 数据，不写逐请求业务日志。

### 4. 分页边界按 Chat Flow 语义组切分

按裸 entry 数切页可能让新页从 toolResult 开始，而前端找不到拥有该 tool call 的 assistant message。

本任务采用最小语义规则，不构造新的通用 timeline abstraction：

- assistant message 及其连续 tool results 视为不可从中间切开的显示组。
- invocation lifecycle error、compaction、branch summary、custom visible message 等独立可见 entry 保持自身边界。
- 非 UI entry 不单独消耗显示组配额，但 cursor 必须仍以稳定 session entry ID 表达。
- 页内顺序始终从旧到新；`beforeEntryId` 表示严格查询该 cursor 所在显示组之前的历史。
- 若当前 entry 投影规则无法确定 tool result 的 owner，测试先暴露该架构缺口，不在前端猜测关联。

### 5. Cursor 与 revision 一致性

- cursor 使用稳定 entry/group 起点 ID，不使用 offset。
- history page 必须携带 recovery snapshot 返回的 `activePathRevision`。
- 普通尾部 append 不改变 revision，旧历史 cursor 继续有效。
- 显式 tree/edit/retry/rollback 导致 revision 变化时返回 `409 ACTIVE_PATH_CHANGED`；前端丢弃旧分页窗口并请求新的 recovery snapshot。
- cursor 不存在、不属于当前 active path 或不位于合法显示组边界时返回明确 `400 INVALID_HISTORY_CURSOR`。
- 禁止 invalid cursor 静默回退到最新一页，否则前端会重复加载同一批数据。

### 6. 完整 tree 的本轮边界

- 首屏暂时保留现有 lightweight tree，因为聊天气泡 branch switcher 和 Session Tree Dialog 都依赖它。
- 不把完整 raw entries 与 tree 一起返回；tree node 继续只含摘要/preview。
- 本任务记录 tree bytes 和 node count，但不新增 tree GET 端点，也不改 Session Tree 产品交互。
- 如果真实验收证明 tree 单独成为主瓶颈，再基于 Task 49 另开设计，不在本任务顺手发明 tree 分页。

### 7. System prompt 与 context usage

- history page 绝不重新构建 system prompt 或 context usage。
- recovery snapshot 是否默认构建 system prompt，需要用户决策；它既是 Chat Flow 可见内容，也有已知 2 秒级冷成本。
- context usage 保持 recovery snapshot shell 字段，除非测量证明它成为独立主瓶颈；本任务不预设拆成新端点。
- relations 已有独立轻量刷新路径，history page 不重复返回 relations。

### 8. Command/tree 返回合同

- 轻控制 command 继续返回 `live_state`，遵守 Task 74。
- `retry`、`tree`、编辑/分支切换等会改变 active path 的操作不得继续内嵌无界完整 snapshot。
- 它们应返回足够表达“active path 已改变”的轻量结果，由现有 snapshot recovery single-flight 获取新的 recovery snapshot；或者复用同一个有界 recovery snapshot builder。
- 选择哪一种以避免重复 HTTP 和保持 Task 14 single-flight 为准，但所有入口必须共享同一有界 snapshot builder，不能出现 GET 有界、command 无界的双轨实现。

## Agent Chat Flow Interaction

- `AgentChatFlow.vue` 在距离顶部达到阈值时 emit 加载更早历史。
- 宿主以 `sessionId + activePathRevision + beforeEntryId` 作为请求身份，维护 single-flight。
- prepend 前记录 `scrollHeight/scrollTop`，渲染后按高度差恢复视口锚点。
- 保留显式“加载更早消息/重试”入口，作为失败恢复与无障碍兜底；自动滚动是主路径。
- 到达历史起点后停止触发。
- 迟到响应在 session、revision 或 cursor 任一不匹配时丢弃。
- recovery snapshot：
  - revision 未变时，保留已加载的更早页，只替换当前尾页与 shell；去重后合并 live invocation/optimistic message。
  - revision 已变时，清空旧分页窗口并重建当前 active path 尾页。
- 历史 prepend 不改变 `shouldStickToBottom`；新实时消息继续遵守现有自动吸底规则。
- 分页错误使用当前 Chat Flow 内可恢复错误/重试状态，不用全局成功通知刷屏；revision conflict 可显示一次说明并自动恢复首屏。

## Scope

### In scope

- snapshot/history query schema、判别联合 DTO、公开 Chat Flow entry 投影。
- `GET /api/agent/sessions/:id` 的 recovery snapshot 与 history page。
- repository/harness 中 active path 显示分组、cursor/revision 校验和有界 builder。
- 删除公开 snapshot 中无消费者的 provider `messages` 字段，并修正相关测试/类型。
- command/tree 等 active path 变更入口的有界 snapshot 一致性。
- `useAgentSessionApi.ts`、`useAgentSession.ts`、`useAgentSessionStream.ts` 的分页与 recovery 合并。
- `AgentChatSurface.vue`、`AgentChatFlow.vue` 的向上加载、错误重试和滚动锚点。
- 与上述合同直接相关的 payload、API、reducer 和组件测试。
- Task 106 walkthrough 与 `PROJECT-STATUS.md` 同步。

### Out of scope

- Markdown Source/TipTap 编辑器。
- Workspace 文件下载、目录树下载和右键菜单。
- 安装脚本、portable root、agent bin 脚本、发布流程。
- Config API、editor snapshot、依赖升级和 lockfile 重建。
- SSE replay buffer、subscriber queue、event payload 队列内存治理。
- invocation socket 断线恢复、writer update 累积和其他运行态修复。
- Session Tree UI 重设计或 tree 分页。
- Agent session 列表分页；该能力属于 Task 73。
- 修改 JSONL 历史数据或做兼容迁移；当前快速开发阶段直接硬切公开 DTO。
- 浏览器验证，除非用户后续明确授权。

## Required User Decisions

### D1 — 历史 tool result 的公开展示上限

事实：当前真实 session 存在 9.56 MB 单个 tool result；不做展示投影就无法保证 payload 上界。

建议：公开 Chat Flow DTO 对 tool result 正文使用 64 KiB 预览上限，保留：

- `truncated: true`
- `originalBytes`
- 明确用户文案“历史工具输出过大，仅展示预览”

JSONL 与模型上下文保留全文。本任务不新增“下载完整工具输出”能力；若产品需要，后续基于持久化 entry 设计显式查看入口。

需要用户确认：是否接受 64 KiB 建议值，以及本轮是否要求提供查看完整历史工具输出的入口。

### D2 — System prompt 的首屏策略

事实：system prompt 当前作为 Chat Flow 顶部 system bubble 展示；Task 74 曾测得冷构建约 2.26 秒。

建议：recovery snapshot 默认不构建 system prompt；只有用户显式展开“查看当前 System Prompt”时，再通过同一 GET 路由的明确 projection 参数请求。这样不新增端点，也不让每次恢复支付冷成本。

保守方案：首屏继续返回 system prompt，只先解决历史 payload；实现更小，但已知 2 秒级冷慢仍存在。

需要用户确认采用建议方案还是保守方案。

## Verification / Test

### Feedback loop / baseline

- [ ] 固化至少三类 fixture：长线性 active path、短 path + 单个超大 tool result、大 off-path tree + 短 active path。
- [ ] 测量并记录旧/新 recovery snapshot：总 bytes、entries bytes、tree bytes、system prompt bytes、构建分段时间。
- [ ] 测量 history page：entries bytes、实际组数、是否触发 shell 构建。
- [ ] 响应目标以未压缩 JSON bytes 验证，HTTP 压缩只作补充，不作为正确性保障。

### Repository / API

- [ ] 无 cursor 时返回最近一页完整显示组。
- [ ] 连续向前翻页无重复、无遗漏、顺序稳定，最终 `hasMoreBefore=false`。
- [ ] 页首不会出现没有 owner assistant 的 toolResult。
- [ ] 普通 append 后旧 cursor 仍有效。
- [ ] 显式 move leaf 后旧 revision 返回 `409 ACTIVE_PATH_CHANGED`。
- [ ] invalid/non-active-path cursor 返回 `400 INVALID_HISTORY_CURSOR`。
- [ ] 数量预算、字节预算和 oversized projection 均有边界测试。
- [ ] 单个 10 MB tool result 的公开页保持在拍板后的预算内，JSONL 原文不变。
- [ ] history page 不调用 system prompt/context usage/relations 构建 seam。
- [ ] recovery snapshot 不再包含 provider `messages`。
- [ ] retry/tree/编辑等 active path 入口不会返回无界 snapshot。

### Front-end state

- [ ] recovery snapshot 首次只显示尾页。
- [ ] prepend 分页按稳定 ID 去重，不覆盖 live invocation、pending approval 和 optimistic user message。
- [ ] 同一 cursor single-flight。
- [ ] session/revision/cursor 已变化时忽略迟到响应。
- [ ] same-revision recovery 保留已加载旧页；revision change 清空旧页。
- [ ] 截断 tool result 显示明确状态，不伪装成完整输出。

### AgentChatFlow

- [ ] 接近顶部自动触发一次加载。
- [ ] prepend 后视口锚点不跳动。
- [ ] 加载失败可重试且 loading 状态复位。
- [ ] 到达起点后不再触发。
- [ ] 历史加载不破坏自动吸底。

### Regression

- [ ] Task 14/62 snapshot recovery、seq gap、event epoch 和 SSE reducer 聚焦测试通过。
- [ ] Task 49 branch switcher、Session Tree projection 和 tree move 聚焦测试通过。
- [ ] Task 74 command live-state 聚焦测试通过。
- [ ] TypeScript typecheck 通过。
- [ ] 不自动运行浏览器验证；用户授权后再覆盖真实长 session 向上滚动、分支切换和 system prompt 入口。

## Implementation Plan

### Phase 0 — 用户决策与基线冻结

- 拍板 D1 tool result 预览上限与完整输出入口范围。
- 拍板 D2 system prompt 首屏策略。
- 把本轮只读抽样转成可重复的测试 fixture/测量 helper；临时产物只放 `.agent/workspace`，完成后清理。
- 记录旧接口 baseline，不先改业务代码。

### Phase 1 — 公开 DTO 与分页纯逻辑

- 定义 recovery snapshot/history page 判别联合。
- 定义强类型公开 Chat Flow entry projection 与 truncation metadata。
- 从公开 snapshot 删除无消费者的 provider `messages`。
- 在 repository 邻近层实现显示组投影、双预算窗口和 cursor/revision 校验纯逻辑。
- 先完成红灯测试，再实现到绿灯。

### Phase 2 — 统一有界 snapshot builder

- 重构 `buildSessionSnapshot()`，明确 shell builder、history projection 和 tree projection边界。
- recovery 模式只构建一次必要 shell；history 模式跳过昂贵 shell。
- GET、retry/tree/编辑等所有 snapshot 入口共享同一有界 builder 或统一 recovery 流程。
- 保留现有 Server-Timing，新增只对诊断有意义的 history projection/serialization 分段，不记录正文或敏感数据。

### Phase 3 — 前端状态模型

- API composable 支持同一路由两种判别响应。
- session store 分离：当前 shell、已加载 history window、live/optimistic overlay。
- 实现 same-revision recovery 合并、revision reset、迟到响应保护和截断状态投影。
- 不把 HTTP 生命周期重新塞回纯 reducer；维持 Task 14 已有职责边界。

### Phase 4 — Agent Chat Flow 交互

- 增加顶部阈值自动加载与显式重试入口。
- 复用滚动容器实现高度差锚定，不重复创建全局 pointer/mouse 监听。
- 覆盖高频 scroll、防重复触发、失败重试和 session 切换场景。

### Phase 5 — 聚焦回归与审查

- 运行本任务聚焦测试、Task 14/49/62/74 相关回归和 typecheck。
- 用真实 session 94/41/160 做只读 payload smoke，报告旧/新 bytes 与构建时间。
- 审查文件范围，确认没有混入 PR #7 的编辑器、下载、安装、Config 或 event memory 改动。
- 更新 Task 106 的实际变更文件、验证结果和计划偏差。
- 等待用户决定是否进行浏览器验证、Git 提交和新 PR。

## Architecture Guardrails

- 不新增与同一 session 查询语义重复的 GET 端点。
- 不在前端对原始 JSON 字符串做分页或截断。
- 不用 offset 分页 append-only tree。
- 不让 history page 重算完整 snapshot shell。
- 不保留 full/legacy 两套公开 snapshot DTO；直接迁移所有调用者。
- 不改变 JSONL 真相、模型上下文和 compaction 语义。
- 不为尚未出现的 tree 百万节点场景预先设计通用图数据库或持久化索引。
- 不因为本任务顺手重写 SSE、Session Tree UI 或工具运行协议。
- 任何新增类型必须表达真实领域含义；函数保持现有组件边界，只有复用或正确测试 seam 明确时才抽取。

## Collaboration Workflow

1. 调研与任务设计：已完成第一轮，等待 D1/D2 拍板。
2. 实现前先提交红灯测试和 DTO diff 供审查，不直接大改 Harness。
3. 按“纯分页/投影 → 后端统一 builder → 前端状态 → Chat Flow 交互”推进，每阶段都可独立审查。
4. 每轮将实际结果、测量和计划偏差写回本文档；性能与复杂度出现权衡时交由用户决定。
5. PR #7 只逐段参考，不 cherry-pick 无关提交。
6. 代码审查通过后，由用户决定浏览器验证、提交和创建新 PR。

## TODO / Follow-ups

- [x] 梳理 snapshot/repository/Chat Flow 调用链。
- [x] 抽样真实 session 的 active path、provider messages 和 tree bytes。
- [x] 确认只按 entry count 分页无法解决超大 tool result。
- [x] 确认 command/tree 存在无界 snapshot 回流入口。
- [ ] 用户拍板 D1。
- [ ] 用户拍板 D2。
- [ ] 固化性能 fixture 与 baseline。
- [ ] 编写 DTO/repository/API 红灯测试。
- [ ] 实现公开 Chat Flow entry 有界投影。
- [ ] 实现同一路由 recovery/history 两种模式。
- [ ] 统一 GET 与 active-path command 的有界 snapshot 行为。
- [ ] 实现 revision-aware 前端分页合并。
- [ ] 实现向上滚动自动加载和滚动锚点。
- [ ] 完成聚焦回归、真实样本 smoke 和代码审查。
- [ ] 用户决定是否执行浏览器验证。

