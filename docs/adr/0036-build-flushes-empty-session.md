# ADR-0036 — 建任务时显式落盘发起会话

- 状态：已采纳（2026-11-04）
- 上下文：ADR-0032（不静默退化）
- 触发：任务建完后刷新页面，发起会话消失——用户在消息窗里一条消息都没发过。

## 问题

空会话在宿主内存里存在，但**不在盘上**，刷新页面后从会话列表消失。
会话列表是按持久化读出来的（`ApiSessionList.list()` → `sessionQuery.listSessions()`），
而 jsonl 持久化层只在 `append`/`flush` 时才把会话物化到盘上。
宿主 `session.create` 只做 `ensureSession` + `attachSession`，不 flush——
建完停在空会话里没发过消息，盘上连目录都没有（实测 43 个已落盘目录里找不到那次新建的）。

这不是插件丢状态：三个执行会话（`task-session-*`）都有开场提示 → 有事件 → 落盘了，
刷新后都在。丢的只是从没写过一条事件的发起会话。

## 调查

- `dsh-session-persistence-jsonl` 的 `flush()` 注释写明了意图：
  "Durability barrier; materializes the artifact when nothing has been appended yet,
  so an explicitly flushed empty session survives this process."
  机制允许空会话存活，**只是没人调那次 flush**。
- 宿主 `SessionPersistence` 有服务级 `flush(): Promise<void>`（一次调用把所有
  活体写句柄落盘），插件侧 `ctx.get('sessionPersistence')` 可及（`storage` 同位的
  已有用法：`deleteSessions` 里用它 `locate` 后删盘）。
- 上游根因在宿主：`session.create` 建完不 flush。插件不能替宿主修，只能在
  "停在空会话里干正事"的自家流程里补一次。

## 决定

1. **`task/build` 写盘成功后调一次 `sessionPersistence.flush()`**（服务级屏障，
   覆盖发起会话在内的所有活体写句柄）。这是本 ADR 的全部改动面。
2. **flush 失败不挡建任务**：任务目录已经写好，拦住用户没有意义。
   但按 ADR-0032 **失败必须说清**：`build` 响应带 `persistOk` + 可选 `persistError`，
   面板在 `persistOk === false` 时显红色错误——"任务目录已建，但发起会话没落盘
   （刷新页面会丢失）：<原因> —— 先随便发一句话把会话坐实再继续"。
3. **`sessionPersistence` 缺席也走同一条**：`persistOk=false` +
   `sessionPersistence unavailable(宿主未挂载持久化服务)`，不静默。
4. **上游 issue 另起**：`docs/efforts/empty-session-flush/` 放复现与建议
   （`session.create` 建完自带一次 flush），供用户向宿主提。

## 后果

- 好处：用户按正常流程建任务，发起会话刷新后还在（内存 + 磁盘都有了）；
  万一没落盘，用户第一时间知道原因和补救动作，而不是建完任务才发现会话丢了。
- 代价：`build` 多一次全量 flush（所有活体写句柄），正常就一次磁盘屏障，
  可接受；失败路径多一个面板错误分支。
- 非目标：刷新后**面板状态**（描述、勾选、taskDir）仍不恢复——那是
  "面板状态落盘"议题（`task.json` + `task/list`），用户已明确不做。
  本 ADR 只保"会话不消失"。

## 验证

- `tests/vitest/task-routes.test.ts`：
  `persist` 桩注文时 `flush` 恰调一次且 `persistOk === true`；
  缺席时 `b.ok === true` 且 `persistOk === false`、`persistError` 含 `sessionPersistence`。
- 真机：重启宿主 → 建任务 → `ls ~/.dsh/sessions/<bucket>/` 当即见发起会话目录 →
  刷新页面会话仍在。
