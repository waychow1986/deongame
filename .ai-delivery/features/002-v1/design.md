# DeonGame 精致化：标准象棋棋盘、真实扑克牌与大厅体验 技术方案

> 依据：已确认意图第 2 版（含 Q1～Q4、R1～R3 答案）、规格 `spec.md`、系统现状 `.ai-delivery/system-current.md`（以下简称“现状”）与仓库代码。`g2Decisions` 为空。
> 本文只写本次改什么；现有模块、接口、数据、部署与约定以现状为准，不重写。
> 编号：TD-n 技术决定；E-n 实验（命令与结果只在“快速验证指南”中写一次）；H-n 待验证假设。

## 技术上下文（Technical Context）

### 不确定项与结论

| 编号 | 会改变决定的不确定事实 | 结论 | 证据 |
|---|---|---|---|
| U-1 | 服务端按真实棋盘（含暗子真实身份）算出的“可走位置”下发给走棋方，是否可能因暗子身份不同而不同，从而泄露暗子身份（决定 TD-005 能否由服务端下发可走位置） | 不会。项目代码中盖着的棋子按所在位置的开局类型走（`effectiveType`）；自将判断只看对方棋子的攻击与占位，己方被移动棋子的身份不参与；对 200 局随机对局、356,187 个“局面×棋子”在打乱双方暗子身份前后比较 `legalMoves`，0 处不同 | `src/shared/xiangqi/index.ts` 的 `effectiveType`、`pseudoMoves`、`isInCheck`、`legalMoves`；实验 E-1 |
| U-2 | Playwright 手机模拟（项目 e2e 使用的 `Pixel 7`）下，媒体查询 `(pointer: coarse)` 与 `(hover: none)` 是否为真（决定 TD-016 用什么判断“手机浏览器”，并影响测试能否在 Chromium 中观察 FR-094 提示） | 手机模拟下两者都为真，Desktop Chrome 下都为假 | 实验 E-2 |
| U-3 | 第一版“登录后直接进入上一次的房间”的根因 | 大厅页面加载时读取 `GET /api/me` 的 `currentRoomId`，非空即 `navigate('/room/…')`；登录成功后跳到 `/lobby`，于是立刻被转到房间。服务端没有自动进入房间的逻辑 | `src/web/pages/LobbyPage.tsx` 第 30–31 行；`src/server/http/authRoutes.ts` 第 29 行 |
| U-4 | 第一版棋子不在交叉点的根因 | 棋盘是 9×10 个按钮的网格，每个棋子画在按钮（方格）中心，没有画线，线与交叉点的概念不存在 | `src/web/components/ChessBoard.tsx`（`rows.map/cols.map` 渲染 `button.sq`） |
| U-5 | 第一版红黑暗子分不清的根因 | 暗子统一渲染为文字“暗”加样式类 `covered`，与阵营无关 | `src/web/components/ChessBoard.tsx`（`sq.piece === 'hidden' ? '暗'`） |
| U-6 | 摊牌时“赢家组成的 5 张牌”服务端是否已有 | 牌型评估 `evaluateHand` 已返回 `best`（5 张），但手牌状态的 `showdown` 只存了 `holeCards` 与 `handRank`，视图中没有最佳 5 张 | `src/shared/poker/evaluator.ts` 第 81–106 行；`src/shared/poker/hand.ts` 第 43、283–292 行；`src/server/rooms/view.ts` |
| U-7 | 是否已有退出登录接口 | 没有：现状接口表无 logout，`authRoutes.ts` 只有注册、登录、`/api/me` | 现状“REST 接口”；`src/server/http/authRoutes.ts` |
| U-8 | 扑克房间人数上限 < 9 时，零头分配顺序（`pots.ts` 以 `POKER_CAPACITY` 取模）是否仍按“庄家之后顺时针” | 是：座位数组保持 9 个，`(seat - dealer - 1 + 9) % 9` 对任意在用座位子集保持“庄家之后顺时针”的先后，规则不变 | `src/shared/poker/pots.ts` 第 18 行 |

已写明、直接引用而不做实验的事实：

- socket.io 客户端默认自动重连，触发 `disconnect`、Manager 的 `reconnect_attempt`、`reconnect` 与 socket 的 `connect` 事件（socket.io 4.x 官方文档 “Client API / Manager events”）；服务端在每次连接时向当前房间成员推送一次 `room:state`（现状“实时推送”）。
- 浏览器自动播放策略：`AudioContext` 须在用户手势中创建或 `resume()` 后才能出声，iOS Safari 同样（MDN “Autoplay guide for media and Web Audio APIs”）。意图假设 13 已接受“首次点按前不播放”。
- `element.animate()`（Web Animations API）、CSS `aspect-ratio`、`dvh` 单位在意图假设 12 列出的当前版本浏览器中均受支持（MDN 各条目的浏览器兼容表）。
- 仓库已有的测试隔离方式（集成测试每个 worker 一个 schema，e2e 每次运行一个 schema 与端口）见现状“测试”。

## 治理与技术约束

| 约束 | 出处 | 设计响应 |
|---|---|---|
| 保持已批准的业务意图与范围；规则不变（AC-36、FR-100） | 宪章“产品与架构”；意图范围 6 | 不改 `src/shared/xiangqi`、`src/shared/poker` 的规则函数与 `src/shared/ai`；只在扑克手牌状态中多记录最佳 5 张（不影响结算，TD-007）。规则相关的现有单元/集成测试全部保留并须通过 |
| 最简单架构 | 宪章“产品与架构” | 仍是单体服务 + 单个 PostgreSQL；不新增依赖服务、不新增 npm 运行时依赖（TD-001）；大厅用轮询而非新推送通道（TD-004） |
| 凭据留在服务端；不记录 secret 与客户内容 | 宪章“安全与隐私” | 新增退出登录只删除会话散列记录并清除 Cookie；日志新增事件只记用户 id（TD-009） |
| 验证输入、最小权限 | 宪章“安全与隐私” | 新增 `capacity` 参数严格校验整数 2～9（TD-003）；可走位置只发给走棋方本人且经 E-1 证明不泄露暗子身份（TD-005） |
| 每项用户可见能力有可独立执行的验收场景；外部集成用真实服务 | 宪章“测试与质量” | 可测性约定一节为每个新增能力给出公开观察点；集成测试继续连真实 PostgreSQL |
| 房间状态只经 `viewFor` 输出；改房间的操作在房间锁内并使 `version` 加 1；随机性经 `Rng` 注入；业务错误抛 `AppError` | 现状“约定” | 新字段（`legalMoves`、`bestCards`）都在 `viewFor` 中按查看者生成；隐式释放已结束房间复用 `leave` 的锁路径 |
| 前后端共用 `src/shared/`；服务端 `.js` 后缀导入；ESLint 规则 | 现状“约定” | 新增的纯函数（房间可加入判断、快照差异→事件、座位布局、加注快捷金额）放 `src/shared/ui/`，可在 node 环境单元测试 |
| 已有 CI、部署脚本、基础设施定义保持原样 | 本步骤边界 | `Dockerfile`、`docs/deployment.json` 的服务定义、`docs/dependencies.json`、`deploy/probes/postgres.sh` 不改 |

## 架构概览（Architecture）

部署形态、进程、数据库与第一版相同（现状“概览”）。本次改动分布：

```
浏览器（React SPA）                                   Node 单体服务
┌──────────────────────────────────────────┐        ┌───────────────────────────────────────┐
│ AuthPage（新样式、中文错误）               │  REST  │ authRoutes  +POST /api/auth/logout     │
│ LobbyPage（顶栏/游戏卡片/开房弹窗/房间列表）│◀──────▶│ roomRoutes  POST /api/rooms +capacity  │
│   └ 每 2 秒轮询 /api/rooms 与 /api/me        │        │             /api/me +activeRoomId      │
│ RoomPage（回到大厅/离开房间确认/静音/连接条）│ socket │ RoomManager 隐式释放已结束象棋房间      │
│   ├ ChessBoard（SVG 线 + 交叉点按钮 + 动画） │◀──────▶│             扑克座位按 capacity 限制    │
│   └ PokerTable（椭圆牌桌/牌面/操作区/动画）  │        │ view.ts    +legalMoves +bestCards      │
│ shared/ui：差异→事件、可加入判断、布局计算    │        │ hand.ts    showdown 多记 best（仅展示） │
│ audio：Web Audio 合成音效 + 静音             │        └───────────────────────────────────────┘
└──────────────────────────────────────────┘
```

客户端渲染流水线（房间页）：`room:state`/REST 响应 → 版本过滤（沿用）→ 快照队列 → `diffChess/diffPoker(prev, next)` 得到事件列表 → 驱动动画（公开阶段 `data-anim`）与音效（`deongame:sound` 事件）→ 动画结束后呈现 `next`。

## 技术决策与替代方案

| 决策 ID | 选择 | 理由 | 已考虑替代方案 | 证据 | 来源 |
|---|---|---|---|---|---|
| TD-001 | 视觉全部用手写 CSS（CSS 自定义属性作设计令牌）+ 内联 SVG（棋盘线、花色、图标、牌背）；不引入 UI 组件库、图标库、字体文件或图片素材；字体用系统中文字体栈（正文 `"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif`，棋子字 `"STKaiti","KaiTi","Noto Serif SC",serif`） | 满足 AC-30 的统一风格只需一套令牌；无新依赖、无外网字体请求、包体小；SVG 随容器等比缩放（AC-13） | Tailwind/组件库（新增构建依赖，收益小）；位图牌面与木纹图片（需要素材来源与授权，缩放发虚）；网页字体（测试环境出站受限，见 `runtime/candidate.md` 网络默认拒绝） | 现状“技术栈”；`runtime/candidate.md` | FR-090、FR-030、FR-072 |
| TD-002 | 进入大厅：删除 `LobbyPage` 加载时按 `currentRoomId` 自动跳转；`UserDto` 新增 `activeRoomId`（用户所在房间未关闭时为房间 id，否则 null），大厅据此显示“回到对局”与禁用开房/加入；房间页 `/room/:id` 刷新时行为不变 | 修正根因 U-3；`/` 与其他路径已重定向 `/lobby`（现状“前端”），重新打开网站即进大厅；房间页本就先 `GET state`，刷新仍停留 | 服务端登录时清除 `userRoom`（会丢座位，违反 Q1）；保留 `currentRoomId` 语义改为“未结束”（会改变既有字段含义，旧测试依赖它） | U-3；`src/web/main.tsx` | FR-001～FR-004、FR-007、FR-008 |
| TD-003 | `POST /api/rooms` 请求体新增可选 `capacity`：仅 `game:"poker"` 时读取，须为整数 2～9，缺省 9，否则 `400 VALIDATION_FAILED`；房间 `capacity` 取该值。扑克座位数组仍为 9 个，`pickFreeSeat` 只在下标 `< room.capacity` 中选；`addPokerBot` 增加 `occupiedCount(room) >= room.capacity` → `ROOM_FULL` | 加入路径已按 `occupiedCount >= capacity` 判满（现状“房间”）；座位下标限制在 `0..capacity-1` 使牌桌只画 `capacity` 个座位；座位数组长度不变，`pots.ts` 零头顺序不变（U-8） | 座位数组按容量创建（需核对所有按 9 取模的代码，风险大于收益） | `src/server/rooms/roomManager.ts` `join`/`addPokerBot`/`pickFreeSeat`；U-8 | FR-020、FR-022、FR-101 |
| TD-004 | 大厅自动更新用轮询：大厅页每 2 秒并行请求 `GET /api/rooms` 与 `GET /api/me`；页面不可见（`document.visibilityState==='hidden'`）时暂停，可见时立即请求一次；连续 1 次请求网络失败即显示“连接已断开，正在重连…”，下一次成功后消失 | 2 秒周期保证 5 秒内显示变化（AC-8）；同时刷新顶栏积分/筹码与 `activeRoomId`（FR-008、FR-011）；无需在建房、加入、离开、开局、结算、电脑自动行动等十余处补推送；请求只读内存与一条用户查询，负载可忽略 | 新增 socket 频道 `lobby` 推送房间列表（需在所有改变房间的入口与后台任务处广播，改动面大、易漏） | 现状“实时推送”“REST 接口” | FR-019、FR-011、FR-008、FR-096 |
| TD-005 | `ChessView` 新增 `legalMoves: Record<string,string[]> \| null`：对局 `active` 且轮到查看者时，为查看者每个有合法着法的棋子给出 `legalMoves(board, from)`（服务端真实棋盘）；其他情况为 null。前端小圆点只用它，不在前端重算 | 与服务端走棋校验同一函数，保证“与规则允许位置完全一致”（AC-16）；E-1 证明结果与暗子身份无关，不泄露 | 前端用共享引擎在“占位身份”棋盘上重算（同样正确，但需构造假身份棋盘，且要另证一致）；不提示可走位置（不满足需求） | U-1；实验 E-1 | FR-040、FR-043 |
| TD-006 | 已结束的象棋房间“隐式释放”：`create`、`createAiGame`、`join` 在全局锁内先检查 `userRoom` 指向的房间，若该房间 `closed`（象棋已结束），先执行与 `leave` 相同的离开逻辑（成员移除、无人则删除、向剩余成员推送），再继续；`activeRoomId` 对已关闭房间为 null | 规格“进行中的对局”在象棋结束即失效（FR-008、A-2），用户不在房间页时也能直接开新房；结束后成员仍留在房间内，结果画面可继续显示（现状“对局结束…成员仍在房间内”）；“再来一局”直接调用建房接口即可（FR-063） | 结束时立即把双方移出房间（正在看结果画面的用户拿不到结果与结算重试推送）；新增“再来一局”专用接口（Q2 只要求“以同样设置开新房”，复用现有接口更简单） | `RoomManager.leave`、`finishChess`（`room.closed = true`） | FR-008、FR-062、FR-063 |
| TD-007 | 扑克摊牌：`hand.ts` 的 `showdown` 条目增加 `best: Card[]`（`evaluateHand` 已算出）；`PokerView.showdown[]` 增加 `bestCards`。前端对 `winners` 中各座位按 `showdown` 取 `bestCards` 高亮、显示 `handLabel` 与赢得额；`stage:"complete"`（只剩一人）显示“{名} 赢得底池 +{额}”且不翻牌 | 只是保存已算出的数据，不改变比较与分池；平分时每个赢家各自高亮（意图假设 14） | 前端重新评估牌型（重复规则代码，需在前端打包评估器且有不一致风险） | U-6 | FR-085、FR-086 |
| TD-008 | 认证页出错文案：服务端把超长校验改为分项消息“用户名不能超过 200 个字符”“密码不能超过 200 个字符”；前端 `fetch` 抛错（网络失败）时显示“网络连接失败，请检查网络后重试”；其余沿用 `ERROR_MESSAGES` | FR-023 要求指出哪一项；第一版超长只有通用“请求参数不合法” | 只在前端校验长度（服务端仍是通用消息，直接调接口的情况不一致） | `src/server/http/authRoutes.ts` 第 17–19 行；`src/web/api.ts` `errorMessage` | FR-023 |
| TD-009 | 新增 `POST /api/auth/logout`：从 Cookie 取令牌，删除对应 `sessions` 行（按 SHA-256 散列），以 `Max-Age=0` 清除 `dg_session`，返回 `204`；无 Cookie 或会话不存在也返回 `204`；不离开房间（座位按 Q1 保留）；记 `user_logged_out`（info，只含 userId） | AC-4 需要退出登录且再访问需登录；现状没有该接口（U-7）；不离开房间，与“回到大厅不退出对局”一致 | 只在前端删 Cookie（`HttpOnly` 无法从脚本删除）；退出时同时离开房间（会认输，用户未要求） | U-7；`src/server/auth/sessions.ts` | FR-012 |
| TD-010 | 象棋棋盘几何：棋盘组（`role=group`“棋盘”）是宽高比固定 9:10 的方块（CSS `aspect-ratio: 9 / 10`），内部划分 9 列×10 行等大正方形单元，第 c 列第 r 行（显示坐标）的交叉点在单元中心 `((c+0.5)/9·W, (r+0.5)/10·H)`；网格线、河界文字、九宫斜线、炮兵位折角标记用同一坐标系的 SVG（`viewBox="0 0 90 100"`，`preserveAspectRatio` 默认）画出；每个交叉点一个按钮，按钮即该单元（边长=交叉点间距），棋子画在按钮中心，直径为间距的 88%；黑方视角整体旋转 180°（沿用第一版）；木纹底与边框在棋盘组外层容器，用多层 `repeating-linear-gradient`/`radial-gradient` | 线与棋子同一坐标系，棋子中心必然在交叉点（AC-12）；按钮即 R1 规定的点按区域（FR-044）；等比缩放由 `aspect-ratio` 与 SVG 保证（AC-13） | Canvas 绘制（无障碍与定位测试困难）；网格 + 伪元素画线（易出现第一版的方格错位） | U-4；A-17 | FR-030～FR-032、FR-044 |
| TD-011 | 棋盘尺寸：`width: min(100%, calc((100dvh - 顶部与状态区高度) * 0.9))`，最大 640px；手机竖屏 360px 宽时页面左右内边距 8px，棋盘宽 344px、交叉点间距约 38px | 保证完整显示、无横向滚动（AC-34）、电脑端缩放不超出视口（AC-13） | 固定像素（不能缩放） | MDN `dvh` | FR-032、FR-095 |
| TD-012 | 棋子外观：圆形按钮内层元素，`radial-gradient` 木色 + 内圈刻线 + `box-shadow` 立体阴影；翻开棋子字色红 `#c0392b`、黑 `#1f1f1f`；暗子背面：红方暗子为朱红底金色双圈边，黑方暗子为墨蓝黑底银色双圈边，两者不显示任何字；无障碍名称沿用第一版“{位置} 红暗子 / 黑暗子” | 背面底色与边框同时不同，不看位置也能分清（AC-15）；不在背面显示身份 | 只用边框颜色区分（较小屏幕上不够醒目） | U-5 | FR-033、FR-034 |
| TD-013 | 动画统一用 Web Animations API（`element.animate`），时长常量集中在 `src/web/anim/durations.ts`：象棋移动 300ms（FLIP：在终点渲染，从起点位移动画到终点）、暗子翻面 320ms（`rotateY` 0→90° 换面→0）、被吃棋子消失 260ms（在终点叠一层被吃棋子快照，缩放+淡出）；扑克发牌每张 120ms（从牌桌中央飞到座位）、筹码入池 380ms（一轮下注结束时各座位的下注筹码飞向底池）、公共牌翻开每张 260ms。动画进行时房间组件对外暴露阶段（见可测性约定），棋盘在 `data-anim` 不为 `idle` 时不接受点击 | 一处控制、可预测、可读阶段；WAAPI 可在 `finished` Promise 上串联，避免定时器 | CSS transition（串联与结束检测分散）；动画库（新依赖） | MDN Web Animations API | FR-050～FR-053、FR-075 |
| TD-014 | 快照队列：房间页把收到的新快照（版本更大才收，沿用）放入队列逐个播放；队列中积压超过 2 个时丢弃中间快照，直接呈现最新一个且不播放被跳过的动画；版本不连续（如重连后）不播放动画，直接呈现 | 对手/电脑的走棋在自己走棋后紧接到达时都能看到（AC-18）；积压时不让画面落后 | 每次直接替换为最新快照（电脑快速应对时看不到自己那步动画） | 现状“前端按 version 丢弃更旧快照” | FR-050、FR-075、FR-096 |
| TD-015 | 事件判定为纯函数 `diffChess(prev,next)`、`diffPoker(prev,next)`（`src/shared/ui/events.ts`），输出事件列表：象棋 `move`（`lastMove` 变化）、`flip`（`lastMove.revealed`）、`capture`（`lastMove.captured`）、`check`（`inCheck` 由假变真）、`end`（`result` 由空变非空）；扑克 `deal`（`handId` 变化）、`bet`（新增 `small_blind`/`big_blind`/`call`/`bet`/`raise` 记录）、`fold`（新增 `fold`/`leave_fold`）、`board`（公共牌张数增加）、`collect`（`committedThisRound` 合计归零且底池增加）、`win`（`winners` 由空变非空）。动画与音效都由这一份事件列表驱动 | 一处规则，单元测试可覆盖；不依赖服务端新增事件字段 | 服务端推送事件流（需要新协议与重放处理） | `src/shared/protocol.ts` 的 `ChessView`/`PokerView` | FR-050～FR-054、FR-075、FR-091 |
| TD-016 | 音效：`src/web/audio/sound.ts` 用 Web Audio API 以振荡器与噪声合成 9 种音效（无音频文件）；首次 `pointerdown`/`touchend`/`keydown` 时创建或 `resume()` `AudioContext` 并播放 1 帧静音缓冲完成解锁；静音状态保存在模块内存（同一页面会话中跨大厅/房间切换保持，刷新后恢复有声，R3、A-13）；“手机浏览器”判定为 `matchMedia('(pointer: coarse) and (hover: none)')`，为真且未静音时在房间页显示“听不到声音？请关闭手机静音模式” | 无素材授权问题、体积为零；解锁方式按 MDN 自动播放指南；判定方式在测试用的手机模拟中成立（E-2），不依赖 UA 字符串 | `<audio>` + 音频文件（需素材与授权）；`localStorage` 保存静音（R3 已决定不保存）；UA 嗅探 | MDN Autoplay guide；实验 E-2 | FR-091～FR-094 |
| TD-017 | 连接状态：房间页包装 socket.io 客户端事件为状态 `connecting`→`connected`→`reconnecting`（`disconnect` 后）→`connected`（`connect`）；每次 `connect`（含重连）后重新 `GET /api/rooms/:id/state` 并直接呈现（不播动画）；大厅按 TD-004 的轮询结果给出同样的状态；页面初次加载期间显示“加载中…” | socket.io 自动重连为文档行为；重连后服务端只推当前房间快照，主动拉一次确保最新 | 自写重连 | socket.io 文档；现状“实时推送” | FR-096 |
| TD-018 | 扑克座位布局：纯函数 `seatLayout(capacity, mySeat)` 返回每个座位在椭圆上的位置（百分比）：显示序号 k=(seat−mySeat+capacity)%capacity，角度 θ=90°+k·360°/capacity（屏幕坐标，y 向下），即自己在正下方、按座位号顺时针排列；宽屏为横向椭圆（宽:高=2:1），宽度 < 600px 时为纵向椭圆（宽:高=3:4），座位卡片在手机上缩为“名/筹码/下注/状态”两行 | 自己固定在下方、各人画面只是旋转（A-8）；手机竖屏放得下 9 个座位 | 固定 9 个座位槽位（容量小时空位多） | 现状“德州扑克”（顺时针） | FR-070、FR-071、FR-095 |
| TD-019 | 加注控制：滑块（`input type=range`）+ 数字输入框 + 快捷金额“半个底池”“一个底池”“最大”；取值区间 `[legal.minRaiseTo, legal.maxRaiseTo]`（服务端已按每手上限 1000 算出）；快捷金额目标为 `本轮已下注 + 跟注额 + round(比例 × (底池 + 跟注额))`，夹到区间内；输入超出区间时显示“加注金额须在 {最小}～{最大} 之间”且“加注”按钮置灰；提交 `type` 在 `legal.bet` 时为 `bet`，否则 `raise`，`amount` 为本轮总额（沿用现状语义）；`legal.bet` 与 `legal.raise` 都为假时“加注”置灰 | 一律以服务端给出的区间为界，不能提交超上限金额（AC-26）；计算放 `src/shared/ui/raise.ts` 便于单测 | 只提供快捷金额（不满足滑块或输入） | 现状 `PokerView.you.legal`、行动规则 | FR-080～FR-083 |
| TD-020 | 大厅房间可加入判断为纯函数 `joinState(item, hasActiveGame)`：有进行中的对局 → 不可加入，原因“你有进行中的对局”；`item.full` → “已满员”；象棋且 `status==='playing'` → “对局中”；否则可加入。房间名 `roomName(item)` = `${hostUsername}的房间`。服务端 `RoomListItem` 不变 | 现有字段足以判定（Q4：扑克对局中可加入）；判定与文案一处定义 | 服务端新增 `joinable/reason` 字段（与查看者相关的判断混入共享列表接口） | 现状 `RoomListItem`、`RoomManager.join` | FR-015、FR-017 |
| TD-021 | “回到大厅”只 `navigate('/lobby')`；“离开房间”先显示确认对话框，确认后 `POST leave` 再进大厅；象棋结果画面“回到大厅”= `POST leave`（结束的房间）后进大厅；“再来一局”= 人机：`POST /api/chess/ai-games`，联机：`POST /api/rooms {game:"chess"}`（TD-006 隐式释放），成功后进入新房间 | Q1、Q2 答案；无新接口 | — | 现状 REST 接口 | FR-005、FR-006、FR-062、FR-063 |
| TD-022 | 简短提示（toast）：房间页一个 `role=status` 区域，显示一句话，2.5 秒后自动消失，新提示替换旧提示；象棋点按判定在前端：不是自己的回合点棋子→“还没轮到你”；未选中时点对方棋子→“这是对方的棋子”；已选中时点非小圆点的空位或对方棋子→“这里不能走”；走棋被拒→显示服务端中文消息并用 `GET state` 恢复最新局面 | 意图假设 8、A-18 | 弹窗提示（需要关闭，不符合“简短提示”） | — | FR-041、FR-043、FR-084 |

## 技术先后依赖

- `src/shared/protocol.ts` 中新增的字段（`UserDto.activeRoomId`、`ChessView.legalMoves`、`PokerView.showdown[].bestCards`）必须先于使用它们的前端组件与服务端 `view.ts`/`authRoutes.ts` 改动，因为前后端共用这些类型，`npm run typecheck` 对两侧同时检查。
- `src/shared/poker/hand.ts` 在 `showdown` 中记录 `best` 必须先于 `view.ts` 输出 `bestCards`，因为视图只是转发手牌状态中的数据。
- `RoomManager` 的隐式释放已结束房间（TD-006）必须先于结果画面“再来一局”的前端改动，因为“再来一局”直接调用建房接口，没有隐式释放时会得到 `409 ALREADY_IN_ROOM`。
- `POST /api/auth/logout`（TD-009）必须先于大厅“退出登录”按钮，因为 `HttpOnly` Cookie 只能由服务端清除。
- `POST /api/rooms` 的 `capacity` 参数与 `pickFreeSeat`/`addPokerBot` 按容量限制（TD-003）必须先于开房弹窗的人数上限控件，因为控件提交的值由服务端校验并决定入座上限。
- `src/shared/ui/` 下的纯函数（`events.ts`、`lobby.ts`、`raise.ts`、`seatLayout.ts`）必须先于引用它们的 `ChessBoard`、`PokerTable`、`LobbyPage` 与音效模块，因为后者从它们导入。
- 现有 e2e 用例（`e2e/*.spec.ts`）对按钮文字与房间列表文字（如“开中国象棋房间”“可加入”“已满”“离开房间”行为）有依赖，必须与改变这些文字或行为的前端改动同一次提交更新，否则仓库中的 e2e 立即失效。
- 设计令牌（`src/web/styles/tokens.css`）必须先于各页面样式文件，因为页面样式引用其中的自定义属性。

## 领域与数据模型

- 数据库：无变化，不新增迁移（`users`、`sessions`、`chess_results`、`poker_settlements` 原样；退出登录只删除 `sessions` 行）。
- 内存模型（`src/server/rooms/roomManager.ts`）：
  - `Room.capacity`：扑克房间取开房时的 `capacity`（2～9，缺省 9），象棋仍为 2。
  - 扑克 `seats` 仍为 9 个元素；只有下标 `< capacity` 的座位会被分配。
  - `HandState.showdown[]`（`src/shared/poker/hand.ts`）新增 `best: Card[]`（5 张，来自 `evaluateHand(...).best`）。
- 前端状态（只在浏览器内存）：静音开关（模块级变量，刷新即恢复有声）；音频解锁状态；房间页快照队列；象棋选中棋子；简短提示文字。
- 不变量（沿用并新增）：
  - `activeRoomId(user)` = `userRoom.get(user)` 且该房间未 `closed`；否则 null。
  - 用户最多属于一个未关闭房间；已关闭（象棋结束）房间的成员身份在该用户下一次建房/加入时自动解除。
  - `legalMoves` 只在“对局进行中且轮到查看者”时非空，内容只含查看者自己的棋子。
  - 暗子身份、他人未摊牌底牌的出口不变（`viewFor` 唯一出口）。

## Component 边界与项目结构

编码会创建或修改的路径（其余文件不动）：

服务端与共享代码：

- `src/shared/protocol.ts`（新增 `UserDto.activeRoomId`、`ChessView.legalMoves`、`PokerView.showdown[].bestCards`）
- `src/shared/poker/hand.ts`（`showdown` 条目记录 `best`，不改比较与分池）
- `src/shared/ui/`（新目录，纯函数）：`events.ts`（`diffChess`、`diffPoker`）、`lobby.ts`（`joinState`、`roomName`、`gameLabel`）、`raise.ts`（快捷金额与区间夹取）、`seatLayout.ts`（扑克座位椭圆布局）、`board.ts`（象棋显示坐标与交叉点几何、炮兵位标记位置）
- `src/server/rooms/roomManager.ts`（`create` 支持扑克 `capacity`；`pickFreeSeat` 按容量；`addPokerBot` 判满；`create`/`createAiGame`/`join` 隐式释放已结束房间；新增 `activeRoomId(userId)`）
- `src/server/rooms/view.ts`（输出 `legalMoves`、`bestCards`）
- `src/server/http/roomRoutes.ts`（`POST /api/rooms` 读取并校验 `capacity`）
- `src/server/http/authRoutes.ts`（`/api/me` 增加 `activeRoomId`；分项超长消息；新增 `POST /api/auth/logout`）
- `src/server/auth/sessions.ts`（新增 `revoke(token)`）、`src/server/auth/middleware.ts`（新增 `clearSessionCookie`）

前端：

- `src/web/main.tsx`（引入新样式入口；路由不变）
- `src/web/index.html`（`<meta name="theme-color">`、`lang="zh-CN"`、页面标题“DeonGame”；`viewport` 保留）
- `src/web/api.ts`（`createRoom(game, capacity?)`、`logout()`、网络失败文案）
- `src/web/socket.ts`（连接状态订阅）
- `src/web/pages/AuthPage.tsx`、`src/web/pages/LobbyPage.tsx`、`src/web/pages/RoomPage.tsx`
- `src/web/components/`：`ChessBoard.tsx`（重写）、`PokerTable.tsx`（重写）、新增 `ChessPiece.tsx`、`PlayingCard.tsx`、`SuitIcon.tsx`、`GameCard.tsx`、`CreateRoomDialog.tsx`、`ConfirmDialog.tsx`、`ConnectionBanner.tsx`、`Toast.tsx`、`MuteButton.tsx`、`TopBar.tsx`、`ChessResultDialog.tsx`、`PokerActionBar.tsx`、`Icons.tsx`
- `src/web/anim/`（新目录）：`durations.ts`、`chessAnim.ts`、`pokerAnim.ts`
- `src/web/audio/`（新目录）：`sound.ts`
- `src/web/hooks/`（新目录）：`useRoomFeed.ts`（快照队列、连接状态）、`usePolling.ts`
- `src/web/styles.css`（改为只 `@import` 下列文件）与 `src/web/styles/`（新目录）：`tokens.css`、`base.css`、`auth.css`、`lobby.css`、`chess.css`、`poker.css`

文档与测试：

- `docs/api.md`（新增接口与字段）
- `tests/unit/`：新增 `uiEvents.test.ts`、`lobbyUi.test.ts`、`raise.test.ts`、`seatLayout.test.ts`、`boardGeometry.test.ts`、`legalMovesView.test.ts`；修改 `roomManager.test.ts`、`pokerRoom.test.ts`、`chessRoom.test.ts`、`poker.test.ts`
- `tests/integration/`：修改 `auth.test.ts`（logout、分项消息、`activeRoomId`）、`rooms.test.ts`（capacity、隐式释放、再来一局）、`chess.test.ts`（`legalMoves`）、`poker.test.ts`（`bestCards`、容量满时加电脑）
- `e2e/`：修改 `auth.spec.ts`、`rooms.spec.ts`、`chess.spec.ts`、`ai.spec.ts`、`poker.spec.ts`；新增 `lobby.spec.ts`、`board.spec.ts`、`table.spec.ts`、`mobile.spec.ts`；`e2e/support/`（新增辅助 `geometry.ts`）
- `.ai-delivery/features/002-v1/runtime/deployment.json`（开发者命令，本步骤写出）

不改：`Dockerfile`、`.dockerignore`、`docs/deployment.json`、`docs/dependencies.json`、`deploy/probes/postgres.sh`、`src/server/db/**`、`src/shared/xiangqi/**`、`src/shared/ai/**`、`src/shared/poker/{cards,evaluator,pots}.ts`。

## 数据流、状态、并发与生命周期

- **隐式释放（TD-006）**：`create`/`createAiGame`/`join` 已在 `globalLock` 内；释放步骤在同一临界区内先进入旧房间锁（与 `leave` 相同的顺序：全局锁 → 房间锁），不引入新的锁顺序，不会死锁。释放后对旧房间剩余成员调用 `broadcaster.roomChanged`（由路由层根据 `RoomManager` 返回的受影响用户列表推送；`create`/`join` 返回值增加 `released?: RoomChange`）。
- **象棋一步的客户端生命周期**：点子（`data-anim=idle` 才接受）→ 前端按 `legalMoves[from]` 画小圆点 → 点小圆点 → `POST move` → REST 响应快照入队 → `diffChess` 得事件 → 动画（`moving`→`flipping`→`capturing` 依事件顺序，未发生的跳过）→ `idle` → 音效与动画同时触发（落子音在移动开始时，翻子音在翻面开始时，吃子音在消失开始时，将军/胜负音在动画结束时）。对手的走棋经 `room:state` 入队，同样处理。
- **扑克一次更新**：快照入队 → `diffPoker` → `dealing`（新手牌）/`collecting`（一轮下注结束）/`revealing`（公共牌增加）依次播放 → `idle`。操作区按钮在 `data-anim` 非 `idle` 时仍按 `you.legal` 可用（扑克动画不阻止行动，避免拖慢牌局；服务端会拒绝过期行动并按 FR-084 提示）。
- **大厅**：挂载时立即请求 `/api/me` 与 `/api/rooms`，之后每 2 秒一次；有 `activeRoomId` 时显示“回到对局”并禁用卡片与加入按钮；点加入时若返回 `409/404`，显示服务端中文消息并立即刷新列表（FR-018）。
- **结算延迟**：结果画面在 `result.settled=false` 时显示“积分结算中”，结算重试成功后服务端推送（沿用），画面自动更新（FR-061）。
- **页面切换**：`RoomPage` 卸载时关闭 socket（沿用）；静音状态在模块内存中跨页面保持；音频上下文在首次手势后复用。

## Interface 与契约（Contract）

契约位置：类型以 `src/shared/protocol.ts` 为准，文字说明在 `docs/api.md`（本次同步更新）。只列本次变化，其余见现状“接口”。

| 方法与路径 | 变化 | 请求 | 成功响应 | 错误 |
|---|---|---|---|---|
| `POST /api/auth/logout` | 新增 | `{}`（`Content-Type: application/json`，沿用写请求约定） | `204`，`Set-Cookie: dg_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax` | 无业务错误（无会话也 `204`） |
| `POST /api/auth/register`、`/login` | 超长输入的消息分项 | 不变 | 不变 | `400 VALIDATION_FAILED`，`message` 为“用户名不能超过 200 个字符”或“密码不能超过 200 个字符”（同时超长时报用户名） |
| `GET /api/me` | 新增字段 | — | `{user: {id, username, rating, chips, currentRoomId, activeRoomId}}`；`activeRoomId` 为用户所在且未关闭的房间 id，否则 `null` | 不变 |
| `POST /api/rooms` | 新增 `capacity` | `{game:"chess"}` 或 `{game:"poker", capacity?: 2..9 的整数}` | `201 {room}`，扑克 `room.capacity` 为所设值（缺省 9） | `400 VALIDATION_FAILED`（`capacity` 非整数或越界）；`409 ALREADY_IN_ROOM`（仅当已在未关闭房间） |
| `POST /api/rooms/:id/join`、`POST /api/chess/ai-games` | 已在已关闭（结束）房间的用户不再报 `ALREADY_IN_ROOM`，先自动离开旧房间 | 不变 | 不变 | 不变 |
| `POST /api/rooms/:id/poker/bots` | 按房间容量判满 | 不变 | 不变 | `409 ROOM_FULL`（已占座位数 ≥ `capacity`） |
| `room:state` / `GET state` 中 `chess` | 新增 `legalMoves` | — | `legalMoves: {"<from>": ["<to>", …]} \| null`；只在 `status:"active"` 且 `turn === yourColor` 时非空，只含有合法着法的己方棋子 | — |
| `room:state` / `GET state` 中 `poker.showdown[]` | 新增 `bestCards` | — | `{seat, holeCards, handRank, handLabel, bestCards: [5 张牌面编码]}` | — |

前端展示约定（与可测性约定共用）：

- 牌面编码 → 显示：点数 `T`→“10”，`J/Q/K/A` 原样；花色 `s` 黑桃 ♠ 黑、`h` 红桃 ♥ 红、`d` 方块 ♦ 红、`c` 梅花 ♣ 黑；无障碍名称沿用第一版 `cardLabel`（`src/shared/poker/cards.ts`，如“红桃10”）；牌背名称“牌背”。
- 房间列表游戏类型文字：“中国象棋·盲棋”“德州扑克”；状态文字：`waiting`→“等待中”，`playing`→“对局中”。

## 可测性约定

本节只写本次新增或改变的约定；鉴权、造数（`POST /api/auth/register` 注册即登录，用户名前缀 `qa_<运行编号>_`）、e2e 启动方式与延迟变量沿用现状“测试”“环境变量”。

### 接口契约位置

`src/shared/protocol.ts`（类型）与 `docs/api.md`（说明）；本次变化见上一节表格。

### 关键控件的无障碍角色与可见名称

定位一律用角色 + 名称（括号内为补充的公开观察点）。“沿用”表示第一版已有、本次保持。

| 页面 | 控件 | 角色 / 名称 | 公开观察点与取值 |
|---|---|---|---|
| 全部 | 连接状态条 | `status` / “连接状态” | 属性 `data-state`：`loading`（文字“加载中…”）、`ok`（无文字，不可见）、`reconnecting`（文字“连接已断开，正在重连…”）。始终存在于 DOM |
| 登录/注册 | 表单 | 输入框 `textbox` “用户名”、密码框（`label` “密码”）；按钮 “登录” / “注册”；错误 `alert` | 错误文字见 TD-008 与 `ERROR_MESSAGES` |
| 大厅 | 顶栏 | `banner`；其中 `heading` “DeonGame”；区域 `region` “我的信息”内文字“用户名”“象棋积分 {n}”“扑克筹码 {n}”；按钮 “退出登录” | 筹码数字元素带 `data-negative="true|false"`；为 `true` 时 `color` 为令牌 `--color-negative`（`rgb(214, 48, 49)`） |
| 大厅 | 回到对局 | 按钮 “回到对局” | 只在 `activeRoomId` 非空时存在 |
| 大厅 | 游戏卡片 | 按钮，名称以“中国象棋·盲棋”或“德州扑克”开头（卡片内含 `img` 图标与一句介绍文字） | 有进行中的对局时 `disabled`，卡片内显示“你有进行中的对局” |
| 大厅 | 开房弹窗 | `dialog` “开房间”；单选组 `radiogroup` “游戏类型”（`radio` “中国象棋·盲棋”“德州扑克”）；`radiogroup` “对战方式”（`radio` “联机对战”“和电脑对战”，仅象棋）；`combobox` “人数上限”（选项 2～9，缺省 9，仅扑克）；按钮 “确认”“取消”“关闭” | — |
| 大厅 | 房间列表 | `table` “房间列表”（沿用名称）；列头“房间名”“游戏类型”“人数”“状态”“操作”；每行按钮 “加入” | 不可加入时按钮 `disabled`，同一行“操作”格内显示原因文字“已满员”/“对局中”/“你有进行中的对局”；行带 `data-room-id` |
| 大厅 | 错误 | `alert`（沿用） | 加入失败的中文消息 |
| 房间 | 导航 | 按钮 “回到大厅”、按钮 “离开房间” | “离开房间”打开 `dialog` “确认离开房间”，按钮 “确认离开”“取消”；对话框文字说明后果（象棋“对局中离开将判负”，扑克“本手进行中离开将弃牌并让出座位”） |
| 房间 | 静音 | 按钮 “静音” | `aria-pressed="true|false"`（`true` 为已静音） |
| 房间 | 手机静音模式提示 | 文字“听不到声音？请关闭手机静音模式” | 仅当 `(pointer: coarse) and (hover: none)` 为真且未静音时存在（Playwright `Pixel 7` 设备即满足，E-2） |
| 房间 | 简短提示 | `status` / “操作提示” | 显示一句话，2.5 秒后文字清空；`data-visible="true|false"` |
| 象棋 | 对局状态 | `status` / “对局状态”（沿用） | 文字包含：“你执红/你执黑”；等待时“等待对手加入…”；进行中“轮到红方”或“轮到黑方”，轮到自己时再加“ · 轮到你走棋”；被将军时“将军”；提和文字沿用 |
| 象棋 | 棋盘 | `group` “棋盘”（沿用） | `data-anim`：`idle`、`moving`、`flipping`、`capturing`；非 `idle` 时 `aria-busy="true"` 且不接受点按；`data-orientation`：`red-bottom`/`black-bottom` |
| 象棋 | 交叉点 | 按钮，名称“{位置} {内容}”（沿用：内容为“空”、“红车”等，或“红暗子”/“黑暗子”） | `aria-pressed="true"` 为选中；`data-marks` 为空格分隔的标记：`target`（小圆点）、`last-from`、`last-to`；`data-face`：`up`（翻开）/`down`（暗子）/无（空位） |
| 象棋 | 被吃的棋子 | `region` “被吃的棋子”（沿用）内含 `list` “红方被吃”、`list` “黑方被吃”，`listitem` 为棋子名（如“红马”） | 两个列表分别显示在红方、黑方一侧 |
| 象棋 | 结果画面 | `dialog` “对局结果”（沿用） | 文字含“胜”/“负”/“和”；积分变化“+10”/“-10”/“0”；“最新积分 {n}”；未结算时“积分结算中”；按钮 “再来一局”“回到大厅” |
| 扑克 | 牌桌 | `region` “牌桌”（沿用） | `data-anim`：`idle`、`dealing`、`collecting`、`revealing`；`data-shape`：`landscape`/`portrait` |
| 扑克 | 座位 | `region` “座位 {N}：{名称}”（沿用，N 为座位号+1） | `data-me="true|false"`、`data-acting="true|false"`（轮到该座位）；座位内文字：电脑玩家带“电脑”标识、“筹码 {n}”（`data-negative`，同上）、“本轮下注 {n}”、状态文字“弃牌”/“全下”/“等待下一手”/“行动中”；标记 `img` “庄家”“小盲”“大盲” |
| 扑克 | 牌 | `img`，名称为 `cardLabel`（如“红桃10”）或“牌背”（沿用 `role=img`） | 赢家最佳 5 张带 `data-highlight="true"` |
| 扑克 | 公共牌、底池 | `region` “公共牌”、`status` “底池”（沿用） | — |
| 扑克 | 操作区 | `region` “操作区” | `data-active="true|false"`（轮到自己为 `true`）；按钮 “弃牌”“过牌”“跟注 {额}”（无需跟注时为“跟注”）“加注”；不能用时 `disabled`；`slider` “加注金额”、`spinbutton` “金额”（沿用名称）；按钮 “半个底池”“一个底池”“最大”；超出区间时 `alert` 文字“加注金额须在 {最小}～{最大} 之间” |
| 扑克 | 本手结果 | `status` “本手结果” | 摊牌：每个赢家一行“{名} {牌型} 赢得 {额}”；只剩一人：“{名} 赢得底池 {额}”；保持到下一手开始 |
| 扑克 | 房主操作 | 按钮 “开始牌局”“添加电脑玩家”（沿用） | 已达人数上限时“添加电脑玩家” `disabled` |

### 几何约定（AC-12、AC-13、AC-34 的可测依据）

- 以 `group` “棋盘”的边界框（W×H）为准：W/H = 0.9（允许 ±1px 取整误差）。
- 显示坐标第 c 列（0–8，从左）、第 r 行（0–9，从上）的交叉点中心 = 边界框左上 + `((c+0.5)·W/9, (r+0.5)·H/10)`；网格线就画在这些坐标上。
- 显示坐标与位置编码的换算：`data-orientation="red-bottom"` 时位置 `{列字母}{行号}` 在 c = 列字母序号（a=0）、r = 9 − 行号；`black-bottom` 时 c = 8 − 列字母序号、r = 行号。
- 每个交叉点按钮的边界框即以该交叉点为中心、边长 W/9 的正方形（FR-044）；棋子图形中心与按钮中心重合。
- 手机竖屏：页面 `document.documentElement.scrollWidth <= innerWidth`；除交叉点外的按钮、游戏卡片边界框 ≥ 44×44。

### 音效的公开观察点（AC-31～AC-33）

- 每次产生音效事件时，页面在 `window` 上派发 `CustomEvent('deongame:sound', {detail: {name, played}})`：`name` 取 `chess-move`、`chess-flip`、`chess-capture`、`chess-check`、`chess-end`、`poker-deal`、`poker-bet`、`poker-fold`、`poker-win`；`played` 为 `true` 表示已交给音频输出，`false` 表示因静音或尚未解锁（首次点按前）未播放。测试可用 `page.addInitScript` 在页面加载前注册监听收集事件。该事件是产品的公开能力（用于验证“每个事件有音效、静音后不播放”，浏览器无法从外部听声音），不另设测试端点。
- 解锁：页面上任意一次 `pointerdown`/`touchend`/`keydown` 后 `played` 才可能为 `true`。

### 时间与随机性

- 服务端延迟沿用环境变量 `AI_MOVE_DELAY_MS`、`POKER_BOT_DELAY_MS`、`POKER_NEXT_HAND_DELAY_MS`（现状）；集成测试 0，e2e 50/50/500（`playwright.config.ts`）。
- 前端动画时长为 `src/web/anim/durations.ts` 中的常量（最长单次 ≤ 400ms，一次快照的动画合计 ≤ 1.5s）；测试应等待 `data-anim="idle"`，不按时间推断。
- 简短提示 2.5 秒后清空；大厅轮询周期 2 秒。
- 随机性：集成测试 `seededRng(42)`（沿用）；e2e 与测试环境使用 `cryptoRng`，测试不应依赖具体发牌或暗子身份，需要具体局面的断言用接口读出的快照计算（例如按 `legalMoves` 选一步）。

### 造数与清理

- 用户：`POST /api/auth/register`（沿用）。房间：`POST /api/rooms`（可带 `capacity`）、`POST /api/chess/ai-games`、`POST /api/rooms/:id/join`、`POST /api/rooms/:id/poker/bots`、`POST /api/rooms/:id/poker/start`；清理：`POST /api/rooms/:id/leave`、`POST /api/auth/logout`。
- 负数筹码的造数：通过公开玩法产生（扑克输掉一手即减少，余额不设下限）；不需要也不允许直接改库。本次不声明任何允许测试直接改库的表或字段。
- 断线重连：测试在浏览器侧制造（如 Playwright `context.setOffline(true/false)`），不需要服务端能力。

### 开发者命令（写入 `.ai-delivery/features/002-v1/runtime/deployment.json`）

| 类别 | 命令 | 验证什么 | 全量运行一次的大致用时 |
|---|---|---|---|
| `staticAnalysis` | `npm run lint`、`npm run typecheck` | 代码规范、前后端类型（含新协议字段） | 约 30 秒（估计） |
| `build` | `npm run build` | 前端打包、服务端编译、迁移复制 | 约 30 秒（估计） |
| `developerTests` | `npm run test:unit` | 规则引擎与房间逻辑（沿用）；本次新增：`diffChess/diffPoker` 事件判定、`joinState`、快捷加注金额与区间夹取、座位布局、棋盘几何换算、`legalMoves` 视图与暗子身份无关（E-1 的同一检查）、容量与隐式释放 | 现有 94 个用例实测 6.6 秒（实验环境，见快速验证指南 E-3）；新增后约 15 秒（估计） |
| `integrationTests` | `npm run test:integration` | 真实 PostgreSQL 上的接口：退出登录、`activeRoomId`、`capacity` 校验、隐式释放与再来一局、`legalMoves` 只给走棋方、`bestCards`、按容量判满 | 约 1～2 分钟（估计；本会话无数据库实例未实测） |

可由测试计划引用为 `developer-check` 的项：`developerTests` 中的 `tests/unit/uiEvents.test.ts`（各事件都触发对应音效名，覆盖 AC-31 的事件映射）与 `tests/unit/legalMovesView.test.ts`（小圆点数据与规则一致、与暗子身份无关，覆盖 AC-16 的“完全一致”）。

### 端到端用例（不写进部署声明）

- 单独运行一个用例：`npx playwright test e2e/board.spec.ts -g "<用例标题>" --project=chromium`（手机：`--project=mobile`）。首次会先 `npm run build`（约 30 秒）再启动服务。
- 单个用例约 10～20 秒（估计）；本次之后约 22 个用例 × 2 个项目（现有 10 个 + 新增约 12 个）。
- 并行隔离：沿用 `fullyParallel`，同一次运行共用一个服务与 schema `e2e_<运行编号>`，每个用例自己注册以运行编号为前缀的新用户，用户之间互不影响；不同运行用不同 `E2E_PORT` 与运行编号即可同时进行。集成测试每个 Vitest worker 一个 schema（沿用），与 `dev` 实例上的其他使用者互不干扰。

## 安全、隐私、身份与 Secret

- 新增退出登录：服务端删除会话散列记录并让 Cookie 过期；令牌不写日志。已建立的 socket 连接在握手时鉴权（现状），退出后前端跳转登录页会关闭本页连接；服务端不主动断开该用户其他设备的连接（会话按设备独立，第一版亦然）。
- `legalMoves` 只对走棋方本人输出，且经实验 E-1 证明与暗子身份无关，不构成信息泄露；`bestCards` 只出现在 `showdown` 中，而 `showdown` 只含参与摊牌的座位（现状 `hand.ts`），只剩一人时为空，不暴露未摊牌底牌（FR-086）。
- 动画与音效只由已下发给该查看者的快照驱动，翻面动画在 `lastMove.revealed` 出现后才播放，不会提前透露暗子身份（规格“安全、隐私与可访问性行为”）。
- 输入校验：`capacity` 严格为整数 2～9；其余沿用。
- 无新增依赖、无新增机密；`docs/dependencies.json` 的 `secrets` 仍为空。仓库中已有的环境配置取值未使用。

## 配置、可观测性与运维

- 新增配置：无（大厅轮询周期、动画时长、提示时长为前端常量）。
- 新增日志事件：`user_logged_out`（info，`userId`）；`room_created` 增加字段 `capacity`；隐式释放时记 `room_left`，附 `reason: "auto_release_finished"`。不记录用户名之外的客户内容，不记录令牌。
- 错误日志识别规则：应用日志写法未变（pino JSON，`level` 为文字标签，现状“日志与可观测性”），`docs/deployment.json` 的 `operations.errorLogRules` 继续适用，不修改：`level` 为 `error`/`fatal` 高严重度；`^FATAL ERROR:` 高严重度；5 分钟内 20 条以上 `warn` 中严重度。

## SLO、限制、扩缩容、重试与恢复

- 大厅轮询：每个打开大厅的浏览器每 2 秒 2 个 GET 请求，页面隐藏时暂停；`GET /api/rooms` 只读内存，`GET /api/me` 一次按主键查询。无已批准的并发人数要求；单实例运行不变（房间状态在进程内存，现状）。
- 重连：socket.io 客户端默认指数退避重连（文档默认值），重连成功后主动拉取一次房间状态（TD-017）。
- 服务端重启：房间与对局仍会丢失（现状）；前端在 `GET state` 返回 `404 ROOM_NOT_FOUND`/`403 NOT_IN_ROOM` 时回到大厅并显示“房间不存在或已关闭”（A-16）。

## 部署拓扑、迁移、Rollout 与 Rollback

- 部署声明 `docs/deployment.json` 不变（单服务 `web`，端口 8080，`/healthz`，对外）；依赖声明 `docs/dependencies.json` 与探测脚本 `deploy/probes/postgres.sh` 不变（依赖仍只有 `postgres`，建议沿用已有实例）。
- 数据库迁移：无。
- 回滚：直接部署上一版本镜像即可；本次协议变化只是增加字段与一个接口，上一版本前端不读取新字段；回滚会使内存中的房间丢失（与任何重启相同）。

## 验证环境责任矩阵（Verification Environment）

| 验证类型 | 责任阶段 | 环境来源 | 依赖/凭据 | Coding 证据 | 下游结果 |
|---|---|---|---|---|---|
| 静态检查、构建 | 编码 | Agent Pod | 无 | `npm run lint`、`npm run typecheck`、`npm run build` 通过 | 平台部署前验证复跑 |
| 单元测试 | 编码 | Agent Pod | 无 | `npm run test:unit` 全部通过（含本次新增） | 平台复跑；可被测试计划引用为 developer-check |
| 集成测试 | 编码 | Agent Pod + `postgres` `dev` 实例 | 平台注入 `AIDH_DEP_POSTGRES_*` | `npm run test:integration` 全部通过 | 平台复跑 |
| 端到端（项目自带） | 编码 | Agent Pod 内 `localhost` + Chromium（桌面与 Pixel 7 模拟） + `dev` 实例 | 同上 | 修改与新增的 e2e 用例通过 | — |
| 独立测试 | G3 | 测试环境（`cand-*`，HTTPS 地址 `AIDH_SERVICE_WEB_URL`）+ `test` 实例 | QA 身份 | — | 按测试计划判定 AC |
| 真机 iOS Safari / Android Chrome 声音与触控 | UAT（人工） | 真实手机访问测试环境地址 | 无 | — | 平台 Pod 只有 Chromium，无法自动验证 AC-33 的“真机能听到”（见 H-1） |

## 快速验证指南（Quickstart）

实验在仓库外的临时副本中进行（`git archive HEAD | tar -x -C /tmp/exp && cd /tmp/exp && npm ci`），脚本放在另一个临时目录，结束后已删除。

### 实验 E-1：可走位置与暗子身份无关（U-1，支撑 TD-005）

脚本 `/tmp/exp-scripts/e1.ts`（要点）：对 200 局（`seededRng(1000+g)` 开局），每局最多随机走 60 步；每个局面构造一个“只打乱双方暗子身份、位置与翻开状态不变”的副本，对棋盘上每个棋子比较 `legalMoves(原局面, p)` 与 `legalMoves(副本, p)` 排序后的结果；随机选择一个合法着法 `applyMove` 继续，直至结束。

```
cd /tmp/exp && npx tsx /tmp/exp-scripts/e1.ts
```

观察结果：`{ games: 200, positions: 356187, mismatches: 0 }`。编码时把同一检查写成单元测试 `tests/unit/legalMovesView.test.ts`（可少量局数），并断言 `viewFor` 输出的 `legalMoves` 等于 `legalMoves(真实棋盘, from)`。

### 实验 E-2：手机模拟下的媒体查询（U-2，支撑 TD-016）

脚本 `/tmp/exp-scripts/e2.mjs`：用 `@playwright/test` 1.65.1 的 Chromium，分别以 `devices['Pixel 7']`、`devices['Desktop Chrome']`、`devices['iPhone 13']`（以 Chromium 运行）新建上下文，在空白页上求值 `matchMedia('(pointer: coarse)').matches`、`matchMedia('(hover: none)').matches`、`navigator.maxTouchPoints`、`typeof AudioContext`。

```
cd /tmp/exp && node /tmp/exp-scripts/e2.mjs
```

观察结果：

```
Pixel 7 { coarse: true, hoverNone: true, touch: 1, AC: 'function' }
Desktop Chrome { coarse: false, hoverNone: false, touch: 0, AC: 'function' }
iPhone 13 (chromium) { coarse: true, hoverNone: true, touch: 1, AC: 'function' }
```

### 实验 E-3：现有单元测试全量用时（支撑可测性约定中的用时）

```
cd /tmp/exp && time npm run test:unit
```

观察结果：`Tests 94 passed (94)`，`Duration 6.24s`，`real 0m6.625s`。

### 编码完成后的手工核对

1. `npm run build && node dist/server/main.js`（需要 `AIDH_DEP_POSTGRES_*`），浏览器打开 `http://localhost:8080/`：应显示登录页（未登录）→ 注册后显示大厅（不进入任何房间）。
2. 开联机象棋房间 → 点“回到大厅”→ 大厅出现“回到对局”，游戏卡片与加入按钮置灰。
3. 和电脑对战：点己方棋子出现小圆点，走一步可见移动与翻面动画，电脑应对后同样有动画；棋盘组 `data-anim` 回到 `idle`。
4. 在 DevTools 设备模式 360×740 下检查无横向滚动、棋盘与牌桌完整显示。
5. 开扑克房间（上限 3）→ 加 2 个电脑玩家 → “添加电脑玩家”置灰 → 开始牌局，观察发牌、筹码入池、翻公共牌动画与结果展示。

## 支持 Runbook

- “用户登录后又被带进房间”：检查 `LobbyPage` 不再按 `currentRoomId`/`activeRoomId` 自动跳转（TD-002）。
- “大厅列表不更新”：浏览器网络面板应每 2 秒有 `GET /api/rooms`；页面在后台标签时暂停属预期。
- “已结束象棋后无法开新房间（ALREADY_IN_ROOM）”：检查 `RoomManager` 隐式释放（TD-006）与该房间 `closed` 标志。
- “手机没有声音”：先在页面上点按一次（解锁）；确认未点静音；iPhone 静音开关打开时网页音频可能被系统静音，页面已提示（Q3）。
- 日志排查沿用现状事件；退出登录查 `user_logged_out`，隐式释放查 `room_left` 的 `reason`。

## 开放决策

### 待验证假设

- **H-1：iOS Safari 与 Android Chrome 真机在首次点按后能播放 Web Audio 合成音效（AC-33）。** 依据：MDN 自动播放指南写明在用户手势中 `resume()` 后可以播放；已做的尝试：E-2 只证明 Chromium 手机模拟中 `AudioContext` 存在与媒体查询成立；还缺：真机验证（本平台的 Pod 与测试环境只有 Chromium，无法自动验证真机发声）。验证步骤：UAT 时用 iPhone（Safari，静音开关关闭）与 Android（Chrome）打开测试环境，进入人机象棋房间，点按一次后走一步，应听到落子声；点“静音”后不再有声。后备做法：若某真机在解锁后仍无声，改为在同一解锁手势中额外创建 `HTMLAudioElement` 播放运行时合成的 WAV 数据（`URL.createObjectURL(Blob)`），音效改走该元素，接口与 `deongame:sound` 事件不变。
- **H-2：集成测试全量用时约 1～2 分钟。** 本会话没有 PostgreSQL 实例，未实测；编码首次运行后以实测为准，影响的只是计划对批次时长的估算。

### 需要人决定的事项

无。本方案没有需要改变已确认产品行为的事项。

### 建议，未纳入，待 G2 决定

- 建议，未纳入，待 G2 决定：在支持的 iOS Safari 版本上设置 `navigator.audioSession.type = 'playback'`，使手机静音开关打开时网页音效仍可听到（需求只要求提示，Q3 已决定固定提示；此建议会改变静音开关下的产品表现）。
- 建议，未纳入，待 G2 决定：在系统设置“减少动态效果”（`prefers-reduced-motion`）时缩短动画时长（需求与意图未提及；AC-18/AC-24 要求能看到动画过程，因此默认不缩短）。
- 说明（非新增内容）：规格列出的建议“象棋棋盘按本人视角显示”在第一版已实现（黑方视角旋转 180°，`src/web/components/ChessBoard.tsx` 注释），本方案沿用（TD-010），不需要 G2 另行决定是否纳入。
