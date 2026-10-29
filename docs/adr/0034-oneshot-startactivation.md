# one-shot 改走 `startActivation`：宿主 seam 换代，笼只留常驻线

2026-10-29 线上故障：`se-mvtbip75-1`（dashboard/core 补 manifest 辩论）
开题 R0 + 交锋 R1/R2 正常，停机 `saturation` 后进 `stepSynthesize` 即炸：
`error: subagents.start is not a function`，`mapText/decisionSummary/reportRel`
全空——结论死在最后一步。

## 根因

宿主 `SubagentRuntime` 已无 `.start(provider, req)`（具名 provider 注册表 +
`startActivation({ provider, label, request, signal, delivery })` 两段式），
而插件三处 one-shot 调用（`askSubagent` 制图/开题回退、`debug-child-tools`
探针、任务 `recommend`）仍走老签名。单线/常驻交锋能跑是因为它们走
`agents.create + followup`，只有 one-shot 通道全断。

附带：`SubagentStartRequest` 不再接受 `toolFilter`（只认
`cwd/agentPreset/prompt/parent/signal/agentOptions/…`），one-shot 描述子键集
`ONE_SHOT_DESCRIPTOR_KEYS = {version, mode, provider, label}`——`toolFilter`
只在 continuable 描述子里出现。所以一次性白名单笼**无处可挂**。

## 决定

1. `SubagentsLike` 改成 `startActivation` 最小面；`askSubagent` 改调
   `provider: 'spawn'` + `delivery: 'caller'`，`agentOptions` 照传，
   `toolFilter` 删掉（传了反而可能被拒）。
2. 探针与任务推荐两处老调用同迁；探针 `caged=true` 仍接受但恒为满血视角，
   回包 `cage: null` + `cageNote` 注明，不假装看到笼内视角。
3. 笼语义收窄：白名单笼（辩手 6 项 / 制图员 3 项）只挂常驻 / 单线 `setup`
   那条线；one-shot（制图 / 推荐 / 探针）是满血直调。`cageNote` 照常记录
   常驻线的生效笼型。
4. 回归：`debate.test.ts` 加 two 用例——spec 形状（spawn + caller +
   无 toolFilter）与非 completed 实报；`task-routes.test.ts` mock 换成
   `startActivation`。

## Considered Options

- **给 one-shot 另找挂笼的口**：新 seam 的请求体与描述子键集都没有
  `toolFilter` 位置，continuable 描述子的 `toolFilter` 只管可冷恢复的
  continuable 子会话。硬塞字段等于赌未知键被忽略——比明说满血更糟。否决。
- **one-shot 改走常驻对**：制图只读实录、无需记忆，常驻建对是重武器；
  且失败局要的是"用已落盘 transcript 重跑制图"，不是重开一局。否决。
- **只修 `askSubagent`，探针/推荐不动**：同属必炸路径，留着就是下一次
  `is not a function`。三处同迁。

## Consequences

- 制图 / 推荐 / 探针恢复可用；但 one-shot 子 agent 是满血的——prompt 里
  "不要调工具 / 只读实录"的约束仍在（制图输入已清洗，见 STOP v6），
  只是不再有系统层白名单兜底。QAS-4 的"制图员三项"改读为"常驻线有效，
  one-shot 线为约定"。
- ADR-0022 原文不改（历史决议留档），本条记偏差与收窄。
- `docs/architecture-debate.md` §4.2/§4.6 + `architecture-cross-tasks.md`
  §6 + `test_index.md` 用例数（269）同步更新。
