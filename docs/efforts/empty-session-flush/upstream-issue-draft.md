# 上游 issue 草稿：空会话建完不落盘（刷新即消失）

Status: open（待用户向宿主提交）

> 给宿主提 issue 时，把下面"复现"和"建议"两段贴过去即可；根因证据链在 ADR-0036。

## 现象

新建会话后**一条消息都不发**，刷新页面，该会话从会话列表消失。
会话目录在盘上根本没建出来（`~/.dsh/sessions/<bucket>/` 里没有它）。

## 复现

1. 新建会话（任意工作区）。
2. 不发消息，直接刷新页面（或等宿主进程重启）。
3. 会话不在了。对比：随便发一句话的会话刷新后仍在。

## 根因（宿主侧已定位）

- `ApiSessionList.list()` 按持久化读（`sessionQuery.listSessions()`），内存会话不在列表里。
- `dsh-session-persistence-jsonl` 的 `flush()` 注释写明："materializes the artifact
  when nothing has been appended yet, so an explicitly flushed empty session
  survives this process"——机制允许空会话存活。
- 但 `session.create`（`dsh-api-session-controller`）只做 `ensureSession` +
  `attachSession`，**不 flush**。零事件会话永远停在内存里，刷新即丢。

## 建议

`session.create` 建完自带一次持久化屏障（`sessionPersistence.flush()` 或等价），
让空会话建完即落盘。成本是一次磁盘屏障；收益是"新建会话"这个最基础的操作
不再依赖用户先说话才 durable。

## 插件侧已做的缓解（本仓库 ADR-0036）

`task/build` 写盘成功后调一次服务级 `flush()`，并把 `persistOk/persistError`
回给面板：成功则发起会话当即落盘；失败则面板明确报错，不静默。
这只是调用方的补救——根因仍在宿主 `session.create`。
