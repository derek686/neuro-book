# Subject Authoring

本文件定义 `simulation/subjects/{id}/` 下角色文件的分工与写法，供 `simulator.leader` 创建 / 维护 subject 时参考，并被 subject.md 模板引用。它从角色写卡技法提炼，但只保留落到运行态文件的部分，不收录 20/24/80/200 问的问答流程（那属于 `novel-technique-character-card-workshop` skill）。

## soul.md 与 subject.md 分工

一个 subject 的人设拆成两个文件，物理隔离信息边界：

| 文件 | 视角 | 谁能看到 | 写什么 |
| --- | --- | --- | --- |
| `soul.md` | 第一人称（「我」） | **会被直接注入 actor 本人** | 角色自己知道的一切：我是谁、我的性格、我说话的方式、我知道什么、我想要什么怕什么、我不会做什么。**无 frontmatter。** |
| `subject.md` | 全知（作者/上级视角） | **只有 simulator.leader 可读**，actor 永远读不到 | 隐藏真相、未来安排、作者意图、调度提示。保留 frontmatter（`id` / `name` / `kind` / `profile` / `controlledBy` / `canonicalSource`）。 |

## 信息控制铁律

- **秘密只进 subject.md，绝不进 soul.md。** soul.md 会被注入角色本人，写进秘密 = 角色带着不该知道的真相自觉演 = 穿帮。
- **秘密绝不进 RAG。** Subject RAG 只索引 `events.jsonl` / `memory.jsonl`；`subject.md` 与 `soul.md` 都不进索引。
- **秘密绝不进 actor-facing packet。** 上级把世界事件按「该角色此刻能感知什么」过滤后再发；隐藏真相只用于上级自己裁决。
- soul.md 缺失时 actor 主路会硬报错（`required=true`），所以每个要被扮演的 subject 必须先有 soul.md。

## soul.md 写法精要（全程第一人称）

从角色写卡技法提炼，保持「可演、不标签化」：

- **基础信息**：把「我是谁」（身份、来历、定位）和「我是什么性格」分开写，不要混成户口本。
- **调色盘**：用底色（最深基调）/ 主色调（旁人最常感到的我）/ 点缀色（让我不像标签的小特征）三层描述性格。
- **我说话的方式**：语气、习惯用词、什么时候沉默 / 追问。给扮演稳定的味道。
- **我知道什么**：只写角色理所当然知道的常识、关系、能力；不该知道的一律不写。
- **核心人格层（我想要什么怕什么）**：表层欲望、深层缺失、核心恐惧。这是稳定人格，不是本轮目标。
- **我不会做什么**：明确人设红线和（player 的）不替用户发挥纪律。
- **二次解释**：避免把高张力日常化、避免 AI 误读；用具体行为而非空标签描述角色。

## 稳定 vs 易变分流

创建 / 维护 subject 时按信息稳定性分流，不要把会变的东西写进 soul.md：

- 稳定人设、说话方式、长期性格 → `soul.md`
- 隐藏真相、作者意图 → `subject.md`（全知）
- 会变的经历流（经历了什么、被告知什么、产生什么误解）→ `events.jsonl`（append-only，RAG 索引）
- 会变的稳定看法（对某人/物/概念的当前判断）→ `memory.jsonl`（可编辑，RAG 索引）
- 当前短期心理、犹豫、动机 → `mind.md`
- 可见状态（位置、伤势、持有物、关系压力）→ `state.md`

## kind 约定

`subject.md` frontmatter 的 `kind` 决定 simulator.leader 调 actor 时传入的 `kind`，并切换 actor 的行为规则：

- `kind: player`（用户化身）：调 actor 传 `kind: "player"`。actor 不主动行动、不抢话、不自创关键行动，只把上级的 `<directive>` 第一人称自然化复述。所以 player 的 directive 要写得**更具体**。
- `kind: npc`（模拟器扮演）：调 actor 传 `kind: "npc"`。actor 可按 soul.md 性格自主反应，directive 是建议、可合理偏离。

第一版仅支持 player / npc 两种。

## 冷启动初始化流程

创建一个新 subject 并首次 invoke 之前，按顺序准备：

1. 写 `soul.md`：第一人称扮演手册，无 frontmatter，无秘密。
2. 写 `subject.md`：全知档，带 frontmatter，隐藏真相 + 调度提示。
3. 写初始记忆：把角色冷启动时已经经历/知道的事，直接写进 `events.jsonl`（经历）和 `memory.jsonl`（稳定看法）。**没有 memory-seed.md 中转文件**，上级模拟器直接落初始记录。
4. 按需写 `mind.md` / `state.md` 初始心理与状态。
5. 以上就绪后，才首次调用 `simulator.actor`（传 `subjectPath` + `kind`）。

## Related References

- [../../content/simulation.md](../../content/simulation.md)
- [../../content/subject-rag-memory.md](../../content/subject-rag-memory.md)
- [../../content/information-control.md](../../content/information-control.md)
- [actor-facing-packet.md](actor-facing-packet.md)
