# T2: 方案冻结

Status: resolved

**What to build:** 按 T1 探针结论冻结实现方案，写成 ADR（ADR-0027），更新 architecture-debate §4.4 时序。

**Blocked by:** 01-probe.

- [x] 三个走向三选一：前台占位 turn 可做 / 降级（面板常驻提示）/ 放弃（接受后台模式 + 术语重命名）
- [x] 可做：定占位内容、心跳节拍、取消→双停链路、中断映射
- [x] ADR 落地 + architecture.md §4.4a 时序补占位 turn 泳道

## Comments

### ADR 编号顺延提醒（2026-10-21，维护巡检）

T2 落笔时 ADR 请用 **0027**（0026 已被任务面板 `0026-task-autofill-preview.md`
占用）。`architecture.md` §5 的 ADR 列表目前到 0026 为止，T2 落地时同步加 0027 行。

### T2 冻结结论（2026-10-29，ADR-0027）

- 走向：**可做**（T1 源码 + 实测双证，Q1-Q4 全答，无需降级）。
- 方案：重注册唯一阻塞式 hold 工具（`inject` 加回 `tools`，全 DSL，
  `output.render` 必需）；`/api/start` 后 `followup` 拉起占位 turn，模型调 hold
  工具挂起即运行态；心跳 = turn 活着 + mirror/`progress` 旁路；双向收尾
  （前停 abort 后台，后停 cancel 前台再终局）。
- S28 修订为"唯一 hold 工具例外"：manifest/WIRE-01/门禁 T3 同改。
- 详见 `docs/adr/0027-foreground-placeholder.md`；架构同步见
  `docs/architecture-debate.md` §4.4/QAS-5/§5 与 `docs/architecture.md` §5。
