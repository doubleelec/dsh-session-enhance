# 会话区 vs 轨迹区：一页速查

> 来源:DSH 官方文档站 <https://deepseek-harness.github.io/deepseek-harness/>。
> 原始 Markdown 规律:页面 URL 去掉末尾斜杠再加 `.md`(根路径用 `/index.md`)。
> 全文索引见 `llms.txt`(同站根目录)。以下只摘与本插件相关的三条规则,
> 原文以文档站为准,这里是"踩过坑之后"的读法。

## 1. 消息进 surface 必须声明 surfaceOp

- 产生消息的事件只有五种(`SurfaceEventType`):`system/message`、
  `developer/message`、`user/message`、`assistant/message`、`tool/result`。
- 每个都必须带 `surfaceOp`(官方原话:"Required on message-producing events")。
  - `'append'`:尾部追加——user/assistant/tool 消息的常规路径。
  - `{ op:'replace', startSeq, endSeq }`:替换一段 surface 节点(压缩用)。
- 非 surface 事件(turn/step 边界、attempt、error)编译期拒绝带 surface 字段。
- `assistant/message` 不能带 `sourceEventSeqs`(它的 stream 就是证据);
  system/user/tool 需要引用来源时用完整非空 list,不需要时省略。
- 全部 `event.data` 必须 JSON 可序列化:`Session.append` 从源头强制,
  不可序列化直接抛,不会进日志。

出处:[session.md](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session) `#surface-types` / `#the-request-header-event-requestheader`。

## 2. transcript ≠ surface:人类可读记录是另一个投影

- surface(派生模型历史)会有意遮蔽替换概括的范围;人类看的 transcript
  读的是日志中追加来源的事件,是另一个投影(`isAppendSurfaceEvent`)。
- 推论:同一份日志,会话区与轨迹区看到的不一样是设计使然,不是 bug。
  想让一条消息进会话区,要过的是 conversation 组装那一关(下一条),不是
  "写进日志就行"。

出处:同上,`SessionEvent` / `SurfaceIntent` 节。

## 3. 谁进会话区:conversation 组装 + groupTree

- `ui-conversation` 是 target-neutral 组装层;`ui-chat`(会话区)与
  `ui-trajectory`(轨迹区)各有自己的 Definition、State、最终 node。
  同一个持久 event family 可以被两边同时识别,但各留各的 State。
- 新业务想在会话区露出行:给 chat target 注册 `ConversationNodeDefinition`
  (`ctx.uiConversation.events.register`),`target:'chat'`,并实现
  `match` / `start` / `update` / `buildViewNode`。
- `match` 只做身份提取(返回内部 id + start/update 角色),不做 fold;
  不能把"最近一个未完成"当归属(Client 绝不能猜)。
- `groupTree` 决定节点落在哪一行(只读这个,不读别的):
  - `exchange`:认领的人的输入,开启一个交互段;
  - `input`:轮次的其他输入(开场输入/触发通知);
  - `turn`:整轮折叠之外的轮次通知(错误/页脚);
  - `process`:整轮折叠会隐藏的独立行(模型重试);
  - 不声明:并入相邻步骤组的普通过程内容。
- 同一 target 的通用 Definition 也会匹配你的事件时,用 `exclusive:true`
  认领;否则两边各画各的,就会出现"会话区看不到、轨迹区有"的现象。
- 实时 delta 走 Client-only `assistant/live-chunk`,与持久 settlement
  共用同一组匹配/update 接口;`publication` 控制发布节奏
  (`immediate` / `animation-frame` / `none`)。

出处:[conversation.md](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/conversation) 全文,
特别是 `#definition-and-typed-chat-payload` 与 `#group-definitions`。

## 4. 本插件当前路线与官方路径的对照

- 现状(A 路线按轮唤醒):占位 turn 里的模型以 assistant 身份发小结,
  走的是内置 assistant Definition + 轮次输入判断,天然进会话区。
  没注册自定义 Definition,所以细节只能走 mirror(轨迹区折叠)。
- 官方正路(后备):注册 chat target 的自定义 Definition(如 `review-job`
  示例),`groupTree` 声明位置,细节进 State、摘要进 node data。
  这样"每轮一行 + 展开看细节"可以在会话区原生折叠,不依赖模型复述。
  代价:要写 client 侧 Definition + renderer,比现在重;等 A 路线验证
  不够用时再走。

## 5. 开发文档入口(按可信度排序)

1. 官方文档站:https://deepseek-harness.github.io/deepseek-harness/
   (llms.txt 为全文索引;`develop/basic/tool.md` 讲 defineTool,
   `develop/basic/publish.md` 讲打包安装,`reference/subsystems/subagent.md`
   讲 fork/交棒)。
2. 社区实测(dshbase,非官方):插件全流程
   https://dshbase.com/blog/wx-deepseek-harness-plugin-development-tutorial/
   ;零基础教程 https://dshbase.com/plugins/hello-dsh/
   (含 web profile 默认禁用 skills、stale 进程占 3080 等坑)。
