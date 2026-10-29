# ADR-0035 — 脏输出留痕不拦停、制图失败不断局、镜像噪声同源

- 状态：已采纳（2026-10-29）
- 上下文：旧局 `se-mvtbip75-1` 三连败——R2 builder 15 字脏输出（无三段、无 agree/answer）
  照常进停机判定；停机后制图 one-shot 炸（`subagents.start is not a function`，
  ADR-0034 已修 seam）整局 failed 无结论；对话区 `**交锋…` 标题进背景包污染下一局问题。

## 决定

1. **H3 结构门只审计不 gate**：`missingSections` 点名缺段，`rounds[].malformedSides`
   留痕（可选字段，老记录缺即 undefined，不 bump 版本，ADR-0021），host 侧 mirror
   告警一行。脏输出仍落 transcript——拦停机等于把"模型写崩"伪装成"机制修好"，
   违反 ADR-0032（能力缺失是缺陷，不是退化理由）。
2. **H5 制图失败不断局**：`stepSynthesize` 抛错（非 abort）时用 `buildFallbackSummary`
   拼兜底摘要，整局按 done 收，`error` 记 `synthesizer-failed:<原因>`。交锋实录仍在，
   整局 failed 让用户白等是最糟的结果。
3. **镜像噪声口径同源**：`isMirrorNoise` 导出，host 的 `lastUserText` 与
   `extractSessionContext` 共用同一份正则；`⏳` 开写行与 `**` 标题一律可识别。
   开写镜像连续相同去重（互盲开题连调两次同一文案）。
4. **H1 开题角色直通**：`stepOpen` 的 `runOne` 按 `role` 传参（label/路由/笼子），
   回归前两侧全挂 builder。互盲开题 prompt 两侧同形是设计（挑战者钢人化从第 1 轮开始），
   不动。

## 后果

- 脏输出可观测（rounds + 对话区告警 + 面板），不停机、不重试、不静默。
- 制图挂了仍有结论（fallback 摘要 + 文档 + 对话区收尾），error 点名制图失败。
- 下一局问题不再被本局镜像污染；用户在自己会话里即见开写/写完/收尾。
- 回归：`debate.test.ts` +3（H3 缺段留痕、镜像噪声、H1 label/路由直通）。

## 验证

- `npm run test:sandbox` 272 pass；`npm run typecheck` clean；`pytest tests/` 34 passed。
