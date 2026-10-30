# T3: 实现与回归

Status: in_progress

**What to build:** 按 T2 冻结方案实现前台占位 turn + 全门回归。

**Blocked by:** 02-design.

- [x] host：start 后起占位 turn、心跳、取消→双停、结束收 turn
- [x] 中断映射：turn 取消 → abort → `interruptedAt` 落盘（单测覆盖）
- [ ] 真跑一局验证（3080，`✦ 增强会话` → 辩论 → 开始，随便什么小问题即可）：
  1. 起 turn：点开始后发起会话发送按钮变停止 + 出现"运行中…"蓝字
  2. 心跳：对话区见 `⏳/⚔` 直播行；面板镜像行示"前台占位 turn 已起"
  3. 双停：占位 turn 存续中点停止 → 后台跟停（`state` 变 stopped，对话区无新增）
  4. 收 turn：正常跑完 → 占位 turn 自动收，前台回 idle，结论落对话区 + 面板
- [x] 探针路由删除（T1 选项 a：`debug-followup`/`debug-parent` + 面板按钮已删）
- [x] 术语小改（"会话接管"→"双停与可观测"，docs 同步）+ vitest/pytest/arch 全绿
