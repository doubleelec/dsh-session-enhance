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
- [x] 非目标确认：对话框不自动关闭（spec Out of Scope）——收尾只 cancel 占位
  turn，对话框由用户手动关；真跑验证不验此项

## Comments

### 真跑环境坑：GUI 跑的是 profile 副本，不是工作区构建（2026-10-30 实测）

真跑验证一开始两次 `placeholderRaised` 都是空、`/api/debug` 工具表只有
`working_directory`，白查了一轮。根因与证据：

- GUI(3080) 加载的是 `~/.dsh/profiles/web/node_modules/@doubleelec/dsh-session-enhance`。
  该 profile 用 `file:` 依赖（`"@doubleelec/dsh-session-enhance": "file:D:/…/dsh-session-enhance"`），
  npm 装的是**拷贝副本**（对照 `dsh-shims` 用的是 `link:`，那份是活的）。
- 实测：副本 `lib/index.js` mtime = 2026-10-23 16:10:12，与 `/api/version` 报的
  `bundleMtimeMs` 分秒吻合；该文件不含 `debate_hold_foreground` / `placeholderRaised` / `se-hold-`。
  工作区 `lib/index.js` 是当天 08:52 构建（217,638B，三标记全在）。
- 所以 `npm run build` **不会**让 GUI 生效。必须把 `lib/index.js`、`lib/client.js`、
  `dsh.plugin.json` 拷进 profile 副本，再重启宿主。

两个可观测性结论（已改一处）：

- `/api/version` 的 `bundleMtimeMs` 是**磁盘文件 mtime**，不是内存里跑的那份代码的版本。
  进程启动后覆盖文件，这个值会变新，但内存仍是旧代码——它只能配合 `stale` 判断
  "要不要重启"，**不能**当作"新代码已生效"的证据。
- 旧写法（可选链 + 外层 catch）在 tools 服务缺失时**静默不注册**，占位链整体消失却无痕迹。
  已改为显式判空 + 记录原因，并经 `/api/version` 暴露
  `holdTool: { name, registered, error }`。判据：`registered:true` 才算工具在位。

投递步骤（每次改 host 代码后）：

1. `npm run build`
2. 拷 `lib/index.js` / `lib/client.js` / `dsh.plugin.json` 到 profile 副本
3. 重启宿主
4. `/api/version` 确认 `stale:false` 且 `holdTool.registered:true`
5. 再跑上面四步真跑检查单

可选的根治（未做，需业主拍板）：把该依赖从 `file:` 改成 `link:`（与 `dsh-shims` 一致），
之后 `npm run build` 即生效，省掉第 2 步。
