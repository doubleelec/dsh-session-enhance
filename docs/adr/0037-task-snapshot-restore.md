# ADR-0037 — 刷新后面板进度恢复（按发起会话存快照）

- 状态：已采纳（2026-11-04）
- 上下文：ADR-0032（不静默退化）/ ADR-0036（发起会话落盘）
- 触发：任务建完、执行会话已拉起，刷新页面后面板回到一张白纸——描述、勾选、taskDir、执行会话 id 全丢，得重扫重建。

## 问题

ADR-0036 只保"会话不消失"（发起会话落盘），不保"面板进度现场"。
用户停在"建完任务、执行会话已拉起"的现场，刷新回来却是：

- 描述/勾选/slug/tasksRoot 等表单全空；
- taskDir 丢失，`汇总回信`调不动；
- 刚拉起的执行会话 id 不见了，得去会话列表里翻。

这不是会话丢了，是面板的内存态丢了——恢复它不需要动 host，只需要面板自己记住现场。

## 调查

- 面板状态分两类：**表单**（desc/checked/reasons/slug/tasksRoot/templateDir/provider/model）
  与**执行现场**（taskDir/sessions/backs）。表单是用户输入，执行现场是 build/launch
  的产物——两者都在面板内存里，刷新即失。
- 全局 prefs（`dshe-task-prefs`）不能拿来做恢复：它是跨会话的，曾因跨工程串台被用户否掉
  （ADR-0036 背景：parentRoot 必须只用当前会话 cwd，偏好旧值直接忽略）。
  恢复必须带作用域——同会话同工程才恢复，否则宁可白纸。
- taskDir 的存在性必须验：任务目录可能被用户手动删掉，恢复一个不存在的目录比白纸更糟
  （`collect` 会报 `taskDir required`/ENOENT，用户还以为是 bug）。
- 执行会话 id 的"活体校验"做不得：宿主 store 就绪时序不定，误判"消失"的代价比展示旧 id 更大。
  任务连续性以 taskDir + 回信为准（collect 可重复调），会话 id 只供到会话列表跟进。

## 决定

1. **按发起会话存 localStorage 快照**（`dshe-task-snapshot:<sid>`），与全局 prefs 分家：
   - 恢复门：快照的 `parentRoot`/`scannedRoot` 必须等于当前会话 cwd，不等说明切了工程，快照作废。
   - 有快照时：表单/勾选/slug/tasksRoot 等以快照为准（入口草稿是别的会话的东西，不用）；
     结构缓存直接用，跳过重扫（重扫会清空已审核的勾选）。
   - 无快照/换会话/换工程：一律白纸开，走原来的"打开即扫"。
2. **挂载即验盘**：taskDir 非空时调一次 `collect`——成功则回信自动取回（`backs` 回填）；
   失败则 fail-loud：taskDir/sessions/preview 清空，快照清除，红色错误 + **一键重建**
   （重扫并推荐），表单保留。静默丢现场是缺陷（ADR-0032）。
3. **写入点**：scan / recommend / build / launch 成功后各写一次快照
   （`persistSnapshot` 合并写：只传变的字段，其余沿用旧快照/当前 state）。
   快照写失败静默——丢了只是刷新后白纸，不挡当前任务。
4. **恢复标记是中性条**（复用 `.dshe-restored`）：说明"已从本会话快照恢复，
   任务连续性以任务目录 + 回信为准"，不是告警。过期才用红色错误（fail-loud 那条）。
5. **快照只记成功的执行会话**（`ok && sessionId 非空`）；失败的不记，刷新后不展示死 id。
6. **版本化**：快照带 `v: 1`，以后加字段时旧快照整体作废（`normalizeTaskSnapshot` 回 null），
   不做逐字段迁移。坏字段逐个收敛回空，不整单作废。

## 非目标

- 不做 `task.json` / `task/list`（任务目录自带现场、换机器可续）：用户已明确不做（ADR-0036 §后果）。
  本 ADR 只保"同机同会话刷新不断档"，换浏览器/清缓存就白纸——这是 localStorage 的已知边界，
  快照丢了只是多走一遍流程，不丢任务（任务目录在盘上）。
- 不校验执行会话活体（见调查第 4 条）。
- 不恢复 `preview`（未确认的预览）：刷新回来 preview 为空，用户点一次"建任务并预览会话"即回
  （build 幂等性不在本 ADR 内，用户重建即新时间戳目录，旧目录仍在盘上）。

## 后果

- 好处：刷新回来直接是建完任务的现场——描述/勾选/taskDir/执行会话 id/回信都在，
  可接着 launch/collect，不用重扫重建。
- 代价：面板多了快照读写 + 挂载验盘一次 collect；localStorage 多一项 per-session 记录。
- 风险：快照与磁盘 taskDir 不一致时以验盘为准（过期即清 + 一键重建），不信任快照单方。

## 验证

- `tests/vitest/task-panel.test.ts`：`normalizeTaskSnapshot` 版本/形状/坏字段收敛；
  node 无 storage 时读 null、写/清不抛；空快照与 useState 初值同口径。
- `tests/src/client/test_invariants.py::test_client_task_snapshot_restore_wired`：
  快照三函数 + 恢复门 + 中性标记 + 过期重建四件套齐全。
- 真机：建任务 → launch → 刷新 → 面板恢复 taskDir/会话 id/回信；
  手动删 taskDir → 刷新 → 红错 + 一键重建；换会话开面板 → 白纸。
