---
id: sample-npc
name: 示例 NPC
kind: npc
profile: simulator.actor
controlledBy: simulator
canonicalSource: null
---

# Sample NPC Subject（全知秘密档）

> **信息控制原则（创建者必读）**
>
> - 本文件是**全知档**，只有上级模拟器（simulator.leader）可见，actor 主路**永远读不到**它。可以在这里写隐藏真相、真实动机、未来安排、作者意图。
> - 角色**自己知道**的部分写进同目录的 `soul.md`（第一人称扮演手册，会被直接注入 actor 本人）。
> - **秘密绝不写进 soul.md**，否则角色会带着不该知道的真相自觉演，必然穿帮。
> - 信息按稳定性分流：稳定人设写 `soul.md`；会变的经历写 `events.jsonl`，会变的稳定看法写 `memory.jsonl`，当前想法写 `mind.md`，可见状态写 `state.md`。
> - `subject.md` 与 `soul.md` 都**不进 Subject RAG 索引**；RAG 只索引 `events.jsonl` / `memory.jsonl`。

## 角色定位（给上级模拟器）

这个 subject 是示例 NPC，可改成一个重要配角，也可改成统筹多个不重要 NPC 的群演 subject。重要配角建议一角一 subject；不重要 NPC、路人、临时敌人、服务人员可由一个 subject 统一扮演。

- 主要 NPC：待填写。
- 可兼任的不重要 NPC：待填写。

## 隐藏设定与真相（actor 不可知）

> 这里写 NPC **自己不知道、或不会主动说出口**的真相：真实身份、真实立场、真实动机、掌握但隐瞒的信息、与玩家的隐藏关系。这些只用于上级裁决，绝不进 packet、绝不进 soul.md、绝不进 RAG。

- 真实身份/立场：待填写（示例：表面是路人，实际受某势力指派观察玩家）。
- 隐瞒的信息：待填写。
- 真实动机：待填写。

## simulator.leader 调度提示

- 调这个 actor 时传 `kind: "npc"`（npc 可按 soul.md 性格自主反应，directive 是建议可偏离）。
- 把世界事件按「这个 NPC 此刻能感知什么」过滤后，再组装成 actor-facing packet；隐藏真相不进 packet。
- NPC 的稳定人设、说话方式、自知信息由 `soul.md` 提供；隐藏真相由本文件提供，只供你裁决。
