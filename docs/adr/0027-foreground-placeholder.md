# 前台占位 turn：阻塞式 hold 工具 + 双向收尾

2026-10-29 冻结（T1 探针 `可做` 后落笔）。T1 以源码 + 实测双证回答 spec Q1-Q4，
本 ADR 把"可做"收敛成唯一可执行方案，并与 S28 零工具约束对齐。

## 上下文

- spec 问题：`runHostDebate` 是纯后台任务，发起会话全程 `idle`，用户分不清
  "没跑起来"还是"在跑"（spec Problem Statement）。
- T1 定论（`docs/efforts/foreground-turn/tickets/01-probe.md`）：
  - Q1：`agents.get(sid).followup()` idle 起 turn、running 只排队（loop
    `send/followup/wakeDriver`，`index.js:800-875`）。
  - Q2：宿主无进度 API；占位 turn 本体必须是真实 tool call，它的"运行中…"
    蓝字 + 停止按钮就是心跳载体；秒级进度走 mirror + 面板 `progress` 轮询。
  - Q3：占位期发消息 = 排队（queue；steer 约等于排队）；点停止 =
    `cancel({kind:'user'},{keepInbox:true})` 只停前台，后台继续跑——分叉默认态。
  - Q4：宿主有起 turn 能力，无需降级；但 T2 必须显式收双向分叉（前停后不停、
    后停前僵尸）。
- 约束冲突：S28（ADR-0025 v0.14.0 修订）定"人工操作插件，模型工具零个"，
  `test_src_registered_tools_match_manifest` + WIRE-01 锁死；但占位 turn 要
  一个"挂起即运行态、可取消" 的真实 tool call——旧 seam（`ctx.tools.register
  (defineTool(...))`）仍是宿主唯一注册位置（`@deepseek-ai/dsh-tools`
  `lib/index.js:3810`、`README.md:38-62`，无 deprecate/移除公告；`dsh.plugin.json`
  `contributes.tools` 在宿主安装内无消费代码，只是声明）。
- 旧形状可考（`bf55b18^:src/index.ts`）：`debate_start` 的 `execute` 里
  `exec.agent` 即 parent，`void runHostDebate(..., parent)` 跑全程，
  tool 挂起 = turn 活着；`mirrorToChat:true` 只镜真实会话。

## 决定

1. **重注册唯一阻塞式 hold 工具**（T3 已定名 `debate_hold_foreground`）：
   `inject` 加回 `'tools'`，`apply` 内 `ctx.tools.register(defineTool({...}))`
   全 DSL（`output.render` 必需，`exec.signal` 必有、`exec.agent?` 可选）。
   工具语义：参数只带 `sessionId`（+ 可选 `reason`），`execute` 内
   `await` 辩论 settlement（done/failed/stopped 任一即 return），除进度外不做
   论证（论证仍在子会话/子 agent 里，spec Decisions）。
2. **起 turn 路径**：`/api/start` 建单后 host 对 parent `followup()` 拉起占位
   turn（idle 起 driver；running 只排队——占位存续期 followup 不起新 turn，
   正好是想要的：进度走 mirror）。模型在该 turn 内调 hold 工具，
   tool 挂起 = 前台进入运行态（蓝字 + 停止按钮）。
3. **心跳**：turn 活着即心跳；秒级进度不另起 turn，走现有两条旁路
   （`session.append` mirror + 面板 2s 轮询 `session.progress`）。
4. **双向收尾（僵尸/分叉是默认结局，必须显式收）**：
   - 用户点停止 → tool abort → `execute` 的 `signal` 触发 → abort
     `controllers` 后台任务（转 S17 语义或按 interrupted 落盘）。
   - 后台 settlement（done/failed/stopped）→ 显式 `parent.cancel(...)` 收占位
     turn，再 `followup` 终局（idle 起 turn 说结论）或 mirror 终局。
   - inbox 排队消息按 `keepInbox:true` 保留（ADR-0023），宿主自动续跑的是用户
     自己的消息，不是辩论——两者分叉时以后台 abort 为准，前台跟用户消息走。
5. **S28 修订**：零工具改为"唯一 hold 工具例外"。`dsh.plugin.json`
   `contributes.tools` 加 hold 工具名；WIRE-01 由"9 deliberation + 10 task，
   零工具"改为"9 + 10 路由，1 hold 工具"；`test_src_registered_tools_match_manifest`
   同步放行唯一名；`src/module.toml` WIRE-01 描述同步。

## 备选（否决）

- **纯 mirror 降级**：无运行态，用户仍分不清在跑还是没跑——回到 spec 原问题。否决。
- **用户自取（手动发消息起 turn）**：把"起 turn"交还用户，终局无"模型亲口说"。降级预案，
  仅宿主收紧能力时启用（T1 Q4 已排优先级）。本次不用。
- **周期性 followup 心跳**：running 中只进 inbox，每条变持久 user 气泡 + 被模型消费，
  且 `turn-stopping` 门把占位 turn 拖成永不结束。否决。
- **`runMaintenance` 占位**：`status` 快照把 maintenance 归为 `idle`，无运行态 UI。否决。

## 后果

- 前台有真实可取消 turn：发送变停止 + 蓝字出现；取消即双停；结束 turn 收。
- manifest/WIRE-01/门禁随动（T3 同改，不静默漂移；探针路由按 T1 备注二选一：删或转正补门）。
- 面板 `parentBusy` 语义不变（`parent.status==='running'`），占位期恒忙。
- 验证：单测覆盖中断映射（turn 取消 → abort → `interruptedAt` 落盘）；
  真跑一局验证发送/蓝字/双停/收 turn；vitest + pytest + arch 全绿后双推。

## 验证

- T1 源码索引见 `01-probe.md` §源码索引（loop `index.js:800-875/790-799/887-1042`、
  commands `302-350/466-475`、UI README `105-115`）。
- 工具缝：`@deepseek-ai/dsh-tools/README.md:38-62`、
  `dsh-tool-ask-user/lib/index.js:1,216,223`（最小形状对照）。
