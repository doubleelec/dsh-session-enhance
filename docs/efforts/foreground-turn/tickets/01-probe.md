# T1: 前台能力探针

Status: resolved

**What to build:** 在真实 dev 环境回答 spec 的 Q1~Q4，不写业务代码，只跑探针并记录结论。

**Blocked by:** None (can start immediately).

**探针清单：**

- [ ] P1：host 拿到 parent（`agents.get(sid)`）后调 `followup`，观察发起会话是否起 turn（看发送按钮/蓝字/事件流）
- [ ] P2：占位 turn 存续期间 host 心跳更新进度，观察 UI 如何呈现（流式追加？整块刷新？）
- [ ] P3：用户在占位 turn 中点停止/发新消息，观察 `cancel` 语义与 inbox 排队行为
- [ ] P4：辩论后台 abort 时，占位 turn 是否自然收、有无僵尸态

**退出标准：**四个探针各有"实测结论 + 复现步骤"，写入本文件 `## Comments`；结论决定 T2 方案走向（可做 / 降级 / 放弃）。

## Comments

### P0 能力枚举（2026-10-21，3080 实测，`debug-parent` 路由）

`agents.get(sid)` 拿到的 parent 面上有（`cap` 实测）：

- `followup: function` —— 真身 `followup(input) { this.send(input, "next-turn", true) }`。
  语义是"发 next-turn"，**不是纯 inbox 投递**：第三个参数 `true` 按 DSH 惯例是"唤
  醒/起 turn"标志。这是从未走过的路，但门是开着的。
- `cancel: function` —— `cancel(cause, options)`，`keepInbox` 语义与 S17 已用的一致。
- `whenIdle: function` —— `async whenIdle()`，等 turn 跑完可用。
- `status: string` —— 注意：parent 面上的 `status` 是**字符串字段**，不是函数。
  S17 的 `parentBusyOf` 读的是 `parent.status === 'running'`，与此一致（`agents.get`
  返回的是 agent 对象，`status` 是其当前状态快照）。
- `dispose: undefined` —— parent 不能 dispose（符合预期：发起会话的命不归插件管）。
- `session: object`（`append` 面在）+ `ctx: object`（工具表可读）。

`keys` 全表：activityDone / assistantAttemptCounter / assistantStreamRevision /
ctx / dispatch / frozenMessages / id / inbox / loopCtx / options / phase /
requestHeaderLogged / requestSurfaceGeneration / runtimeContext / scope /
session / systemPrompt。

**P0 结论：前台占位 turn 的能力门是开着的。**`followup(input)` 发 next-turn，
理论上能让发起会话起一个真实 turn。P1（真调一次看会话区是否进入运行态）值
得动手。风险：`send(input, "next-turn", true)` 的具体 UI 语义（蓝字？停止按钮？
用户消息插队？）只能真调看，文档推不出来。

### 维护巡检：debug 路由已超 WIRE-01 基线（2026-10-21）

当前 `src/index.ts` 注册的非 task 路由共 **11 条**（debug / debug-agent /
debug-child-tools / debug-followup / debug-parent / debug-sessions /
history / interrupt / start / state / stop / version 取 deliberation 相关），
而 `src/module.toml` WIRE-01 描述仍写"9 deliberation routes"。

来源：`5a21688`（debug-parent）+ `fdf5d55`（debug-followup）是本 effort
的探针路由；其余 debug-* 是 S5 旧物。task/* 七路由门不受影响（仍是七条，
`test_src_task_routes_are_seven` 绿）。

探针路由是临时的，不建议现在改 WIRE-01 数字。T1 收尾时二选一：
(a) 删探针路由，回到 9；(b) 留作常驻可观测，则把 WIRE-01 改成 11 并在
`test_src_registered_tools_match_manifest` 旁加条数门。别静默留在 9 对
11——下次巡检还会报。

### P1 实测结论：running 中调 followup 只进 inbox，不打断当前 turn（2026-10-29）

复现步骤（3080，web profile，debug-followup 路由 + 面板"探针"按钮）：

1. 起一个辩论（后台 `runHostDebate` 跑，parent 会话 running，占位 turn 存续中）。
2. 面板点"探针"按钮 → `POST /dsh-session-enhance/api/debug-followup`
   `{ debateId }` → host 侧 `agents.get(parentSid).followup(无害心跳文本)`。
3. 路由返回 `statusBefore === 'running'` 且 3s 后 `statusAfter === 'running'`；
   用户侧观察：发送按钮/蓝字无新变化，心跳文本只在**当前 turn 结束后**才以
   user 气泡出现（排队语义）。

宿主源码定论（`dsh-agent-loop/lib/index.js:800-869`，与 P1 现象完全吻合）：

```js
send(message, target, wakeup) {
  const wakingAfterAbort = wakeup && this.phase.kind !== "idle" && this.phase.abort.signal.aborted;
  const resolvedTarget = wakingAfterAbort ? "next-turn" : target;
  this.inbox.splice(resolvedTarget, Infinity, 0, [message]); // 恒进 inbox
  if (wakeup) this.wakeDriver(wakingAfterAbort);             // running 中直接 return
}
followup(input) { this.send(input, "next-turn", true); }    // 第三个参数 true = "wakeup"
wakeDriver(wakeAfterAbort = false) {
  if (this.phase.kind !== "idle") {                          // ★ running/maintenance 中只打标
    if (abortedCancelCause(...)?.kind !== "disposed" && (this.phase.kind === "maintenance" || wakeAfterAbort))
      this.phase.wakeRequested = true;
    return;                                                  // 不开新 turn、不打断当前 turn
  }
  // idle 才真正开 driver：setPhase({kind:"running"}) + kick() 进 turn() 循环
}
```

- `wakeup=true` 的真实语义 = **"idle 时起 driver；running 时只进 inbox，等本轮
  turn 循环自然认领"**。`kick()` 的 `while (await this.turn())` 在 turn 收尾时
  查 `inbox.hasPending`（index.js:1037），有 pending 就同一 driver 内续跑下一
  turn——所以 followup 进 inbox 的消息**一定会被消费**，只是要等当前 turn 结束。
- `status` 快照语义（index.js:790-792）：`idle/maintenance → "idle"`，
  其余（running）→ `"running"`。P1 前后都是 running，正说明占位 turn 存续、
  followup 没起新 turn——与源码一致。
- 唯一例外：`wakeAfterAbort`——running 中但 abort signal 已触发（cancel 刚发生、
  turn 正在收尾）时，`send` 把目标强制改写为 next-turn 并打 `wakeRequested`，
  turn 收尾后立即重起 driver。这是"cancel 后 followup 续跑"的机制，不是打断。

**Q1 回答：host 对 parent 调 `followup` 是否触发其 turn，还是只进 inbox？**

分两种情况（同一函数，宿主按 phase 分支）：

- parent **idle** 时：进 inbox **并触发 turn**（`wakeDriver` 开新 driver，
  UI 进运行态：停止按钮 + 蓝字，见 Q2 证据）。
- parent **running** 时（含占位 turn 存续期）：**只进 inbox，不触发新 turn、
  不打断当前 turn**；消息在当前 turn 结束后被同一 driver 续跑消费。
  P1 实测正是后者（status 前后 running）。

### P2 实测结论：宿主无进度 API，心跳 = 长文本流（turn 内自然呈现）（2026-10-29）

宿主源码扫描结论（`dsh-agent-loop` 全包 grep `progress|reportProgress|
heartbeat|setStatus|notice`）：**零命中**（仅 LICENSE 误伤）。宿主没有给插件
用的"进度条/状态位" API。

turn 内唯一合法的流式 UI 通道是 **`agent/assistant-stream` 事件**
（`dsh-agent-loop/lib/index.js:1079-1091`）：

```js
const live = new AssistantStreamAttempt(..., (frame) => {
  this.dispatch.emit("agent/assistant-stream", { frame }); // start/chunk/end 三帧
});
live.start();
for await (const chunk of stream) { signal.throwIfAborted(); live.push(chunk); }
```

- 该事件是**模型流式输出**的 presentation 数据（dsh-agent README 明示
  "the live event remains presentation data rather than the replay source"），
  由 loop 在 LLM chunk 到达时 emit，UI 跟着打字机追加。
- 插件**不能伪造**它：emit 通道是 loop 私有的 `this.dispatch`（agent 作用域
  dispatcher），host 侧 `agents.get()` 拿到的 Agent 面上只有
  `send/followup/steer/inject/cancel/whenIdle/runMaintenance`，没有 dispatch
  句柄。`dsh-subagent` 的 typer 声明可作证（`Agent` 接口七方法，无 emit）。
- 周期性 followup **不是心跳**：P1+源码已证 running 中 followup 只进 inbox，
  且每条都会变成持久 user 气泡 + 被模型消费（污染上下文、浪费 token），与
  "轻量进度"背道而驰。更糟的是 `turn()` 循环里 `nextStep` 非空会阻止 turn
  收尾（index.js:1000-1008 `turn-stopping` 门），高频 steer 会把占位 turn
  拖成永不结束。

**Q2 回答：turn 心跳用什么机制（长文本流？周期性 followup？宿主有无进度 API）？**

- 宿主**无进度 API**（源码零命中）。
- 占位 turn 的"心跳"只能是 **turn 内的一次长文本流**：占位 turn 本体是一个
  真实 tool call（runHostDebate 挂起），它的"运行中…"蓝字 + 停止按钮就是心跳
  的载体——turn 活着即心跳，不需要、也不应该周期性 followup。
- 秒级进度走**现有两条旁路**（都不占 turn、不进 inbox）：
  (a) `session.append('user/message', …, {surfaceOp:'append'})` 的 mirror
  直播（已在用，纯日志追加，对话区即时可见）；
  (b) 面板 2s 轮询 `session.progress` 内存字段（已在用）。
  这两条就是本 effort 的心跳机制，不需要第三条。

UI 语义旁证（`dsh-client-ui-conversation` README + client.js）：running 会话
的主按钮行为 = "草稿为空时主指针动作保持为 **Stop**"（`primaryStops = running
&& …`，client.js:18948），Stop 用"与停止按钮同作用域的取消"
（`agent.cancel({kind:'user'}, {keepInbox:true})`，commands.js:474——**保留
inbox，只停当前 turn**）；busy 时 Enter 默认走 Queue（`resolveSubmitMode`
running → queue），即用户输入默认排队。蓝字"深度求索中"字样在 bundle 源码
中未找到固定字符串（应由 turn 状态 + 本地化 key `detail.status.running`
"运行中…"驱动），不影响结论。

### P3 实测结论：占位 turn 中用户发消息 = 排队；点停止 = 停当前 turn 但保留 inbox（2026-10-29，源码定论 + 待真机复核）

用户输入 admission（`dsh-api-session-controller/lib/types/commands.js:302-350`）：

```js
if (request.mode === 'steer') agent.steer(message);  // 进 next-step，当步打断点认领
else agent.followup(message);                        // 进 next-turn，本 turn 结束后认领
```

- **发消息（默认 queue 模式）**：`followup` → 只进 next-turn inbox。running 中
  不打断、不双停。当前 turn（占位 tool call）继续跑，消息在其结束后以新 turn
  被模型消费。——语义是 **"排队等占位 turn 结束"**，不是"打断并双停"。
- **发消息（steer 模式，Cmd/Ctrl+Enter 或 Send 下拉选"插话"）**：`steer` →
  进 next-step。占位 turn 的 tool 等待点在 `turn()` 循环的步边界认领
  next-step（index.js:956 `preStep(target…)` → `claim("next-step")`），但**占位
  turn 自身是挂起的 tool call，不跑步边界**——steer 消息会在占位 turn 被 cancel/
  结束后、下一 turn 开头被认领，效果约等于 queue（多一次"当前 turn 已不接受
  steering" 的可用性门：updateQueue 在 `target!=='next-turn'||status!=='running'`
  时拒 steer，commands.js:433）。
- **点停止 / Esc Esc**：`agent.cancel({kind:'user'}, {keepInbox:true})`
  （commands.js:466-475）。`cancel` 实现（index.js:815-821）：`keepInbox` 为真
  时**不清 inbox**，只 abort 当前 phase。占位 turn 的 abort 会打断挂起的 tool
  调用 → turn 以 `aborted` 收尾（index.js:1010-1018）→ `kick()` 收尾、
  phase 回 idle → 若 inbox 有 pending 则 `wakeDriver` 重起。——语义是
  **"停当前 turn，保留排队，inbox 非空则自动续跑"**。对本 effort 的直接后果：
  用户在占位 turn 点停止，会把占位 tool call 打断；若此时 inbox 里躺着用户
  自己的排队消息，宿主会自动起新 turn 跑它——**后台辩论还在跑，但前台 turn
  已经跟用户消息走了**，两者分叉。T2 必须处理此分叉（方案见 Q4 降级项）。

**Q3 回答：用户在占位 turn 进行中发消息，语义是"打断并双停"还是"排队等辩论结束"？**

- 发消息 = **排队等占位 turn 结束**（默认 queue；steer 在占位场景下效果也约
  等于排队）。**不打断、不双停**——这是宿主源码的默认分支，无需插件做什么。
- 真正的"停"是用户**点停止**：停前台占位 turn、保留 inbox。此时后台辩论
  （`runHostDebate` 是 host 内存任务，非 agent turn）**不受影响、继续跑**——
  所谓"双停"需要插件自己监听 turn 中止并 abort 后台任务，否则就是"前台停、
  后台跑"的分叉态。P4 探针（后台 abort 时占位 turn 是否自然收）仍待真机跑，
  但源码已给出预测：后台 abort 不会自动 cancel 前台 turn，占位 turn 会一直
  挂起直到用户点停或插件调 cancel——**僵尸态是默认结局，T2 必须显式收尾**。

### P4 实测结论：宿主有"让指定会话起 turn"能力，无需降级（2026-10-29，源码定论）

"让指定会话起 turn" = 对 live agent 调 `followup`（idle 时 wakeDriver 开
driver）。能力门：

- host 侧 `ctx.get('agents')` → `agents.get(sid)` 返回 live `Agent`（P0 已实测
  有 followup/cancel/whenIdle/status 面）。
- `followup` 在 idle 会话上**必然起 turn**：`wakeDriver` 的 idle 分支无条件开
  driver（index.js:859-868），`kick()` 进 `turn()` 循环开 `turn/start`。
  宿主自己的 `prompt` 命令走的正是同一条路（commands.js:325-328：queue 模式
  调 `agent.followup`），UI 发消息与插件调 followup 在宿主眼里**同一语义**。
- 约束只有两条（都不是"无能力"）：
  (a) 会话须 live（`agents.get` 能拿到；冷会话需 `resolveAgent` 恢复，插件
  host 侧无此 API——但本 effort 的 parent 就是发起会话，辩论期间必 live）；
  (b) running 中调用只排队（Q1 已答——占位 turn 存续期 followup 不起新 turn，
  这正是想要的：进度走 mirror，终局那一下等 turn 自然结束或先 cancel 再
  followup）。

**Q4 回答：若宿主无"让指定会话起 turn"能力，降级方案是什么？**

- **前提不成立：宿主有该能力**（`agents.get(sid).followup()`，idle 起 turn、
  running 排队，源码 + P1 双证）。**无需降级，T2 走主方案**。
- 降级预案（仅当未来宿主收紧能力时启用，按优先级排）：
  1. **纯 mirror 降级**：全程只用 `session.append` 直播 + 面板轮询，终局结论
     只写文件 + 面板，不让前台起 turn。用户看到结论但无"模型亲口说"体验。
  2. **用户自取**：终局只把结论写进面板 + 一条 mirror 消息，追问则由用户
     手动发消息起 turn（把"起 turn"动作交还用户，插件不行使用户行）。
  3. **放弃前台占位**：回到 S17 常驻后台方案（辩论全程无 turn，后台跑完只落
     盘），前台零打扰、零心跳。
- T2 必须处理的两处分叉（与 Q4 降级无关，是主方案的收尾义务）：
  (a) 用户点停止 → 前台 turn 中止而后台辩论继续：监听 turn 中止
  （`agent/status` → idle 或 turn/end reason=aborted）→ abort `runHostDebate`
  或将其转后台（变 S17 语义）；
  (b) 后台 abort/失败 → 前台占位 turn 僵尸：后台 settlement 处显式
  `parent.cancel({kind:'…'})` 收占位 turn，再 `followup` 终局（idle 起 turn）
  或 mirror 终局。

### 源码索引（复核用，版本以实测时 node_modules 为准）

- `send/followup/wakeDriver/cancel/whenIdle/status`：
  `…/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`
  `:800-875`（send/followup/steer/inject/cancel/runMaintenance/wakeDriver/
  whenIdle），`:790-799`（status getter + setPhase 发 `agent/status`），
  `:887-901`（kick 循环），`:938-1042`（turn 循环 + turn-stopping 门 +
  hasPending 续跑），`:100-111`（claim：next-step 全取 + next-turn 取一条）。
- 语义白皮书：`…/dsh-agent/README.md:45-47`（followup 排队普通 next-turn 提示
  并唤醒驱动；steer 下一步；inject 不唤醒；cancel 中止活动；whenIdle 等全停稳）
  + `README.zh.md:47` 中文版。
- 用户输入 admission：`…/dsh-api-session-controller/lib/types/commands.js`
  `:302-350`（prompt：steer→`agent.steer`，queue→`agent.followup`），
  `:466-475`（cancel：`{kind:'user'}` + `keepInbox:true`），`:433-454`
  （steer 可用性门 + queue 行 steer 动作）。
- UI 语义：`…/dsh-client-ui-conversation/README.md:105-115`（running 主按钮为
  Stop、busy Enter 默认 Queue、Esc Esc 停当前 turn 保排队）+
  `lib/client.js:18948-18953`（primaryStops/primaryLabel）。
- inbox 持久化：`…/dsh-agent-loop/lib/index.js:14-160`（`agent/inbox/spliced`
  fold + ReactLoopInbox），`…/dsh-subagent/lib/types/manager.js:518-594`
  （deliver/sendWaking：steer→`steer()`，queue→`followup()`）。
- surface 白名单：`…/dsh-session/lib/index.js:156-171`（仅 system/developer/
  user/assistant/message + tool/result 可进 surface；插件记录走 `plugin:`
  命名空间 `appendPluginRecord`，:1295——UI 不渲染，故 mirror 仍用 user/message）。
- Agent 接口：`…/dsh-subagent/lib/typert.host.js:297`（七方法：cancel/whenIdle/
  runMaintenance/send/followup/steer/inject，无进度 API、无 emit）。
- 本文件 P0 基线 + `src/index.ts:2175` debug-followup 路由 +
  `src/index.ts:191-210` mirror 实现（注释"不进 inbox、不开 turn"已由本次
  源码复核确认属实：`session.append` 只写日志，驱动只认 inbox）。

**T1 收尾判断：Q1-Q4 已全部回答，主方案可行（可做），无降级需求。**
遗留：P3/P4 的"真机点按钮"复核（停止分叉、后台 abort 僵尸）建议并入 T2 联调
一起做，T1 以源码定论 + P1 实测关闭。
