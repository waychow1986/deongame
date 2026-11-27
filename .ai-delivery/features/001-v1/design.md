# DeonGame 对战游戏大厅（V1）技术方案

> 依据：已确认意图第 2 版（含 Q1～Q5、R1、R2 的人工答案）、规格 `spec.md`（含 PQ-001 人工答案，FR-001～FR-093、AC-1～AC-21、假设 A-1～A-21）、项目宪章。本交付没有 `g2Decisions`；项目还没有系统现状（`.ai-delivery/system-current.md` 不存在），仓库只有 `README.md` 与交付文件，本方案即项目的第一版实现方案。
> 本方案只写技术上“怎么做”，不改变规格中的产品行为。规格中的假设 A-n 仍待 G2 业务负责人查看，本方案按其当前取值设计；取值改变时只影响本文标注的参数（例如盲注、每手上限），不影响架构。

## 技术上下文（Technical Context）

### 运行条件（文档已写明，直接引用）

| 事实 | 出处 |
|---|---|
| 编码与测试 Pod 预装 Node 22、Python 3、Playwright + Chromium；应用可在 Pod 内 `localhost` 启动并用 Playwright 驱动 | `runtime/agent-pod.md` |
| 服务镜像由 ACR Tasks 按 `Dockerfile` 构建，镜像用户须为非 root 的数值 UID；对外服务得到 HTTPS 地址，TLS 在网关终止后以 HTTP 转发到服务 `port` | `runtime/candidate.md` |
| 开发者命令在与 Agent Pod 相同的镜像中以 `bash -euo pipefail` 执行，注入依赖 `dev` 实例的 `AIDH_DEP_*`；不设计“无依赖”模式 | `runtime/candidate.md` |
| 依赖经 `AIDH_DEP_{N}_{FIELD}` 注入，应用只从这些变量读配置；容器依赖须以非 root 运行，持久目录须用挂载路径下的子目录 | `runtime/dependency-declaration.md` |
| 探测环境只有 `bash`、`python3` 等工具，没有 `psql` | `runtime/catalog-facts.md` |
| 官方 `postgres` 镜像（Debian 版）在 Dockerfile 中以固定 `uid=999`、`gid=999` 创建 `postgres` 用户；镜像支持以任意非 root 用户运行，前提是数据目录可写（Docker Hub `postgres` 页面 “Arbitrary --user Notes”） | 官方镜像 Dockerfile 与文档 |
| node-postgres 的 `Pool` 在每个新连接上触发 `connect` 事件，可在其中执行 `SET search_path`（node-postgres 文档 “Pool · events”） | node-postgres 官方文档 |
| socket.io 客户端默认先以 HTTP 长轮询建立连接，再尝试升级为 WebSocket；升级失败时保持长轮询（socket.io 文档 “How it works · Upgrade mechanism”） | socket.io 官方文档 |
| 项目所用 npm 包可从 registry 安装（本会话查询到 socket.io 4.8.x、pino 10.x/9.x、pg 8.x、vitest、@playwright/test、react 19、vite、express 5 的当前版本） | 实验 E-1 前的 `npm view` 查询（见快速验证指南） |

### 不确定项与结论

| 编号 | 不确定项（会改变的决定） | 结论 | 证据 |
|---|---|---|---|
| U-1 | 平台网关是否转发 WebSocket 升级（决定实时推送用原生 WebSocket、SSE 还是带回退的 socket.io）。平台文档只写了“HTTPS 终止后以 HTTP 转发”，未写明 WebSocket。本会话不能执行云命令，无法对网关实验。 | **待验证假设**，不影响可用性：选用 socket.io，它先以普通 HTTP 长轮询建立连接，网关不支持升级时停留在长轮询，功能不变（TD-004）。已用本地实验确认：只允许长轮询时连接、推送与基于 Cookie 的鉴权都正常。 | 实验 E-1；socket.io 官方文档 |
| U-2 | pino 能否按标签字符串（`"error"`）而不是数字（`50`）写出 `level` 字段（决定错误日志识别规则用 `structured` 逐字比较的取值） | 能：配置 `formatters.level` 后输出 `{"level":"error",…,"msg":"…"}` | 实验 E-1 |
| U-3 | socket.io 能否在握手阶段按 Cookie 拒绝未登录连接（决定 FR-006/FR-023 的实时通道鉴权放在握手而不是事件里） | 能：`allowRequest` 回调中拒绝时，客户端收到 `connect_error`，连接不建立 | 实验 E-1 |
| U-4 | 测试环境中 `web` 服务是否只运行一个实例（对局状态放在进程内存，多实例时同一房间的请求会落到不同实例） | **待验证假设**：平台文档未写副本数。验证步骤与后备做法见“开放决策 OD-1”。 | `runtime/candidate.md`（未写明） |
| U-5 | Pod 预装的 Playwright 浏览器对应哪个 `@playwright/test` 版本（决定版本锁定；不匹配时端到端测试需要在线下载浏览器） | Pod 的 `/ms-playwright` 下为 `chromium-1255`/`chromium_headless_shell-1255`；`playwright-core@1.65.1` 的 `browsers.json` 中 chromium 修订号为 1255，1.64.0 为 1248、1.63.0 为 1243。因此精确锁定 `@playwright/test@1.65.1` | 实验 E-2 |

规则引擎（揭棋走法、将军判定、扑克牌型比较、边池分配）全部由本项目自己实现，行为由本方案规定、由单元测试固定，不依赖第三方组件的未写明行为，因此不列为不确定项。

## 治理与技术约束

| 约束 | 出处 | 设计响应 |
|---|---|---|
| 优先选择满足需求的最简单架构 | 宪章“产品与架构” | 单个服务（Node 进程）同时提供网页、REST 与实时推送；一个 PostgreSQL 依赖；对局状态在内存（TD-001～TD-003）。 |
| 凭据保留在服务端，绝不记录 secret 或客户内容 | 宪章“安全与隐私” | 数据库凭据只从 `AIDH_DEP_POSTGRES_*` 读取；密码只存 scrypt 散列；会话令牌只存散列；日志只记用户 ID 与错误码，不记请求体、Cookie、用户名、密码、底牌、盖棋身份（TD-008、TD-012）。 |
| 验证输入、least privilege | 宪章“安全与隐私” | 所有接口校验输入；服务端按“观看者”生成状态快照，盖棋身份与他人底牌永不离开服务端（TD-006）。 |
| 每项用户可见能力有可独立执行的验收场景；外部 integration 用真实测试服务 | 宪章“测试与质量” | 唯一外部依赖 PostgreSQL 在集成测试中使用真实 `dev` 实例（不做 Mock）；可测性约定给出无障碍名称、造数入口与单独运行端到端用例的方法。 |
| 仓库中没有既有 CI、部署脚本或基础设施定义 | 仓库现状 | 无需保留旧物；本方案新增 `Dockerfile`、`docs/deployment.json`、`docs/dependencies.json`、探测脚本。 |
| 依赖只在依赖声明中声明，经平台注入 | `runtime/dependency-declaration.md` | 只声明 `postgres`；没有应用机密（`secrets` 为空）。 |

## 架构概览（Architecture）

```
浏览器（电脑 / 手机）
  │  HTTPS（平台网关终止 TLS）
  ▼
web 服务（Node 22，单进程，端口 8080）
  ├─ 静态文件：React SPA（Vite 构建产物）
  ├─ REST  /api/*      ：注册、登录、大厅、房间操作、走棋、扑克行动（全部写操作走 REST）
  ├─ 实时 /socket.io/* ：服务端 → 客户端推送房间状态快照（room:state）
  ├─ /healthz
  ├─ RoomManager（内存）：房间、象棋对局、扑克牌局、电脑对手调度
  │     └─ 规则引擎（纯函数，src/shared）：揭棋引擎、扑克引擎、牌型评估、电脑策略
  └─ Repository（pg）：users / sessions / chess_results / poker_settlements
          │
          ▼
     PostgreSQL 16（依赖 postgres）
```

- 写操作一律走 REST（请求-响应，便于返回错误码与测试），状态变化后服务端向房间内每位真人的所有连接推送**按观看者裁剪的完整快照**；客户端只渲染最新快照，不做增量合并。
- 对局过程只在内存中（规格“不长期保留的数据”）；只有积分与筹码余额的结算写入数据库，每局/每手只结算一次（以对局/手牌 ID 为主键）。
- 电脑对手（象棋 AI、扑克电脑玩家）在同一进程内按定时器触发，通过与真人相同的引擎入口行动。

## 技术决策与替代方案

| 决策 ID | 选择 | 理由 | 已考虑替代方案 | 证据 | 来源 |
|---|---|---|---|---|---|
| TD-001 | 技术栈：TypeScript（严格模式）全栈；服务端 Node 22 + Express 5；前端 React 19 + Vite；单个 npm 包（根目录 `package.json`），不用 workspaces | 前后端共用规则引擎代码（`src/shared`），Pod 预装 Node 22；单包最简单 | Java/Spring + 独立前端（两套语言，规则引擎无法共用）；.NET（同上）；npm workspaces（多包管理无收益） | `runtime/agent-pod.md` | FR-080、宪章“最简单架构” |
| TD-002 | 部署形态：一个服务 `web`（端口 8080，对外），同时提供静态文件、REST、实时推送 | 单服务即可满足全部 FR；无需服务间通信 | 前端静态站与 API 拆为两个服务（多一个部署单元与跨域配置，无收益） | `runtime/candidate.md` | 宪章“最简单架构” |
| TD-003 | 房间、象棋对局、扑克牌局保存在进程内存（`RoomManager`）；用户、会话与结算记录保存在 PostgreSQL | 规格明确房间与对局过程不长期保留；内存状态最简单、同步处理无竞态；结算写库保证积分/筹码长期保留 | 对局状态也写库（复杂度高，规格不要求重启后恢复对局）；Redis 保存状态（多一个依赖） | spec“业务状态、业务数据规则与不变量” | FR-016、FR-035、FR-064、FR-073 |
| TD-004 | 实时推送用 socket.io 4.8（服务端 `socket.io`，客户端 `socket.io-client`），默认传输（先长轮询、可升级 WebSocket）；只做服务端→客户端推送，写操作走 REST | 网关是否支持 WebSocket 未写明（U-1），socket.io 在不支持时自动停留在长轮询；单实例无需粘性会话 | 原生 `ws`（网关不支持升级时完全不可用）；SSE（网关可能缓冲流式响应，同样未写明，且无自动回退）；客户端定时轮询 REST（延迟与负载更高） | 实验 E-1；socket.io 官方文档 | FR-032、FR-036、FR-065、AC-12、AC-16 |
| TD-005 | 推送内容为“按观看者裁剪的完整房间快照”（事件 `room:state`，带单调递增的 `version`），每次状态变化向房间内每位真人推送一次 | 不做增量合并，客户端断线重连后取一次快照即可恢复（FR-091）；避免增量事件漏发导致不同步 | 增量事件流（需要补发与排序，易出错） | — （设计选择，无外部事实） | FR-032、FR-065、FR-066、FR-091 |
| TD-006 | 隐藏信息只在服务端：盖棋实际身份、未摊牌底牌、牌堆只存在于服务端内存，快照生成函数 `viewFor(room, viewerUserId)` 是唯一出口；盖棋只输出 `piece:"hidden"`，他人底牌不输出字段 | 满足 FR-023、FR-052 的“任何请求都无法获得”；单一出口便于单元测试断言 | 下发全量数据由前端隐藏（可被直接请求读取，违反 FR-023） | — | FR-023、FR-052、宪章 least privilege |
| TD-007 | 鉴权：服务端会话。登录成功后生成 32 字节随机令牌放入 Cookie `dg_session`（HttpOnly、SameSite=Lax、Path=/，生产环境 Secure），数据库只存令牌的 SHA-256；会话有效期 30 天，每次请求时剩余不足 15 天则续期。REST 与 socket.io 握手（`allowRequest`）都校验该 Cookie；socket.io 握手另校验 `Origin` 与 `Host` 同源 | 实现简单、可吊销；HttpOnly 防脚本读取；SameSite=Lax + JSON 请求体（`Content-Type: application/json` 为非简单请求）防跨站写操作；握手同源校验防跨站 WebSocket 劫持 | JWT（无法吊销、仍需存储）；内存会话（服务重启即全部掉线，违背 FR-091 的“重新登录后回到原房间”体验） | 实验 E-1（握手拒绝） | FR-004、FR-006、FR-091 |
| TD-008 | 密码散列：Node 内置 `crypto.scrypt`（N=16384，r=8，p=1，16 字节随机盐，64 字节输出），存为 `scrypt$16384$8$1$<salt b64>$<hash b64>`；比较用 `crypto.timingSafeEqual` | 内置、无原生编译依赖；参数为 Node 文档默认值 | bcrypt/argon2 npm 包（需原生编译，镜像构建更复杂） | Node 官方文档 `crypto.scrypt` | FR-001、宪章“绝不记录 secret” |
| TD-009 | 数据库访问：`pg`（node-postgres）8.x 连接池（max 10）；启动时执行 `src/server/db/migrations/*.sql` 中未执行的迁移（表 `schema_migrations` 记录，`pg_advisory_lock` 串行化）；`DB_SCHEMA` 环境变量（默认 `public`）经连接池 `connect` 事件执行 `SET search_path` | 无 ORM 最简单；迁移随应用发布、可重复执行；`DB_SCHEMA` 让集成测试在共享实例中隔离 | Prisma/TypeORM（多一层生成与运行时）；独立迁移命令（部署声明无“部署前任务”入口） | node-postgres 官方文档（Pool events） | FR-001、FR-033、FR-064 |
| TD-010 | 积分与筹码结算的“每局只一次”：象棋对局结束时在同一事务中插入 `chess_results(game_id 主键)` 并更新双方 `users.rating`；扑克按 `poker_settlements(hand_id, user_id 主键)` 插入并更新 `users.chips_balance`。主键冲突即视为已结算，不再变更 | 内存中先标记“已结束”保证不重复触发，数据库主键再兜底；积分与筹码用 `rating = rating + $delta` 原子更新，无下限 | 只依赖内存标记（进程异常时可能重复或丢失） | — | FR-033、FR-038、FR-058、FR-062、spec 不变量 |
| TD-011 | 扑克筹码在数据库中的落账时点：一手牌进行中，玩家的投入只记在内存（快照中显示 `chips = 数据库余额 − 本手已投入`）；手牌结束时按每位真人的净额（赢得 − 投入）一次性落账；真人在手牌中途离开（FR-093）时立即为其落账 `−本手投入`。服务进程在一手牌中途重启时该手作废、无人增减 | 显示与 FR-061/FR-065 一致（余额实时随下注减少）；落账次数少、每手账目自洽（spec 不变量“投入总额 = 分配总额”） | 每次下注即写库（中途崩溃会造成只扣不分的账目不平） | — | FR-058、FR-061、FR-062、FR-064、FR-093 |
| TD-012 | 日志：pino 9，JSON 行输出到 stdout，`formatters.level` 输出标签字符串（`"level":"error"`），消息字段 `msg`；不使用自动记录请求头/请求体的中间件，只记录方法、路由模板、状态码、耗时、用户 ID；`uncaughtException`/`unhandledRejection` 以 `fatal` 记录后退出 | 与 `operations.errorLogRules` 的 `structured` 规则逐字匹配；满足“绝不记录 secret 或客户内容” | 文本日志 + 正则（易误报）；`pino-http` 默认序列化器（会记录 Cookie 头） | 实验 E-1 | 宪章“安全与隐私”；`runtime/candidate.md` |
| TD-013 | 揭棋引擎（`src/shared/xiangqi/`）：纯函数，输入“完整局面（含盖棋身份）”或“公开局面”，输出合规着法。盖棋**总是**位于其开局位置（一动即翻），因此盖棋的走法类型 = 所在位置的开局类型（查表）；翻开后按实际身份走，象/相去掉河界限制、士/仕去掉九宫限制，将/帅仍限九宫；将军判定时盖棋按位置类型计算攻击范围；将帅照面与“走后己方被将”的着法剔除。因此合规着法只依赖公开信息，服务端与电脑对手都用公开局面计算 | 规格 FR-024～FR-030 的直接实现；只依赖公开信息使电脑对手天然不“偷看” | 引入第三方象棋库（不支持揭棋与“象士可过河”，改造成本高于自写） | spec FR-024～FR-030、意图假设 2～4 | FR-024～FR-031、FR-037、FR-042 |
| TD-014 | 随机性：象棋打乱、发牌洗牌、电脑对手的随机选择都通过注入的 `Rng` 接口（`int(maxExclusive)`）；生产实现用 `crypto.randomInt` 做 Fisher–Yates 洗牌；单元/集成测试注入固定种子的伪随机实现。部署的服务**不**提供设定种子的配置或接口 | 生产随机不可预测（盖棋身份、底牌不可推测）；测试可复现 | 为测试加种子环境变量或端点（违背“不为测试另加专用入口”，且可能被利用预测底牌） | Node 官方文档 `crypto.randomInt` | FR-021、FR-022、FR-052 |
| TD-015 | 象棋电脑对手（一个难度）：基于公开局面的 2 层极小极大（电脑一步 + 对手一步），估值 = 子力价值和（车 9、炮 4.5、马 4、象 2、士 2、兵 1，过河兵 2；盖棋按该方尚未翻开身份的平均子力估值，不读取实际身份）+ 将死/困毙极值；同分着法随机选择；轮到电脑时延迟 `AI_MOVE_DELAY_MS`（默认 600ms）后走棋，走法经与真人相同的引擎入口执行。电脑收到提和一律同意、从不主动提和（A-20） | 着法合规由引擎保证（FR-042）；2 层搜索每步约 40×40 局面，毫秒级；不读盖棋身份保证公平且无信息泄露 | 随机走子（过弱，体验差）；更深搜索/开源引擎（不支持揭棋） | spec A-20 | FR-041～FR-043、FR-036 |
| TD-016 | 扑克引擎（`src/shared/poker/`）：自写。牌型评估对 7 张牌枚举 21 种 5 张组合取最大，牌型编码为可比较的数组；A 可作 A-2-3-4-5 的最小；底池分配按“投入层级”切分主池/边池，各池在有资格的未弃牌玩家中比较，平分零头给庄家左手起第一位赢家（A-15）。下注规则：最小下注 = 大盲 10；最小加注增量 = 本轮上一次下注/加注增量；每手每人投入上限 `POKER_HAND_COMMIT_CAP`=1000（A-16）；加注到使本人本手投入恰好等于上限的金额时，即使增量低于最小加注也允许（视为全下，按标准规则不重新开放加注）；投入不受余额限制（FR-061） | 规则需与 A-15/A-16/FR-060 精确一致，自写可完全由单元测试固定；第三方评估库的平分/零头行为不在其文档中 | 第三方牌型库（`pokersolver` 等，边界行为需额外取证） | spec FR-051～FR-061、A-13、A-15、A-16 | FR-051～FR-063 |
| TD-017 | 扑克电脑玩家策略：按底牌强度分三档（对子或两张 ≥10 为强、同花连张或含 A 为中、其余为弱）与需跟注额决定：强牌加注到最小加注额（不超过上限），中牌跟注/过牌，弱牌在需跟注 > 大盲时弃牌否则跟注/过牌；翻牌后按是否组成一对及以上决定跟注或弃牌；行动前延迟 `POKER_BOT_DELAY_MS`（默认 800ms）。电脑行动只通过引擎的合规行动入口 | 简单、可预测、合规由引擎保证；规格对电脑强度无要求 | 随机行动（会频繁做出不合理加注）；蒙特卡洛胜率（复杂度高，无需求） | spec FR-072 | FR-072 |
| TD-018 | 房间操作串行化：每个房间一个 `AsyncMutex`，所有改变房间状态的操作（REST 写操作、电脑行动、离开、定时开局）在锁内执行；状态先在内存中完成变更并递增 `version`，结算写库在锁内 await 完成后再推送快照。用户“当前所在房间”由 `RoomManager` 的 `userId → roomId` 映射维护，开房/加入在全局锁内检查（FR-015） | Node 单线程下仍有 await 交错；锁保证“被拒绝的操作不改变状态”与每局只结算一次 | 乐观并发（版本号冲突重试，复杂且无收益） | — | FR-015、FR-030、FR-055、spec 不变量 |
| TD-019 | 前端：React Router 4 个页面（`/register`、`/login`、`/lobby`、`/room/:id`）；棋盘用 CSS Grid（9×10 交叉点按钮）+ SVG 棋盘线，宽度 `min(100vw - 16px, 560px)` 等比缩放；牌桌用纵向弹性布局；`<meta name="viewport" content="width=device-width, initial-scale=1">`；所有操作是原生 `<button>`/表单控件（触屏点击即 `click`）；黑方视角棋盘旋转 180° 显示，但控件名称中的坐标不变 | 满足 FR-080 的“触屏完成全部操作、无需横向滚动”；原生控件天然有无障碍角色 | 画布（Canvas）渲染（无法按角色与名称定位、无障碍差）；UI 组件库（体积大，无必要） | spec FR-080、A-18 | FR-080、AC-20 |
| TD-020 | 登录后恢复：`GET /api/me` 返回 `currentRoomId`；前端进入大厅时若不为空则跳转到该房间（FR-091）；socket.io 客户端开启自动重连，重连成功后服务端立即推送一次当前快照 | 掉线恢复只依赖服务端状态 | 前端本地存储房间号（换设备失效） | spec FR-091、A-10 | FR-091 |
| TD-021 | 扑克节奏：一手结束后等待 `POKER_NEXT_HAND_DELAY_MS`（默认 4000ms）让玩家看到摊牌结果，再自动开始下一手（入座 ≥ 2 时） | FR-050 要求自动开始；留出查看结果的时间是 FR-065 的体验要求 | 立即开始（摊牌结果一闪而过） | spec FR-050、FR-065 | FR-050、FR-065 |
| TD-022 | 容器镜像：多阶段 `Dockerfile`，构建阶段 `node:22-bookworm-slim` 执行 `npm ci && npm run build && npm prune --omit=dev`；运行阶段同基础镜像，只复制 `dist/`、`node_modules/`、`package.json`，`USER 1000:1000`（镜像内置 `node` 用户），`ENV NODE_ENV=production PORT=8080`，`CMD ["node","dist/server/main.js"]` | 满足“非 root 数值 UID”；与 Pod 的 Node 22 一致 | Alpine（musl 与 Pod 的 glibc 差异）；distroless（调试困难） | `runtime/candidate.md` | — |
| TD-023 | 依赖版本：`package.json` 中 `engines.node` 为 `>=22`；运行时依赖 `express@^5`、`socket.io@^4.8.1`、`pg@^8`、`pino@^9`；前端 `react@^19`、`react-dom@^19`、`react-router@^7`、`socket.io-client@^4.8.1`；开发依赖 `typescript@^5`、`vite`、`@vitejs/plugin-react`、`vitest`、`eslint` + `typescript-eslint`、`tsx`（本地开发），取编码时的最新稳定大版本并以 `package-lock.json` 锁定；`@playwright/test` 精确锁定 `1.65.1`（不带 `^`） | 与实验验证过的 socket.io/pino 大版本一致；Playwright 与 Pod 预装浏览器修订号一致，无需在线下载浏览器 | Playwright 取最新版（浏览器修订号不匹配，需要 `npx playwright install`，平台执行环境不保证可下载） | 实验 E-1、E-2 | AC-20、FR-080 |

## 技术先后依赖

- 数据库迁移 `001_init.sql`（users、sessions、chess_results、poker_settlements）必须先于账号、会话与结算代码，因为这些代码的 SQL 依赖表结构；集成测试也依赖迁移能在空 schema 上执行。
- 规则引擎（`src/shared/xiangqi/`、`src/shared/poker/`）与快照类型（`src/shared/protocol.ts`）必须先于房间服务、REST 路由、电脑对手与前端页面，因为它们都调用引擎入口并按快照类型收发数据。
- 会话鉴权中间件（`requireAuth`）与 socket.io 握手鉴权必须先于任何房间、对局接口，因为这些接口以“当前用户”为前提（FR-006），且实时推送按用户把连接归入房间。
- 象棋公开局面与合规着法生成必须先于象棋电脑对手，因为电脑对手只在公开局面上调用合规着法生成。
- 扑克合规行动校验（`legalActions`）必须先于扑克电脑玩家，因为电脑玩家只从合规行动中选择。
- `Dockerfile` 与 `/healthz` 必须先于测试环境部署，因为平台按部署声明构建镜像并以 `/healthz` 判定健康。

## 领域与数据模型

### 持久化（PostgreSQL，迁移 `src/server/db/migrations/001_init.sql`）

| 表 | 字段 | 约束与说明 |
|---|---|---|
| `users` | `id uuid` 主键（应用生成 `crypto.randomUUID()`）；`username text not null`；`password_hash text not null`；`rating integer not null default 1000`；`chips_balance bigint not null default 1000`；`created_at timestamptz not null default now()` | `unique(username)`：PostgreSQL 默认排序规则下按字节比较，区分大小写（A-1）；`rating`、`chips_balance` 无下限、无检查约束（FR-033、FR-062） |
| `sessions` | `token_hash text` 主键（令牌 SHA-256 十六进制）；`user_id uuid not null references users(id) on delete cascade`；`created_at`、`expires_at timestamptz not null` | 索引 `sessions(user_id)`；过期会话在登录时顺带删除该用户的过期行 |
| `chess_results` | `game_id uuid` 主键；`red_user_id uuid not null`；`black_user_id uuid null`（电脑对局为空）；`mode text not null`（`online`/`ai`）；`outcome text not null`（`red_win`/`black_win`/`draw`）；`reason text not null`；`finished_at timestamptz not null default now()` | 只用于“每局只结算一次”与运维排查；不提供回放（非目标） |
| `poker_settlements` | `hand_id uuid`；`user_id uuid references users(id)`；`delta bigint not null`；`created_at` | 主键 `(hand_id, user_id)`；每手每位真人恰一行（含净额 0） |
| `schema_migrations` | `version text` 主键；`applied_at` | 迁移执行器维护 |

### 内存模型（`src/server/rooms/`）

- `Room`：`id`（uuid）、`game`（`chess` | `poker`）、`mode`（象棋 `online` | `ai`；扑克固定 `online`）、`hostUserId`、`members`（按进入顺序的真人列表，用于 A-5 房主接任）、`capacity`（象棋 2、扑克 9）、`createdAt`、`version`、`listed`（`ai` 模式为 false，不出现在列表，FR-040）、游戏状态（`ChessGame` | `PokerTable`）。
- `ChessGame`：`id`、`board`（90 格，每格 `null` 或 `{side, actual, revealed}`）、`turn`、`players`（red/black → userId 或 `computer`）、`captured`、`lastMove`、`drawOffer`、`status`（`waiting`/`active`/`finished`）、`result`。
- `PokerTable`：`seats[9]`（`{kind: human|bot, userId?, botName?, botChips?, waitingNextHand}`）、`dealerSeat`、`handNumber`、`hand`（`id`、`deck`、`board`、`stage`、`contributions`、`roundBets`、`currentBet`、`lastRaiseSize`、`toAct`、`actedSinceRaise`、`folded`、`actionLog`、`showdown`）。
- 电脑玩家名称为“电脑 1”“电脑 2”…（房间内递增），筹码 `botChips` 初始 1000，只在内存（FR-073）。

### 象棋坐标与棋子编码（接口与无障碍名称共用）

- 坐标 `"{列}{行}"`：列 `a`～`i` 为红方视角从左到右，行 `0`～`9` 为红方底线到黑方底线。红帅在 `e0`，黑将在 `e9`。
- 开局位置类型（盖棋走法类型）：行 0/9 `a`/`i` 车、`b`/`h` 马、`c`/`g` 象、`d`/`f` 士；行 2/7 `b`/`h` 炮；行 3/6 `a c e g i` 兵/卒。
- 棋子类型（接口值 → 中文显示）：`king` 帅/将、`advisor` 仕/士、`elephant` 相/象、`horse` 马/馬（统一显示“马”）、`rook` 车、`cannon` 炮、`pawn` 兵/卒；盖棋接口值 `hidden`，显示“暗子”。红方显示用帅、仕、相、马、车、炮、兵；黑方用将、士、象、马、车、炮、卒。

### 扑克牌编码

- 接口值两字符：点数 `2`～`9`、`T`、`J`、`Q`、`K`、`A` + 花色 `s`（黑桃）`h`（红桃）`d`（方块）`c`（梅花），例如 `"Ah"`、`"Td"`。
- 显示与无障碍名称：花色中文 + 点数（`10` 显示为“10”），例如“红桃A”“方块10”。

## Component 边界与项目结构

编码会创建或修改的路径：

- `./package.json`、`./package-lock.json`：单包；脚本 `dev`、`build`、`start`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:e2e`。
- `./tsconfig.json`、`./tsconfig.server.json`、`./vite.config.ts`、`./vitest.config.ts`、`./vitest.integration.config.ts`、`./playwright.config.ts`、`./eslint.config.js`、`./.gitignore`、`./.dockerignore`
- `./Dockerfile`
- `./README.md`（补充本地运行与测试说明）
- `src/shared/`：前后端共用、无 I/O 的纯代码
  - `src/shared/rng.ts`（`Rng` 接口、`cryptoRng`、`seededRng`）
  - `src/shared/xiangqi/`（棋盘、开局打乱、合规着法、将军判定、胜负/和棋判定、公开视图）
  - `src/shared/poker/`（牌、洗牌发牌、下注规则与 `legalActions`、牌型评估、底池分配、手牌状态机）
  - `src/shared/ai/`（象棋电脑对手、扑克电脑玩家策略）
  - `src/shared/protocol.ts`（REST 请求/响应与 `room:state` 快照类型、错误码常量）
- `src/server/`：服务端
  - `src/server/main.ts`（入口：读配置、迁移、启动 HTTP 与 socket.io、优雅退出）
  - `src/server/config.ts`（环境变量解析，见“配置”）
  - `src/server/logger.ts`
  - `src/server/db/`（连接池、迁移执行器、`migrations/001_init.sql`、用户/会话/结算仓储）
  - `src/server/auth/`（密码散列、会话、`requireAuth` 中间件、注册/登录路由）
  - `src/server/rooms/`（`RoomManager`、房间锁、象棋房间服务、扑克房间服务、电脑调度、快照 `viewFor`）
  - `src/server/http/`（Express 应用组装、路由、错误处理、静态文件与 SPA 回退）
  - `src/server/realtime/`（socket.io 握手鉴权、用户→连接映射、推送）
- `src/web/`：前端（`index.html`、`main.tsx`、`api.ts`、`socket.ts`、`pages/`、`components/`（棋盘、牌桌、座位、卡牌、对局结果对话框）、`styles.css`）
- `tests/unit/`：单元测试（引擎、牌型、底池、电脑策略、`viewFor` 信息裁剪、密码散列、配置解析）
- `tests/integration/`：集成测试（真实 PostgreSQL `dev` 实例 + 进程内启动的服务 + `fetch` 与 `socket.io-client`）
- `tests/support/`：测试辅助（临时 schema、启动服务、造用户）
- `e2e/`：Playwright 端到端用例（`e2e/*.spec.ts`）与辅助（`e2e/support/`）
- `docs/api.md`：接口契约正文（按本方案“Interface 与契约”一节写成，编码时与实现同步）
- 本步骤已写出、编码不得修改：`docs/dependencies.json`、`docs/deployment.json`、`deploy/probes/postgres.sh`

构建产物 `dist/`（`dist/server/` 为编译后的服务端，`dist/web/` 为前端静态文件）不进仓库。

## 数据流、状态、并发与生命周期

### 写操作的统一流程

1. REST 请求 → `requireAuth` 解析 Cookie 得到 `userId`（无效则 401 `UNAUTHENTICATED`）。
2. 校验请求体（类型、枚举、坐标格式、金额为正整数），失败返回 400 `VALIDATION_FAILED`，不触碰房间。
3. 取房间锁（TD-018）→ 校验成员身份（不在该房间返回 403 `NOT_IN_ROOM`）→ 调用引擎：引擎返回“拒绝（错误码）”时状态不变，直接返回 409；成功时得到新状态。
4. 若该操作结束了对局/手牌：在锁内写库结算（TD-010、TD-011），成功后才把结算结果写入快照。结算写库失败：记录 `error` 日志，对局状态保持“已结束、结算待重试”，后台每 5 秒重试，直到成功（主键保证不重复）；快照中 `result.settled=false`，前端显示“结算中”。
5. `version += 1` → 释放锁 → 对房间每位真人的所有连接推送 `viewFor(room, userId)`；响应体返回请求者自己的快照。
6. 如果轮到电脑：调度器在 `AI_MOVE_DELAY_MS`/`POKER_BOT_DELAY_MS` 后以同样流程（取锁 → 引擎 → 推送）行动；行动前再次检查仍轮到它（防止期间有人离开）。

### 房间生命周期

- 创建：`POST /api/rooms` 或 `POST /api/chess/ai-games`（全局锁内检查用户不在其他房间，FR-015）。
- 象棋联机：第 2 人加入即开局（FR-020），房主执红；结束（胜/负/和）并结算后房间标记 `closed`，从列表移除；成员“当前房间”映射保持到其点击“返回大厅”（`POST /api/rooms/:id/leave`）或 10 分钟后自动清除，使双方都能看到结果（FR-034、FR-035）。对已结束房间执行离开不产生认输。
- 象棋电脑对局：创建即开局，用户执红先走（FR-041）。
- 离开：象棋对局进行中离开 = 认输（FR-092）；扑克手牌进行中离开 = 弃牌并立即落账（FR-093、TD-011），如因此只剩一名未弃牌者则该手按 FR-056 结束。离开后房主按 A-5 转移；无真人时房间关闭、电脑玩家随之移除（FR-016、FR-074）。
- 掉线：只断开 socket 连接，不改变房间成员（FR-091）；不设任何行动计时器（FR-090）。
- 服务进程重启：内存中的房间全部丢失；用户“当前房间”映射为空，登录后回到大厅；进行中的象棋对局不结算，进行中的扑克手牌作废（未落账，无人增减）。这是 TD-003 的已知代价，见“支持 Runbook”。

### 象棋对局状态机

`waiting`（等待第 2 人）→ `active` → `finished`（`red_win`/`black_win`/`draw`）。结束原因：`checkmate`、`stalemate`、`resign`（含离开房间）、`draw_agreed`、`bare_kings`（双方只剩帅/将，FR-037）。每步走完依次判定：对方是否只剩将帅且本方也只剩（自动和）→ 对方是否无合规着法（将死或困毙，按是否被将军区分 reason）。待回应的提和在对方走棋、对局结束时失效（A-20）。

### 扑克手牌状态机

`preflop` → `flop` → `turn` → `river` → `showdown` → `complete`；任一时刻只剩一名未弃牌者 → `complete`（不摊牌，FR-056）。每轮结束条件：所有未弃牌且未达上限的玩家都已在最后一次加注后行动，且本轮投入相等（或已达上限）。若所有未弃牌玩家都已达到每手上限，剩余公共牌直接发完进入摊牌。一手牌中途加入的玩家 `waitingNextHand=true`（FR-066）。手牌开始条件：入座 ≥ 2（含电脑）；第一手由房主 `POST …/poker/start`，之后自动（TD-021）。庄家位第一手为房主座位（A-12），之后顺时针移到下一个入座者；两人时庄家下小盲（FR-051）。

## Interface 与契约（Contract）

接口契约的位置：本节为本交付的契约；编码时在 `docs/api.md` 写出同样内容的正文并随实现同步，独立测试以 `docs/api.md` 与本节为准（两者不一致时以本节为准并作为缺陷）。

### 通用约定

- 所有 REST 接口前缀 `/api`，请求与响应体为 JSON（`Content-Type: application/json`，请求体上限 16KB）。写操作必须带该请求头，否则 415 `UNSUPPORTED_MEDIA_TYPE`。
- 鉴权：Cookie `dg_session`。除注册、登录与 `/healthz` 外的接口都需要登录，未登录返回 401 `UNAUTHENTICATED`（FR-006）；前端收到 401 时跳转 `/login`；未登录直接访问 `/lobby`、`/room/:id` 页面同样跳转 `/login`。
- 错误响应：`{"error": {"code": "<错误码>", "message": "<给用户看的中文提示>"}}`。
- 金额、积分为整数，可为负数。时间为 ISO 8601 UTC 字符串。

### 错误码

| HTTP | code | message（页面显示） | 场景 |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | “用户名为必填项” / “密码为必填项” / “请求参数不合法” | FR-003；请求体格式错误 |
| 401 | `UNAUTHENTICATED` | “请先登录” | FR-006 |
| 401 | `INVALID_CREDENTIALS` | “用户名或密码错误” | FR-005 |
| 403 | `NOT_IN_ROOM` | “你不在这个房间中” | 操作不在其中的房间 |
| 403 | `NOT_HOST` | “只有房主可以进行此操作” | FR-070、开始牌局 |
| 404 | `ROOM_NOT_FOUND` | “房间不存在或已关闭” | — |
| 409 | `USERNAME_TAKEN` | “用户名已被占用” | FR-002 |
| 409 | `ROOM_FULL` | “房间已满” | FR-014 |
| 409 | `ALREADY_IN_ROOM` | “你已在其他房间中，请先离开当前房间” | FR-015 |
| 409 | `NOT_YOUR_TURN` | “还没轮到你” | FR-030、FR-055 |
| 409 | `ILLEGAL_MOVE` | “走法不合规” | FR-024、FR-028、FR-030（移动对方棋子/空位亦用此码） |
| 409 | `GAME_NOT_ACTIVE` | “对局未在进行中” | 未开局或已结束 |
| 409 | `DRAW_OFFER_PENDING` / `NO_DRAW_OFFER` | “已有待回应的提和” / “没有待回应的提和” | FR-036、A-20 |
| 409 | `ILLEGAL_ACTION` | 具体原因：“当前需要跟注，不能过牌” / “加注额低于最小加注” / “超出每手下注上限 1000” / “当前不能下注” | FR-055、FR-060 |
| 409 | `HAND_IN_PROGRESS` | “手牌进行中，暂不能进行此操作” | FR-070（添加电脑玩家）、重复开始 |
| 409 | `NOT_ENOUGH_PLAYERS` | “至少需要 2 名玩家才能开始” | FR-050 |

### REST 接口

| 方法与路径 | 请求体 | 成功响应 | 说明 |
|---|---|---|---|
| `POST /api/auth/register` | `{username, password}` | 201 `{user}` 并设置 Cookie（注册即登录） | FR-001～FR-003；`username`/`password` 为字符串，`trim()` 后为空即必填错误；按原样保存 |
| `POST /api/auth/login` | `{username, password}` | 200 `{user}` 并设置 Cookie | FR-004、FR-005 |
| `GET /api/me` | — | 200 `{user}` | `user = {id, username, rating, chips, currentRoomId \| null}`；`chips` 为数据库余额（不含进行中手牌的未落账投入） |
| `GET /api/rooms` | — | 200 `{rooms: [{id, game, hostUsername, players, capacity, full, status}]}` | FR-011；只含 `listed` 且未关闭的房间，按创建时间倒序；`game` 为 `chess`/`poker`；`status` 为 `waiting`/`playing` |
| `POST /api/rooms` | `{game: "chess" \| "poker"}` | 201 `{room: <快照>}` | FR-010、FR-015 |
| `POST /api/chess/ai-games` | `{}` | 201 `{room: <快照>}` | FR-040、FR-041 |
| `POST /api/rooms/:id/join` | `{}` | 200 `{room: <快照>}` | FR-013、FR-014、FR-015；已在该房间中时幂等返回 200 |
| `POST /api/rooms/:id/leave` | `{}` | 200 `{}` | FR-016、FR-092、FR-093 |
| `GET /api/rooms/:id/state` | — | 200 `{room: <快照>}` | 只限成员 |
| `POST /api/rooms/:id/chess/move` | `{from: "b2", to: "e2"}` | 200 `{room}` | FR-024～FR-031、FR-037 |
| `POST /api/rooms/:id/chess/resign` | `{}` | 200 `{room}` | FR-031 |
| `POST /api/rooms/:id/chess/draw-offer` | `{}` | 200 `{room}` | FR-036；电脑对局中立即以和棋结束（A-20） |
| `POST /api/rooms/:id/chess/draw-response` | `{accept: boolean}` | 200 `{room}` | FR-036；只有被提和方可回应 |
| `POST /api/rooms/:id/poker/start` | `{}` | 200 `{room}` | FR-050；只限房主、只用于第一手 |
| `POST /api/rooms/:id/poker/bots` | `{}` | 201 `{room}` | FR-070；只限房主；每次添加一个 |
| `POST /api/rooms/:id/poker/action` | `{type: "fold" \| "check" \| "call" \| "bet" \| "raise", amount?: integer}` | 200 `{room}` | FR-054、FR-055、FR-060、FR-061；`bet`/`raise` 的 `amount` 为“本轮下注到的总额”（raise to），必须在 `you.legal` 给出的 `[minRaiseTo, maxRaiseTo]` 内（等于 `maxRaiseTo` 时允许低于最小加注，见 TD-016） |
| `GET /healthz` | — | 200 `{"status":"ok"}`；数据库不可用时 503 `{"status":"db-unavailable"}` | 平台健康检查，不需要登录 |

### 实时推送（socket.io，路径 `/socket.io/`）

- 连接：浏览器同源连接，自动携带 Cookie；握手时校验 Cookie 与同源（TD-007），未登录连接被拒（客户端收到 `connect_error`，消息 `unauthorized`）。非浏览器客户端（集成测试、独立测试脚本）用 `socket.io-client` 并在 `extraHeaders` 中传 `cookie` 与 `origin`（取服务地址）。
- 连接建立后服务端把连接归入该用户当前房间；若用户在房间中，立即推送一次 `room:state`。用户之后开房/加入/离开时服务端自动调整归属，客户端不需要发送任何事件。
- 事件 `room:state`（服务端 → 客户端）：载荷为下述快照；客户端只保留 `version` 最大的一份。
- 事件 `room:closed`（服务端 → 客户端）：`{roomId}`，房间关闭时推送给仍连接的成员。
- 客户端 → 服务端：无业务事件（写操作一律走 REST）。

### 房间快照（`viewFor` 输出，按观看者裁剪）

公共部分：`{roomId, game, mode, version, hostUserId, members: [{userId, username}], capacity, status: "waiting" | "playing" | "closed", you: {userId}}`。

象棋部分 `chess`：

```json
{
  "gameId": "uuid",
  "status": "waiting | active | finished",
  "players": { "red": {"userId": "…", "username": "…"}, "black": {"computer": true, "username": "电脑"} },
  "yourColor": "red | black",
  "turn": "red | black",
  "inCheck": false,
  "board": [ {"pos": "a0", "side": "red", "piece": "hidden"}, {"pos": "e0", "side": "red", "piece": "king"} ],
  "captured": [ {"side": "black", "piece": "horse"} ],
  "lastMove": { "from": "b2", "to": "b9", "side": "red", "revealed": "rook", "captured": {"side": "black", "piece": "horse"} },
  "drawOffer": { "by": "red" },
  "result": {
    "outcome": "red_win | black_win | draw",
    "reason": "checkmate | stalemate | resign | draw_agreed | bare_kings",
    "settled": true,
    "ratingChanges": [ {"userId": "…", "delta": 10, "rating": 1010} ]
  }
}
```

- `board` 只列出有棋子的位置；盖棋 `piece` 恒为 `"hidden"`，快照中没有任何字段携带盖棋实际身份（FR-023）。`lastMove.revealed` 为本步被翻开的身份（本步移动的是盖棋时），`captured.piece` 为被吃棋子实际身份（含被吃的盖棋，FR-029）。`drawOffer`、`result` 不存在时为 `null`。

扑克部分 `poker`：

```json
{
  "handId": "uuid | null",
  "handNumber": 3,
  "stage": "idle | preflop | flop | turn | river | showdown | complete",
  "blinds": {"small": 5, "big": 10},
  "handCommitCap": 1000,
  "board": ["Ah", "Td", "7c"],
  "pot": 120,
  "currentBet": 40,
  "toActSeat": 2,
  "seats": [
    {"seat": 0, "kind": "human", "userId": "…", "name": "alice", "chips": -35, "committedThisHand": 40, "committedThisRound": 40,
     "inHand": true, "folded": false, "atCap": false, "waitingNextHand": false,
     "isDealer": true, "isSmallBlind": false, "isBigBlind": false, "holeCards": ["As", "Kd"]}
  ],
  "actions": [ {"seat": 1, "name": "电脑 1", "type": "small_blind", "amount": 5} ],
  "showdown": [ {"seat": 0, "holeCards": ["As", "Kd"], "handRank": "two_pair", "handLabel": "两对"} ],
  "winners": [ {"seat": 0, "name": "alice", "amount": 120} ],
  "you": {"seat": 0, "legal": {"fold": true, "check": false, "call": true, "callAmount": 20, "bet": false, "raise": true, "minRaiseTo": 60, "maxRaiseTo": 1000}}
}
```

- 只为空的座位不列出。`seats[].chips`：真人为 `数据库余额 − 本手未落账投入`，电脑为其房间内筹码（FR-061、FR-065）。`holeCards` 只在“观看者本人的座位”或该座位已在 `showdown` 中公开时出现，其余情况字段不存在（FR-052、FR-056）。`actions` 为本手全部行动（含 `small_blind`、`big_blind`、`fold`、`check`、`call`、`bet`、`raise`、`leave_fold`），`amount` 为该次行动投入的金额。`you.legal` 只在轮到观看者时非空。`maxRaiseTo` = 本轮已投入 + (1000 − 本手已投入)。
- `handRank` 取值：`high_card`、`one_pair`、`two_pair`、`three_of_a_kind`、`straight`、`flush`、`full_house`、`four_of_a_kind`、`straight_flush`、`royal_flush`；`handLabel` 为对应中文（高牌、一对、两对、三条、顺子、同花、葫芦、四条、同花顺、皇家同花顺）。

## 可测性约定

项目还没有系统现状，以下约定全部为本次新建。

### 公开入口与造数、清理

- 造数一律通过应用的公开接口：`POST /api/auth/register` 造用户（注册即登录，响应带 Cookie）；`POST /api/rooms`、`POST /api/chess/ai-games`、`POST /api/rooms/:id/join`、`…/poker/bots` 造房间与对局；`POST /api/rooms/:id/leave` 清理房间（房间无真人即关闭）。测试用户名统一加本次运行前缀（例如 `qa_<运行编号>_alice`），避免与他人数据冲突。没有删除用户的接口（规格无此能力），测试用户留在库中不影响其他用户。
- 允许测试直接改库的范围（只改测试自己创建的用户）：表 `users` 的 `rating` 与 `chips_balance` 两个字段，只用于把测试用户的积分/筹码余额预置为 0 或负数等起点。理由：AC-13（积分扣成负数）与 AC-15、AC-19（余额为零或负数后继续下注）通过对局把余额打到负数需要多手随机输赢，用例时长与结果都不可控。改库后用户需重新调用 `GET /api/me` 或重新进入房间读取新余额；不得在该用户的扑克手牌进行中改 `chips_balance`（手牌结束落账按增量写入，不会覆盖预置值，但快照显示会滞后）。连接信息取 `AIDH_DEP_POSTGRES_*`；如测试执行环境到数据库网络不通，退回用公开接口打牌造数。
- 对局状态的读取入口：`GET /api/rooms/:id/state`（与推送的 `room:state` 内容相同），可用来断言盖棋不含身份字段、他人底牌不存在、积分与筹码变化。

### 时间与随机性

- 没有对局计时器（FR-090），测试不需要控制时钟。会话有效期 30 天，不影响测试。
- 电脑对手与自动开下一手的延迟由环境变量控制：`AI_MOVE_DELAY_MS`（默认 600）、`POKER_BOT_DELAY_MS`（默认 800）、`POKER_NEXT_HAND_DELAY_MS`（默认 4000）。测试环境使用默认值；端到端与独立测试以“等待快照/页面出现目标状态”（超时建议 15 秒）代替固定等待。
- 随机性（打乱、洗牌、电脑选择）在部署的服务中不可设定种子（TD-014）。需要特定局面的场景（例如翻开的象/相过河）通过反复操作达到：与电脑对局中走动己方盖棋直到翻出目标身份，不满足就认输重开（每局红方 15 枚盖棋中有 2 枚相、2 枚仕）。单元/集成测试通过注入 `seededRng` 构造确定局面：服务端以工厂函数 `createServer({ config, rng, logger })`（`src/server/http/` 导出，`main.ts` 用 `cryptoRng` 调用）组装，集成测试在进程内调用该工厂并传入 `seededRng`，不经任何环境变量或接口。

### 关键控件的无障碍角色与可见名称

测试按角色与名称定位（Playwright `getByRole(role, {name})`），不按样式或 DOM 结构。

| 页面/区域 | 角色 | 名称 | 说明 |
|---|---|---|---|
| 注册页 `/register` | `textbox` | 用户名 | |
| | `textbox`（type=password，Playwright 中按 label 定位 `getByLabel('密码')`） | 密码 | |
| | `button` | 注册 | |
| | `link` | 已有账号？去登录 | |
| 登录页 `/login` | `textbox` / 密码框 | 用户名 / 密码 | 同上 |
| | `button` | 登录 | |
| | `link` | 没有账号？去注册 | |
| 任一表单 | `alert` | — | 文本为错误码表中的 message，例如“用户名已被占用”“用户名或密码错误”“用户名为必填项” |
| 大厅 `/lobby` | `heading` | 游戏大厅 | |
| | `region` | 我的信息 | 内含文本“用户名：{用户名}”“积分：{n}”“筹码：{n}”（负数带“-”号，FR-007） |
| | `button` | 开中国象棋房间 / 开德州扑克房间 / 与电脑下盲棋 / 刷新房间列表 | |
| | `table` | 房间列表 | 列：游戏类型（“中国象棋”/“德州扑克”）、房主、人数（“1/2”）、状态（“可加入”/“已满”）、操作；每行 `row`，行内 `button` 名称“加入”（满员时不渲染该按钮）。按房主用户名所在的 `row` 定位 |
| 房间（共用） | `heading` | 中国象棋房间 / 与电脑对战 / 德州扑克房间 | |
| | `button` | 离开房间 | 已结束的象棋对局中为“返回大厅” |
| | `alert` | — | 被拒绝操作的提示（错误码 message） |
| 象棋 | `group` | 棋盘 | |
| | `button`（90 个，位于“棋盘”内） | `{坐标} {内容}` | 坐标见“象棋坐标”；内容为“空”“红暗子”“黑暗子”或“红帅”“黑车”等（红方：帅仕相马车炮兵；黑方：将士象马车炮卒）。例：`e0 红帅`、`b2 红暗子`、`e4 空`。选中后 `aria-pressed=true`。走棋 = 依次点击起点与终点。黑方视角棋盘旋转显示，名称不变 |
| | `status` | 对局状态 | 文本含“你执红”/“你执黑”、“轮到红方”/“轮到黑方”/“轮到你走棋”、“将军” |
| | `region` | 被吃的棋子 | 每枚为一个 `listitem`，文本如“黑马” |
| | `button` | 认输 / 提和 / 同意和棋 / 拒绝和棋 | 后两个只在有待回应的提和时出现；被拒后提和方看到 `status` 文本“对方拒绝了提和” |
| | `dialog` | 对局结果 | 文本含“你赢了”/“你输了”/“和棋”、结束原因（将死/困毙/认输/双方同意和棋/双方只剩将帅）、“积分变化：+10”/“积分变化：-10”/“积分变化：0”、“当前积分：{n}”；含 `button` “返回大厅” |
| 扑克 | `region` | 牌桌 | |
| | `region`（每个有人的座位一个） | `座位 {n}：{名称}` | 电脑玩家名称为“电脑 1”…并另有文本“电脑”；内含“筹码：{n}”、“本手投入：{n}”、状态文本（“庄家”“小盲”“大盲”“已弃牌”“行动中”“已达上限”“下一手加入”） |
| | `region` | 公共牌 | 每张牌为 `img`，名称如“红桃A”“方块10” |
| | `region` | 我的底牌 | 两张 `img`，名称同上 |
| | `status` | 底池 | 文本“底池：{n}” |
| | `log` | 牌局记录 | 每条行动一行，例如“alice 加注到 60”“电脑 1 跟注 20”“bob 弃牌”“小盲 5”，摊牌时“alice 两对 赢得 120” |
| | `button` | 开始牌局 / 添加电脑玩家 | 只对房主显示；条件不满足时 `disabled` |
| | `button` | 弃牌 / 过牌 / 跟注 {n} / 下注 / 加注 | 只在轮到自己时启用；跟注按钮名称含金额，如“跟注 20” |
| | `spinbutton` | 金额 | 下注/加注的“下注到”金额，默认 `minRaiseTo` |

### 开发者命令（部署声明 `.ai-delivery/features/001-v1/runtime/deployment.json`）

| 类别 | 命令 | 验证什么 | 全量运行一次的大致用时 |
|---|---|---|---|
| `staticAnalysis` | `npm run lint`；`npm run typecheck` | ESLint 规则；前后端 TypeScript 严格类型检查 | 约 30 秒（估计） |
| `build` | `npm run build` | 前端 Vite 构建 + 服务端 tsc 编译到 `dist/` | 约 40 秒（估计） |
| `developerTests` | `npm run test:unit` | 单元测试（`tests/unit/`，Vitest，无外部依赖）：揭棋开局打乱不变量（每方 1 帅/将翻开 + 15 盖棋，身份集合与标准相同，种子不同分布不同）；盖棋按位置类型走、翻开后按实际身份走、象/相过河与士/仕出九宫被允许、将帅照面与送将被拒；将死/困毙/只剩将帅判定；`viewFor` 不泄露盖棋身份与他人底牌；牌型评估与比较（含 A-2-3-4-5、平分）；边池与零头分配；下注规则（最小加注、每手上限 1000、全下例外、负余额照常下注）；电脑对手只产生合规着法/行动 | 约 30 秒（估计，约 200～300 个用例） |
| `integrationTests` | `npm run test:integration` | 集成测试（`tests/integration/`，Vitest，真实 PostgreSQL `dev` 实例 + 进程内启动的服务 + `fetch`/`socket.io-client`）：注册/登录/占用/必填、未登录拒绝（REST 与握手）、开房/加入/满员/同时只在一个房间、联机走棋推送到对方、积分结算 +10/−10/和棋不变且只结算一次、提和与自动和棋、扑克盲注扣除、行动推送、弃到只剩一人、摊牌分配、负余额继续下注、筹码跨房间与重新登录保留、电脑玩家添加与自动行动、离开即认输/弃牌 | 约 2～3 分钟（估计，约 40～60 个用例，每个 1～5 秒） |

- 单元测试与集成测试中 `viewFor`、引擎的结论可作为独立测试引用的开发者检查：例如“盖棋身份在任何请求中都不可得”（FR-023）除公开接口抽查外，可引用 `developerTests` 中 `viewFor` 的信息裁剪测试。

### 端到端用例（不写进部署声明）

- 位置 `e2e/*.spec.ts`（Playwright，Chromium；手机适配用 `devices['Pixel 7']` 项目，FR-080）。`playwright.config.ts` 的 `webServer` 先 `npm run build` 再以 `PORT=${E2E_PORT:-4173}`、`DB_SCHEMA=e2e_<运行编号>` 启动 `node dist/server/main.js`，并把 `AI_MOVE_DELAY_MS`、`POKER_BOT_DELAY_MS`、`POKER_NEXT_HAND_DELAY_MS` 设为 50/50/500 以缩短等待。
- 单独运行一个用例：`npx playwright test e2e/<文件>.spec.ts -g "<用例标题>"`（只跑手机项目加 `--project=mobile`）。
- 规模（估计）：约 20 个用例；单个用例约 15～60 秒（扑克多手牌用例偏长），首次运行另加构建约 40 秒；全量约 8～12 分钟。

### 并行运行与隔离

- 集成测试：Vitest 多个 worker 并行，每个 worker 在启动时创建自己的 schema `it_<运行编号>_<workerId>`（运行编号取时间戳 + 随机后缀），以 `DB_SCHEMA` 启动进程内服务并执行迁移，结束时 `DROP SCHEMA … CASCADE`；服务监听 `127.0.0.1:0`（系统分配端口），每个 worker 的服务实例与内存房间互不共享。与其他会话共用同一个 `dev` 数据库实例时，只要运行编号不同就互不干扰；异常中断残留的 `it_*`/`e2e_*` schema 可在下次运行开始时删除 24 小时前创建的同前缀 schema（按 `schema_migrations.applied_at` 判断）。
- 端到端：每次 `npx playwright test` 用自己的 `DB_SCHEMA` 与端口（`E2E_PORT`）；同一次运行内 Playwright worker 共用一个服务实例，用例之间以唯一用户名前缀隔离。
- 独立测试（测试环境）：共用一个部署的服务与 `test` 数据库，以用户名前缀隔离；每个用例结束时离开所在房间。

## 安全、隐私、身份与 Secret

- **凭据**：应用唯一的凭据是数据库密码，从 `AIDH_DEP_POSTGRES_PASSWORD` 读取，不写入代码、日志或错误响应；没有应用机密（`docs/dependencies.json` 的 `secrets` 为空）。`AIDH_DEP_POSTGRES_AUTH_MODE` 只支持 `credential`，其他取值启动失败并记录 `fatal`（不含凭据值）。
- **密码与会话**：密码只存 scrypt 散列（TD-008）；会话令牌只存 SHA-256；Cookie HttpOnly、SameSite=Lax，`COOKIE_SECURE`（默认 `NODE_ENV=production` 时为 true；测试环境网关是 HTTPS，浏览器可正常回传 Secure Cookie；本地 `http://localhost` 开发与端到端测试设为 false）。
- **注册与登录响应**：用户名存在与否不通过登录响应区分（同一错误码与提示，A-2）。
- **授权（least privilege）**：每个房间接口先校验成员身份；走棋只能移动 `yourColor` 一方且轮到该方；扑克行动只能由 `toActSeat` 对应的用户发起；开始牌局与添加电脑玩家只限房主；提和回应只限被提和方。
- **隐藏信息**：见 TD-006；`viewFor` 是快照唯一出口；错误消息与日志中也不出现盖棋身份、底牌、牌堆。
- **跨站防护**：写操作要求 `Content-Type: application/json`；socket.io 握手校验 `Origin` 与 `Host` 同源（反向代理后以 `X-Forwarded-Host` 优先，Express 设置 `trust proxy` 为 1）。
- **输入验证**：请求体上限 16KB；坐标匹配 `^[a-i][0-9]$`；`amount` 为安全整数且 > 0；`game` 为枚举；路径参数 `:id` 为 uuid 格式，否则 404。
- **日志**：不记录请求体、Cookie、密码、用户名（只记用户 ID）、底牌、盖棋身份（TD-012）。

## 配置、可观测性与运维

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8080 | 监听端口（部署声明 `port` 为 8080） |
| `NODE_ENV` | `production`（镜像内） | |
| `AIDH_DEP_POSTGRES_ADDRESS` / `_DATABASE` / `_USER` / `_PASSWORD` / `_SSLMODE` / `_AUTH_MODE` | 平台注入 | 数据库接入；`SSLMODE` 语义见下条 |
| `DB_SCHEMA` | `public` | 非 `public` 时启动时 `CREATE SCHEMA IF NOT EXISTS` 并在每个连接上设置 `search_path`（TD-009，用于测试隔离） |
| `COOKIE_SECURE` | 生产为 `true` | 本地 HTTP 测试设为 `false` |
| `AI_MOVE_DELAY_MS` / `POKER_BOT_DELAY_MS` / `POKER_NEXT_HAND_DELAY_MS` | 600 / 800 / 4000 | 见 TD-015、TD-017、TD-021 |
| `LOG_LEVEL` | `info` | pino 级别 |

- `SSLMODE` 按 libpq 的语义：`disable` 不加密（平台容器实例，集群内网络）；`require` 加密但不校验证书（`ssl: {rejectUnauthorized: false}`）；`verify-full` 加密并按 Node 默认 CA 校验证书与主机名（`ssl: true`）。探测脚本按同样语义连接。客户提供的实例建议使用 `verify-full`。
- 业务参数（盲注 5/10、每手上限 1000、初始积分/筹码 1000、积分 ±10）是规格取值，写成 `src/shared/constants.ts` 常量，不做成环境变量（规格要求固定值；假设在 G2 改动时改常量）。

### 日志与错误识别

- 日志格式：每行一条 JSON（pino），字段 `level`（`trace`/`debug`/`info`/`warn`/`error`/`fatal`）、`time`、`msg`，以及 `event`（如 `http_request`、`chess_finished`、`poker_hand_settled`、`settlement_failed`、`migration_failed`）、`roomId`、`gameId`/`handId`、`userId`、`code`。
- 写 `error` 的情况：未捕获的路由异常（返回 500 `INTERNAL_ERROR`）、结算写库失败、迁移失败、数据库连接池错误；`fatal`：启动失败、未捕获异常/拒绝。被拒绝的业务操作（409 等）只记 `info`，不记 `warn`/`error`（它们是正常用户行为）。数据库连接失败后的重试记 `warn`。
- 部署声明 `operations.errorLogRules`：`app-error-log`（`kind: structured`，`level` ∈ `error`/`fatal`，高）、`node-fatal`（`kind: pattern`，行首 `FATAL ERROR:`，V8 致命错误，高）、`app-warn-burst`（`kind: structured`，5 分钟内 ≥ 20 条 `warn`，中）。

## SLO、限制、扩缩容、重试与恢复

- 规格没有性能、可用率或并发要求；本方案不设 SLO。单进程预计可承载数百个并发连接与数十个房间（每次推送为几 KB 的快照），满足本交付验收。
- 只支持单实例运行（TD-003，验证见 OD-1）。
- 数据库：连接池 10；启动时数据库不可用则每 2 秒重试、最多 60 秒，之后 `fatal` 退出；运行中查询失败对该请求返回 500，结算失败按“数据流”第 4 步后台重试。
- 实时连接：socket.io 客户端自动重连（指数退避，上限 5 秒）；重连后服务端推送最新快照，前端以 `version` 丢弃旧快照。
- 优雅退出：收到 SIGTERM 后停止接受新连接，等待进行中的请求与结算写库完成（最多 10 秒）后退出。

## 部署拓扑、迁移、Rollout 与 Rollback

- 拓扑：服务 `web`（`docs/deployment.json`，构建 `Dockerfile`，端口 8080，健康 `/healthz`，对外）+ 依赖 `postgres`（`docs/dependencies.json`，平台容器 `postgres:16`，以 UID/GID 999 运行，数据目录 `/var/lib/postgresql/data/pgdata` 位于挂载点下的子目录）。
- 迁移：应用启动时自动执行（TD-009），只做向前；以 `schema_migrations` 记录已执行的版本，未执行的迁移各自在一个事务中执行，多实例同时启动时由 `pg_advisory_lock` 串行化。本交付只有 `001_init.sql`。
- Rollout：平台按提交 SHA 构建镜像并替换；替换会丢失内存中的房间（见 Runbook）。
- Rollback：重新部署上一版本镜像即可；`001_init` 之后的迁移须保持对上一版本向后兼容（只加列/加表），本交付无此情况。数据库无需回滚。

## 验证环境责任矩阵（Verification Environment）

| 验证类型 | 责任阶段 | 环境来源 | 依赖/凭据 | Coding 证据 | 下游结果 |
|---|---|---|---|---|---|
| 静态检查、构建 | 编码（每批）/ 平台部署前验证 | Agent Pod | 无 | `npm run lint`、`typecheck`、`build` 通过 | 部署前验证记录 |
| 单元测试 | 编码（每批）/ 平台部署前验证 | Agent Pod | 无 | `npm run test:unit` 通过 | 可被测试计划作为 `developer-check` 引用 |
| 集成测试（真实 PostgreSQL） | 编码（每批）/ 平台部署前验证 | Agent Pod + `postgres` `dev` 实例 | `AIDH_DEP_POSTGRES_*`（dev） | `npm run test:integration` 通过 | 同上 |
| 端到端（Playwright，电脑与手机视口） | 编码（新增或改动的用例单独运行） | Agent Pod `localhost` + `dev` 实例 | 同上 | 相关用例通过的输出 | — |
| 探测 | 平台（依赖绑定后） | 隔离探测环境 | `AIDH_DEP_POSTGRES_*` | — | `reachable`/`authenticated` |
| 测试环境部署健康 | 平台 | `cand-*` 命名空间 | `test` 实例 | — | `/healthz` 200 |
| 独立测试（验收） | 独立测试（G3） | 测试环境 HTTPS 地址 `AIDH_SERVICE_WEB_URL` | `test` 实例；测试账号由脚本自行注册，无需项目机密 | — | 各 AC 结论 |

## 快速验证指南（Quickstart）

### 实验 E-1：socket.io 长轮询回退与握手鉴权、pino 级别标签（用时约 5 分钟）

目的：U-1（网关不支持 WebSocket 时的回退）、U-2（pino 级别字段写法）、U-3（握手阶段按 Cookie 拒绝）。在仓库外的临时目录进行，结束后已删除。

```bash
mkdir -p /tmp/e1 && cd /tmp/e1 && npm init -y >/dev/null
npm view socket.io version; npm view pino version; npm view pg version   # 观察：4.8.4 / 10.4.0 / 8.23.1（写方案时的最新版本）
npm i socket.io@4.8.1 socket.io-client@4.8.1 pino@9
cat > e1.mjs <<'JS'
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import pino from 'pino';
const log = pino({ formatters: { level: (label) => ({ level: label }) } });
log.error({ code: 'X' }, 'boom');
const http = createServer();
const srv = new Server(http, { allowRequest: (req, cb) => cb(null, (req.headers.cookie||'').includes('sid=abc')) });
srv.on('connection', (s) => { s.emit('room:state', { v: 1, transport: s.conn.transport.name }); });
http.listen(0, () => {
  const port = http.address().port;
  for (const [name, transports, cookie] of [['polling-only',['polling'],'sid=abc'],['default',undefined,'sid=abc'],['nocookie',['polling'],'']]) {
    const c = io(`http://localhost:${port}`, { transports, extraHeaders: cookie ? { cookie } : {}, reconnection:false });
    c.on('room:state', (m) => { console.log(name, 'got', JSON.stringify(m)); c.close(); });
    c.on('connect_error', (e) => { console.log(name, 'connect_error', e.message); c.close(); });
  }
  setTimeout(() => process.exit(0), 1500);
});
JS
node e1.mjs
```

观察到的输出：

```
{"level":"error","time":…,"pid":…,"hostname":"…","code":"X","msg":"boom"}
nocookie connect_error xhr poll error
polling-only got {"v":1,"transport":"polling"}
default got {"v":1,"transport":"polling"}
```

结论：pino 按标签写 `"level":"error"`、消息在 `msg`（U-2）；只允许长轮询时连接与推送正常，默认配置也以长轮询建立连接（U-1 的回退成立）；`allowRequest` 拒绝时客户端得到 `connect_error`（U-3）。

### 探测脚本本地自检（不连数据库）

```bash
AIDH_PROBE_RESULT=/tmp/p.json AIDH_DEP_POSTGRES_ADDRESS=127.0.0.1:5999 bash deploy/probes/postgres.sh; cat /tmp/p.json
# 观察：{"reachable": false, "authenticated": false, "results": []}
```

认证路径（SCRAM-SHA-256 / MD5 / 明文）按 PostgreSQL 协议文档实现，由平台对 `dev`/`test` 实例运行探测验证。

### 本地运行（编码完成后）

```bash
npm ci
npm run build
COOKIE_SECURE=false DB_SCHEMA=dev_$USER PORT=8080 node dist/server/main.js   # 使用注入的 AIDH_DEP_POSTGRES_*（dev 实例）
curl -s localhost:8080/healthz                                              # {"status":"ok"}
curl -s -c /tmp/c -H 'content-type: application/json' -d '{"username":"qa_x_alice","password":"p"}' localhost:8080/api/auth/register
curl -s -b /tmp/c localhost:8080/api/me                                     # rating 1000, chips 1000, currentRoomId null
```

### 实验 E-2：Pod 预装浏览器与 `@playwright/test` 版本的对应（用时约 3 分钟）

```bash
ls /ms-playwright            # 观察：chromium-1255  chromium_headless_shell-1255  ffmpeg-1013  firefox-1572  webkit-2388
mkdir -p /tmp/e2 && cd /tmp/e2
for v in 1.65.1 1.64.0 1.63.0; do
  npm pack playwright-core@$v --silent >/dev/null && tar -xzf playwright-core-$v.tgz package/browsers.json
  echo "$v: $(jq -c '[.browsers[]|select(.name=="chromium")|.revision]' package/browsers.json)"; rm -rf package
done
# 观察：1.65.1: ["1255"]   1.64.0: ["1248"]   1.63.0: ["1243"]
```

结论：精确锁定 `@playwright/test@1.65.1`（TD-023）。若 Pod 镜像日后升级浏览器，按同样方法重新对照版本。

## 支持 Runbook

| 现象 | 原因 | 处理 |
|---|---|---|
| 部署后 `/healthz` 返回 503 | 数据库不可达或凭据错误 | 查看日志 `event=db_connect_failed`（`warn`）；在依赖与机密任务中重新探测 `postgres` |
| 服务重启/重新部署后，玩家回到大厅、进行中的对局消失 | 对局状态只在内存（TD-003） | 预期行为：进行中的象棋对局不计分，进行中的扑克手牌作废（无人增减）；已结束对局的结算已在数据库 |
| 日志 `event=settlement_failed`（`error`） | 结算写库失败 | 服务每 5 秒自动重试；数据库恢复后出现 `event=settlement_retried_ok`。主键保证不会重复计分 |
| 日志 `event=migration_failed`（`fatal`）且服务无法启动 | 迁移 SQL 失败 | 查看 `code`；修复迁移后重新部署（已执行的迁移不会重复执行） |
| 实时推送延迟较大 | 网关不支持 WebSocket，socket.io 停留在长轮询 | 功能不受影响；如需改善，请平台确认网关的 WebSocket 升级支持（OD-2） |
| 同一房间的玩家看到的状态不一致或“房间不存在” | `web` 以多实例运行（OD-1 假设不成立） | 将 `web` 调整为单实例，或按 OD-1 后备做法改造 |

## 开放决策

### 待验证假设

- **OD-1（U-4）：测试环境中 `web` 服务只运行一个实例。**
  - 已做的尝试：查阅 `runtime/candidate.md`、`runtime/catalog-facts.md`，没有写明副本数；本会话不能访问集群。
  - 依赖它的决定：TD-003（内存状态）、TD-004（socket.io 无粘性会话）、TD-018（进程内房间锁）。
  - 验证步骤：测试环境部署后，在独立测试会话中读取 `QA_SERVICE_LOGS_DIR/logs.jsonl`，确认 `service=web` 的日志只有一个 `instance` 取值；应用启动时写一条 `info` 日志 `event=server_started`，带随机 `bootId`，同一时段内只应出现一个 `bootId`。也可在测试环境中由两名用户在同一房间连续操作 20 次，均无 `ROOM_NOT_FOUND`。
  - 后备做法（验证失败时）：房间与对局状态改为保存在 PostgreSQL（`rooms` 表存 JSON 快照与 `version`，写操作 `SELECT … FOR UPDATE` 串行化），实例间推送改用 `@socket.io/postgres-adapter`（基于 PostgreSQL `LISTEN/NOTIFY`），并为长轮询开启基于 Cookie 的粘性或改为只用 WebSocket 传输。仍只用现有的 `postgres` 依赖，不新增依赖；改动集中在 `src/server/rooms/` 的存取层，规则引擎与接口契约不变。
- **OD-2（U-1）：平台网关是否支持 WebSocket 升级。** 不影响功能（socket.io 停留在长轮询时功能相同），只影响推送延迟。验证步骤：测试环境中用 Playwright 打开房间页面并记录网络请求（`page.on('websocket')` 或浏览器开发者工具的网络面板），出现 `…/socket.io/?EIO=4&transport=websocket` 的连接即支持升级；只有 `transport=polling` 的请求时说明停留在长轮询，无需处理。

### 建议，未纳入，待 G2 决定

- 建议，未纳入，待 G2 决定：注册与登录接口的频率限制（例如同一来源每分钟最多 N 次），防止口令暴力尝试。需求原文、意图与规格均未提出；本方案未实现。
