# DeonGame 系统现状

本文件记录项目代码中已有的事实，每条带出处（仓库相对路径）。依据：交付 DLV-20261127-CB228EF706CC V1（Feature 目录 `.ai-delivery/features/002-v1/`）发布时分支上的代码（此前版本依据交付 DLV-20261127-3F66291309FB V1，Feature 目录 `.ai-delivery/features/001-v1/`）。

## 概览

- 网页游戏大厅：注册登录、开房/加入房间，揭棋（盲棋）中国象棋（联机双人、与电脑）与德州扑克（多人联机，可由房主加电脑玩家）（出处：`README.md`、`src/server/http/roomRoutes.ts`）。
- 单体服务：一个 Node.js 进程同时提供网页前端静态文件、REST 接口 `/api/*`、实时推送 `/socket.io/*`（出处：`src/server/http/app.ts`、`docs/deployment.json`）。
- 用户数据（账号、积分、筹码余额、登录会话、结算记录）持久化在 PostgreSQL；房间与对局过程只在服务进程内存中，不写入数据库，进程重启后房间与进行中的对局丢失（出处：`src/server/rooms/roomManager.ts` 的 `RoomManager.rooms` 为内存 `Map`；`src/server/db/migrations/001_init.sql` 无房间表）。
- 部署声明中只有一个服务 `web`（端口 8080，健康检查 `/healthz`，对外暴露）（出处：`docs/deployment.json`）。

## 技术栈与版本

| 部分 | 选用 | 版本（`package-lock.json` 解析结果） | 出处 |
|---|---|---|---|
| 运行时 | Node.js | `engines.node` 为 `>=22`；镜像 `node:22-bookworm-slim` | `package.json`、`Dockerfile` |
| 语言 | TypeScript（`strict`、`noUncheckedIndexedAccess`），ES 模块（`"type": "module"`） | typescript 5.9.3 | `package.json`、`tsconfig.json`、`tsconfig.server.json` |
| HTTP 框架 | Express | 5.3.0 | `package.json`、`src/server/http/app.ts` |
| 实时推送 | socket.io / socket.io-client | 4.8.4 | `src/server/realtime/socket.ts`、`src/web/socket.ts` |
| 数据库驱动 | pg | 8.23.1 | `src/server/db/pool.ts` |
| 日志 | pino（JSON，ISO 时间，`level` 为文字标签） | 9.14.0 | `src/server/logger.ts` |
| 前端 | React + react-router（`BrowserRouter`） | react 19.3.1、react-router 7.18.7 | `src/web/main.tsx` |
| 前端构建 | Vite + @vitejs/plugin-react | vite 8.4.0 | `vite.config.ts` |
| 开发运行 | tsx（`tsx watch`） | 4.23.15 | `package.json` |
| 单元/集成测试 | Vitest | 5.1.2 | `vitest.config.ts`、`vitest.integration.config.ts` |
| 端到端测试 | Playwright | 1.65.1 | `playwright.config.ts` |
| 静态检查 | ESLint（flat config，`@eslint/js` + `typescript-eslint`） | eslint 10.15.0 | `eslint.config.js` |
| 数据库 | PostgreSQL（依赖建议为容器 `postgres:16`） | — | `docs/dependencies.json` |

## 目录与模块

| 路径 | 职责 | 出处 |
|---|---|---|
| `src/server/main.ts` | 生产入口：解析配置、创建服务（数据库连接带重试）、监听 `0.0.0.0:PORT`、处理 SIGTERM/SIGINT（10 秒后强制退出） | `src/server/main.ts` |
| `src/server/config.ts` | 从环境变量解析配置（`parseConfig`），非法值抛 `ConfigError` 并使进程以 1 退出 | `src/server/config.ts` |
| `src/server/http/app.ts` | `createServer`：建连接池、执行迁移、组装 `AppContext`、Express 中间件与路由、静态前端、统一错误处理、挂载 socket.io | `src/server/http/app.ts` |
| `src/server/http/authRoutes.ts` | 注册、登录、退出登录、`/api/me` | 同左 |
| `src/server/http/roomRoutes.ts` | 大厅房间、人机象棋、房间状态；挂载象棋与扑克子路由 | 同左 |
| `src/server/http/chessRoutes.ts` / `pokerRoutes.ts` | 象棋走棋/认输/提和/回应；扑克开始/加电脑/行动 | 同左 |
| `src/server/auth/` | 密码散列（`password.ts`）、会话存储、吊销与 Cookie 解析（`sessions.ts`）、`requireAuth` 中间件与设置/清除会话 Cookie（`middleware.ts`） | 同左 |
| `src/server/db/` | 连接池（`pool.ts`）、迁移执行（`migrate.ts`）、迁移脚本（`migrations/*.sql`）、用户仓储（`users.ts`）、象棋结算写库（`chessResults.ts`）、扑克结算写库与余额读取（`pokerSettlements.ts`） | 同左 |
| `src/server/rooms/roomManager.ts` | 内存中的房间、象棋对局、扑克牌桌状态与全部业务写操作；电脑对手/电脑玩家与自动下一手的定时任务 | 同左 |
| `src/server/rooms/view.ts` | `viewFor`：按查看者裁剪房间快照，是房间状态离开服务端的唯一出口 | `src/server/rooms/view.ts` 注释 |
| `src/server/rooms/chessSettlement.ts` / `pokerSettlement.ts` | 结算回调：写库失败时每 5 秒后台重试 | 同左 |
| `src/server/rooms/mutex.ts` | `AsyncMutex`：按 Promise 链串行执行 | 同左 |
| `src/server/realtime/socket.ts` | socket.io 握手鉴权、Origin 校验、按用户推送 `room:state` / `room:closed` | 同左 |
| `src/server/errors.ts` | `AppError`：错误码到 HTTP 状态码的映射 | 同左 |
| `src/shared/xiangqi/index.ts` | 揭棋规则引擎（纯函数，随机数注入） | 同左 |
| `src/shared/poker/` | 牌与牌组（`cards.ts`）、牌型评估（`evaluator.ts`）、边池分配（`pots.ts`）、手牌状态机与下注规则（`hand.ts`） | 同左 |
| `src/shared/ai/` | 象棋电脑对手（`chessAi.ts`）、扑克电脑玩家（`pokerBot.ts`） | 同左 |
| `src/shared/protocol.ts` | 前后端共用的接口类型与错误码中文提示 `ERROR_MESSAGES` | 同左 |
| `src/shared/constants.ts` | 业务常量（见“业务规则与常量”） | 同左 |
| `src/shared/ui/` | 前端用的纯函数：棋盘几何与方向（`board.ts`）、由相邻两次快照推导动画/音效事件（`events.ts`）、大厅房间名/状态文字/可否加入（`lobby.ts`）、加注快捷金额与范围校验（`raise.ts`）、扑克座位环形布局（`seatLayout.ts`） | 同左 |
| `src/shared/rng.ts` | `Rng` 接口、`cryptoRng`（`crypto.randomInt`）、测试用 `seededRng`（mulberry32）、Fisher–Yates `shuffle` | 同左 |
| `src/web/` | 前端：`main.tsx`（路由、安装音频解锁）、`api.ts`（REST 封装）、`socket.ts`、`pages/`（`AuthPage`、`LobbyPage`、`RoomPage`）、`components/`（`ChessBoard`、`ChessPiece`、`PokerTable`、`PlayingCard`、`SuitIcon`、`PokerActionBar`、`CreateRoomDialog`、`Modal`、`TopBar`、`GameIcons`、`ConnectionStatus`、`SoundControls`、`Toast`）、`hooks/`（`usePolling`、`useRoomFeed`）、`anim/`（`durations.ts`、`pokerAnim.ts`）、`audio/sound.ts`、`styles.css`（汇总 `styles/` 下 `tokens`、`base`、`auth`、`lobby`、`chess`、`poker` 六个样式文件） | 同左 |
| `tests/unit/`、`tests/integration/`、`tests/support/server.ts` | Vitest 单元与集成测试及测试服务启动辅助 | 同左 |
| `e2e/`、`e2e/support/` | Playwright 端到端用例 | 同左 |
| `deploy/probes/postgres.sh` | PostgreSQL 依赖探测脚本（bash + `python3 -I`，连通、认证、`SELECT 1`） | 同左 |
| `docs/api.md` | 接口说明文档 | 同左 |
| `docs/dependencies.json`、`docs/deployment.json` | 依赖声明、部署声明 | 同左 |
| `scripts/copy-migrations.mjs` | 构建时把 `src/server/db/migrations` 复制到 `dist/server/db/migrations` | 同左 |

## 命令

| 命令 | 作用 | 出处 |
|---|---|---|
| `npm ci` | 安装依赖 | `README.md`、`.ai-delivery/features/002-v1/runtime/deployment.json`（`developerSetupCommands`） |
| `npm run dev` | `vite build && tsx watch src/server/main.ts` | `package.json` |
| `npm run build` | `vite build`（输出 `dist/web`）+ `tsc -p tsconfig.server.json`（输出 `dist/`，`rootDir` 为 `src`，含 `src/server`、`src/shared`）+ 复制迁移脚本 | `package.json`、`vite.config.ts`、`tsconfig.server.json` |
| `npm start` | `node dist/server/main.js`，启动时自动执行数据库迁移 | `package.json`、`src/server/http/app.ts` |
| `npm run lint` | `eslint .`（忽略 `dist/**`、`node_modules/**`、`test-results/**`、`playwright-report/**`、`.ai-delivery/**`） | `package.json`、`eslint.config.js` |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit` | `package.json` |
| `npm run test:unit` | Vitest，`tests/unit/**/*.test.ts`，无外部依赖 | `package.json`、`vitest.config.ts` |
| `npm run test:integration` | Vitest，`tests/integration/**/*.test.ts`，需要 PostgreSQL；`testTimeout` 20 秒、`hookTimeout` 60 秒 | `package.json`、`vitest.integration.config.ts` |
| `npm run test:e2e` / `npx playwright test` | Playwright，项目 `chromium`（Desktop Chrome）与 `mobile`（Pixel 7） | `package.json`、`playwright.config.ts` |

- 部署声明中的开发者检查：`staticAnalysis` 为 `npm run lint`、`npm run typecheck`；`build` 为 `npm run build`；`developerTests` 为 `npm run test:unit`；`integrationTests` 为 `npm run test:integration`（出处：`.ai-delivery/features/002-v1/runtime/deployment.json`，与 `001-v1` 相同）。
- Vite 开发服务器把 `/api` 与 `/socket.io`（含 WebSocket）代理到 `http://localhost:8080`（出处：`vite.config.ts`）。

## 外部依赖和配置

### 外部依赖

- `postgres`（`kind: postgresql`）：唯一的外部依赖；保存账号、积分、筹码余额、登录会话与结算记录；依赖建议形态为容器（镜像 `docker.io/library/postgres:16`，端口 5432，存储 2Gi），`dev` 与 `test` 都要求真实实例；接入字段 `ADDRESS`、`DATABASE`、`USER`、`PASSWORD`（机密）、`SSLMODE`；探测脚本 `deploy/probes/postgres.sh`；项目级 `secrets` 为空（出处：`docs/dependencies.json`）。
- 应用只支持用户名/密码方式连接数据库（`AIDH_DEP_POSTGRES_AUTH_MODE` 只接受空或 `credential`）（出处：`src/server/config.ts`）。

### 环境变量

| 变量 | 含义与取值 | 默认 | 出处 |
|---|---|---|---|
| `AIDH_DEP_POSTGRES_ADDRESS` | `host:port`，按最后一个 `:` 拆分；缺失或非法时启动失败 | 无（必填） | `src/server/config.ts` |
| `AIDH_DEP_POSTGRES_DATABASE` / `_USER` / `_PASSWORD` | 数据库名、登录用户、密码 | 空字符串 | `src/server/config.ts` |
| `AIDH_DEP_POSTGRES_SSLMODE` | `disable`→不用 TLS；`require`→TLS 且不校验证书；`verify-full`→TLS 并校验；其他值启动失败 | `disable` | `src/server/config.ts` |
| `AIDH_DEP_POSTGRES_AUTH_MODE` | 只支持 `credential` | `credential` | `src/server/config.ts` |
| `NODE_ENV` | 为 `production` 时 `production=true`（影响 `COOKIE_SECURE` 默认值）；镜像中设为 `production` | — | `src/server/config.ts`、`Dockerfile` |
| `PORT` | 监听端口，非负整数 | 8080 | `src/server/config.ts` |
| `DB_SCHEMA` | 数据库 schema，须匹配 `^[a-z_][a-z0-9_]{0,62}$`；非 `public` 时启动时 `CREATE SCHEMA IF NOT EXISTS` 并以 `search_path` 连接 | `public` | `src/server/config.ts`、`src/server/db/pool.ts` |
| `COOKIE_SECURE` | 会话 Cookie 是否 `Secure`（`true`/`1`/`false`/`0`） | 与 `production` 相同 | `src/server/config.ts` |
| `LOG_LEVEL` | pino 日志级别 | `info` | `src/server/config.ts` |
| `AI_MOVE_DELAY_MS` | 象棋电脑对手走棋前延迟（毫秒） | 600 | `src/server/config.ts` |
| `POKER_BOT_DELAY_MS` | 扑克电脑玩家行动前延迟（毫秒） | 800 | `src/server/config.ts` |
| `POKER_NEXT_HAND_DELAY_MS` | 一手结束后自动开始下一手的延迟（毫秒） | 4000 | `src/server/config.ts` |

- 测试专用变量：`E2E_PORT`（默认 4173）、`E2E_RUN_ID`（Playwright）；`TEST_LOG_LEVEL`（集成测试日志级别，默认 `silent`）（出处：`playwright.config.ts`、`tests/support/server.ts`）。

## 数据模型（PostgreSQL）

迁移脚本只有 `001_init.sql`（出处：`src/server/db/migrations/001_init.sql`）。

| 表 | 字段 | 约束与说明 |
|---|---|---|
| `users` | `id uuid`、`username text`、`password_hash text`、`rating integer`（默认 1000）、`chips_balance bigint`（默认 1000）、`created_at timestamptz` | 主键 `id`；`username` 唯一（区分大小写）；`rating`、`chips_balance` 无下限约束，可为负数 |
| `sessions` | `token_hash text`、`user_id uuid`、`created_at`、`expires_at timestamptz` | 主键 `token_hash`；`user_id` 外键引用 `users(id)` `ON DELETE CASCADE`；索引 `sessions_user_id_idx` |
| `chess_results` | `game_id uuid`、`red_user_id uuid`、`black_user_id uuid NULL`、`mode text`、`outcome text`、`reason text`、`finished_at` | 主键 `game_id`（保证每局只结算一次）；人机对局 `black_user_id` 为 NULL |
| `poker_settlements` | `hand_id uuid`、`user_id uuid`、`delta bigint`、`created_at` | 主键 `(hand_id, user_id)`（保证每人每手只结算一次）；`user_id` 外键引用 `users(id)` |
| `schema_migrations` | `version text`、`applied_at` | 由迁移执行器创建，记录已执行的迁移文件名（去掉 `.sql`） |

- 迁移执行：启动时在 `pg_advisory_lock(72310001)` 下按文件名顺序执行未执行过的 `migrations/*.sql`，每个文件一个事务（出处：`src/server/db/migrate.ts`）。
- 连接池 `max: 10`；生产入口的首次连接最多重试 60 秒、每 2 秒一次（出处：`src/server/db/pool.ts`）。
- 读取 `chips_balance` 时以 `::float8` 转为 JS 数字（出处：`src/server/db/users.ts`、`src/server/db/pokerSettlements.ts`）。
- 象棋结算：一个事务内 `INSERT INTO chess_results … ON CONFLICT (game_id) DO NOTHING`，插入成功才按增量 `UPDATE users SET rating = rating + delta`（出处：`src/server/db/chessResults.ts`）。
- 扑克结算：一个事务内逐人 `INSERT INTO poker_settlements … ON CONFLICT DO NOTHING`，插入成功才 `UPDATE users SET chips_balance = chips_balance + delta`（出处：`src/server/db/pokerSettlements.ts`）。

## 内存模型（`src/server/rooms/roomManager.ts`）

- `Room`：`id`、`game`（`chess`/`poker`）、`mode`（`online`/`ai`）、`hostUserId`、`members`、`capacity`（象棋 2；扑克为建房时的人数上限 2–9，缺省 9）、`createdAt`、`version`（每次状态变化加 1）、`listed`（是否出现在大厅）、`closed`、`lock`（房间级 `AsyncMutex`）、`chess?`、`poker?`。
- `RoomManager` 持有 `rooms: Map<房间id, Room>` 与 `userRoom: Map<用户id, 房间id>`；`currentRoomId(userId)` 返回 `userRoom` 中的房间，`activeRoomId(userId)` 只在该房间存在且未 `closed` 时返回其 id；建房/加入/离开/加电脑玩家在全局锁 `globalLock` 下再进入房间锁；走棋、提和、扑克开始与行动只进入房间锁。
- `ChessGameState`：`id`、`status`（`waiting`/`active`/`finished`）、`players`（`red`/`black`）、`turn`、`board`、`captured`、`lastMove`、`drawOffer`、`drawDeclined`、`result`（`outcome`、`reason`、`settled`、`ratingChanges`）。
- `PokerTableState`：`seats`（恒为 9 个，只有下标小于房间 `capacity` 的座位会被分配（`pickFreeSeat`）；元素为 `{kind: 'human'|'bot', userId?, name, waitingNextHand?, chips?}` 或 null）、`handNumber`、`dealerSeat`、`hand`（`HandState`）、`handPlayers`（本手开始时各座位的占用者）、`balances`（真人用户的已知筹码余额）、`settledUserIds`、`nextHandPending`、`botCounter`。
- 电脑玩家的筹码只存在 `PokerSeat.chips`（初始 1000），不写数据库（出处：`src/server/rooms/roomManager.ts` 的 `addPokerBot`、`finishPokerHand`）。

## 接口

### 通用约定

- 写请求（非 GET/HEAD）到 `/api/*` 必须是 `Content-Type: application/json`，否则 `415 UNSUPPORTED_MEDIA_TYPE`；JSON 请求体上限 16KB，解析失败或超限返回 `400 VALIDATION_FAILED`（出处：`src/server/http/app.ts`）。
- 错误响应格式 `{"error":{"code","message"}}`；错误码到 HTTP 状态：`VALIDATION_FAILED` 400；`UNAUTHENTICATED`、`INVALID_CREDENTIALS` 401；`NOT_IN_ROOM`、`NOT_HOST` 403；`ROOM_NOT_FOUND` 404；`USERNAME_TAKEN`、`ROOM_FULL`、`ALREADY_IN_ROOM`、`NOT_YOUR_TURN`、`ILLEGAL_MOVE`、`GAME_NOT_ACTIVE`、`DRAW_OFFER_PENDING`、`NO_DRAW_OFFER`、`ILLEGAL_ACTION`、`HAND_IN_PROGRESS`、`NOT_ENOUGH_PLAYERS` 409；`UNSUPPORTED_MEDIA_TYPE` 415；`INTERNAL_ERROR` 500；中文提示见 `ERROR_MESSAGES`（出处：`src/server/errors.ts`、`src/shared/protocol.ts`）。
- 未匹配的 `/api/*` 路径返回 `404`，`code` 为 `ROOM_NOT_FOUND`、`message` 为“接口不存在”（出处：`src/server/http/app.ts`）。
- 路径中的房间 id 不是 UUID 格式时返回 `404 ROOM_NOT_FOUND`，合法时转为小写（出处：`src/server/http/roomRoutes.ts` 的 `roomIdParam`）。
- 鉴权：`/api/rooms/*` 与 `POST /api/chess/ai-games`、`GET /api/me` 经 `requireAuth`（`POST /api/auth/logout` 不经过），从 Cookie `dg_session` 取令牌，按 SHA-256 散列查 `sessions` 中未过期记录，失败返回 `401 UNAUTHENTICATED`（出处：`src/server/auth/middleware.ts`、`src/server/auth/sessions.ts`、`src/server/http/roomRoutes.ts`）。
- 会话 Cookie：`dg_session`，`HttpOnly`、`SameSite=Lax`、`Path=/`、`Secure` 取 `COOKIE_SECURE`；令牌为 32 字节随机数 base64url，库中只存 SHA-256；有效期 30 天，剩余不足 15 天时访问即续期 30 天并重设 Cookie；创建会话时删除该用户已过期的会话；退出登录时按令牌散列删除该会话记录，并以同样属性、`maxAge: 0` 清除 Cookie（出处：`src/server/auth/sessions.ts`、`src/server/auth/middleware.ts`、`src/shared/constants.ts`）。
- Express 设置 `trust proxy` 为 1，关闭 `x-powered-by`（出处：`src/server/http/app.ts`）。
- 前端静态文件：`dist/web/index.html` 存在时由服务端托管 `dist/web`，非 `/api/`、`/socket.io/` 的 GET 路径回退到 `index.html`（出处：`src/server/http/app.ts`）。

### REST 接口

| 方法与路径 | 请求 | 成功响应 | 主要错误 | 出处 |
|---|---|---|---|---|
| `GET /healthz` | — | `200 {"status":"ok"}`（执行 `SELECT 1`） | `503 {"status":"db-unavailable"}` | `src/server/http/app.ts` |
| `POST /api/auth/register` | `{username, password}` | `201 {user}` 并设置会话 Cookie | `400 VALIDATION_FAILED`、`409 USERNAME_TAKEN` | `src/server/http/authRoutes.ts` |
| `POST /api/auth/login` | `{username, password}` | `200 {user}` 并设置会话 Cookie | `400 VALIDATION_FAILED`、`401 INVALID_CREDENTIALS` | `src/server/http/authRoutes.ts` |
| `POST /api/auth/logout` | — | `204`（无响应体）；删除当前 Cookie 对应的会话并清除 Cookie；无会话或令牌无效时同样 `204` | — | `src/server/http/authRoutes.ts`、`src/server/auth/sessions.ts` 的 `revoke` |
| `GET /api/me` | — | `200 {user}` | `401` | `src/server/http/authRoutes.ts` |
| `GET /api/rooms` | — | `200 {rooms: RoomListItem[]}`，只含 `listed` 且未关闭的房间，按创建时间倒序 | `401` | `src/server/http/roomRoutes.ts`、`RoomManager.list` |
| `POST /api/rooms` | `{game: "chess"\|"poker", capacity?}`；`capacity` 只对扑克生效，须为 2–9 的整数，缺省 9；象棋忽略 | `201 {room}` | `400`（`capacity` 不合法时消息“人数上限必须是 2～9 的整数”）、`409 ALREADY_IN_ROOM` | `src/server/http/roomRoutes.ts` |
| `POST /api/rooms/:id/join` | — | `200 {room}`；已是成员时直接返回 | `404 ROOM_NOT_FOUND`（含未列出的人机房间）、`409 ROOM_FULL`、`409 ALREADY_IN_ROOM` | `src/server/http/roomRoutes.ts`、`RoomManager.join` |
| `POST /api/rooms/:id/leave` | — | `200 {}` | `403 NOT_IN_ROOM`、`404` | `src/server/http/roomRoutes.ts` |
| `GET /api/rooms/:id/state` | — | `200 {room}`（仅成员） | `403 NOT_IN_ROOM`、`404` | `src/server/http/roomRoutes.ts` |
| `POST /api/chess/ai-games` | `{}` | `201 {room}`（`mode: "ai"`） | `409 ALREADY_IN_ROOM` | `src/server/http/roomRoutes.ts` |
| `POST /api/rooms/:id/chess/move` | `{from, to}`，位置须匹配 `^[a-i][0-9]$` | `200 {room}` | `400`、`409 NOT_YOUR_TURN`、`409 ILLEGAL_MOVE`、`409 GAME_NOT_ACTIVE`、`403 NOT_IN_ROOM` | `src/server/http/chessRoutes.ts` |
| `POST /api/rooms/:id/chess/resign` | — | `200 {room}` | 同上通用错误 | `src/server/http/chessRoutes.ts` |
| `POST /api/rooms/:id/chess/draw-offer` | — | `200 {room}` | `409 DRAW_OFFER_PENDING` | `src/server/http/chessRoutes.ts` |
| `POST /api/rooms/:id/chess/draw-response` | `{accept: boolean}` | `200 {room}` | `400`、`409 NO_DRAW_OFFER` | `src/server/http/chessRoutes.ts` |
| `POST /api/rooms/:id/poker/start` | — | `200 {room}` | `403 NOT_HOST`、`409 HAND_IN_PROGRESS`、`409 NOT_ENOUGH_PLAYERS` | `src/server/http/pokerRoutes.ts` |
| `POST /api/rooms/:id/poker/bots` | `{}` | `201 {room}` | `403 NOT_HOST`、`409 HAND_IN_PROGRESS`、`409 ROOM_FULL`（已占座位数达到房间 `capacity`） | `src/server/http/pokerRoutes.ts`、`RoomManager.addPokerBot` |
| `POST /api/rooms/:id/poker/action` | `{type: fold\|check\|call\|bet\|raise, amount?}`；`bet`/`raise` 的 `amount` 为正整数，含义为下注/加注后的本轮总额 | `200 {room}` | `400`、`409 GAME_NOT_ACTIVE`、`409 NOT_YOUR_TURN`、`409 ILLEGAL_ACTION` | `src/server/http/pokerRoutes.ts`、`src/shared/poker/hand.ts` |

- 注册/登录的输入校验：`username`、`password` 须为字符串，去掉首尾空白后不能为空（分别提示“用户名为必填项”“密码为必填项”），长度不超过 200（分别提示“用户名不能超过 200 个字符”“密码不能超过 200 个字符”，先检查用户名）；原样保存；登录时用户不存在与密码错误同为 `INVALID_CREDENTIALS`（出处：`src/server/http/authRoutes.ts`）。
- 象棋、扑克的写操作成功后，向房间内除请求者外的成员推送各自视角的 `room:state`；加入、离开同样推送给其他成员（出处：`src/server/http/chessRoutes.ts`、`src/server/http/pokerRoutes.ts`、`src/server/http/roomRoutes.ts`）。

### 数据对象（`src/shared/protocol.ts`）

- `UserDto`：`{id, username, rating, chips, currentRoomId, activeRoomId}`；`activeRoomId` 为所在房间存在且未关闭时的房间 id，否则 `null`（出处：`src/shared/protocol.ts`、`src/server/http/authRoutes.ts` 的 `toUserDto`、`RoomManager.activeRoomId`）。
- `RoomListItem`：`{id, game, hostUsername, players, capacity, full, status: "waiting"|"playing"}`；扑克房间的 `players` 为已占座位数（含电脑玩家）（出处：`RoomManager.list`、`occupiedCount`）。
- `RoomSnapshot`：`{roomId, game, mode, version, hostUserId, members, capacity, status: "waiting"|"playing"|"closed", you: {userId}, chess?, poker?}`。
- `ChessView`：`{gameId, status, players: {red, black}, yourColor, turn, inCheck, legalMoves, board: [{pos, side, piece}], captured, lastMove, drawOffer: {by}|null, drawDeclined: {by}|null, result}`；`board` 只列出有棋子的位置并按位置排序，盖着的棋子 `piece` 恒为 `"hidden"`（对持有者也是）；人机对局 `players.black` 为 `{computer: true, username: "电脑"}`；`drawDeclined.by` 为被拒绝的提和方，下一步走棋或下一次提和时清除，对局结束时清除；`result` 为 `{outcome, reason, settled, ratingChanges: [{userId, delta, rating}]}`；`legalMoves` 只在对局 `active` 且轮到查看者时为 `{起点: 终点[]}`（只列有合法着法的己方棋子，由规则引擎 `legalMoves` 计算，盖棋按所在位置的开局棋子走法），其他情况为 `null`（出处：`src/shared/protocol.ts`、`src/server/rooms/view.ts`、`src/server/rooms/roomManager.ts`）。
- `PokerView`：`{handId, handNumber, stage, blinds: {small, big}, handCommitCap, board, pot, currentBet, toActSeat, seats, actions, showdown, winners, you: {seat, legal}}`；`seats[].chips` 为余额减去本手尚未结算的投入；`holeCards` 只对查看者本人的座位和摊牌亮牌的座位出现；`you.legal` 只在轮到查看者时非空，为 `{fold, check, call, callAmount, bet, raise, minRaiseTo, maxRaiseTo}`；`showdown[]` 为 `{seat, holeCards, handRank, handLabel, bestCards}`，`bestCards` 为由该座位底牌与公共牌经 `evaluateHand` 得出的最佳 5 张牌（出处：`src/server/rooms/view.ts`、`src/shared/protocol.ts`）。
- 牌面编码为两位字符串：点数 `23456789TJQKA` + 花色 `shdc`（出处：`src/shared/poker/cards.ts`）。象棋位置编码 `"{列}{行}"`，列 `a`–`i`、行 `0`–`9`，红方在 0–4 行，红帅 `e0`、黑将 `e9`（出处：`src/shared/xiangqi/index.ts`）。

### 实时推送（socket.io，路径 `/socket.io`）

- 握手：请求带 `Origin` 时其 host 必须等于 `X-Forwarded-Host`（取第一个）或 `Host`；Cookie `dg_session` 须对应有效会话；否则拒绝，错误消息 `unauthorized`（出处：`src/server/realtime/socket.ts`）。
- 连接后加入 `user:<userId>` 频道；若用户当前在房间中立即推送一次 `room:state`（出处：同上）。
- 服务端事件：`room:state`（`RoomSnapshot`，按接收者裁剪）；房间已不存在时向受影响用户发 `room:closed {roomId}`（出处：同上）。
- 服务端自行触发的变化（电脑走棋、电脑玩家行动、自动开始下一手、结算重试成功）推送给房间全部成员（出处：`src/server/http/app.ts` 的 `onRoomUpdate`/`onPokerUpdate`、`src/server/rooms/chessSettlement.ts`）。
- 前端按 `version` 丢弃比当前更旧的快照（出处：`src/web/pages/RoomPage.tsx`）。

## 业务规则与常量

### 常量（`src/shared/constants.ts`）

- 新用户初始积分 `INITIAL_RATING` 1000、初始筹码 `INITIAL_CHIPS` 1000（数据库默认值同为 1000，出处：`src/server/db/migrations/001_init.sql`）。
- 象棋房间容量 2；扑克房间容量 `POKER_CAPACITY` 9（也是建房时人数上限的最大值与缺省值，出处：`src/server/http/roomRoutes.ts`）；小盲 5、大盲 10；每手每人投入上限 `POKER_HAND_COMMIT_CAP` 1000。
- 会话 Cookie 名 `dg_session`；会话有效期 30 天；剩余不足 15 天续期。

### 账号

- 密码以 scrypt 散列保存（N=16384、r=8、p=1、64 字节、16 字节随机盐），格式 `scrypt$N$r$p$盐$散列`（base64），比对用 `timingSafeEqual`（出处：`src/server/auth/password.ts`）。
- 注册成功即创建会话（注册即登录）；用户名唯一冲突由数据库唯一约束（错误码 `23505`）识别为 `USERNAME_TAKEN`（出处：`src/server/http/authRoutes.ts`、`src/server/db/users.ts`）。

### 房间

- 同一用户同一时间只能在一个房间，否则 `ALREADY_IN_ROOM`；创建者为房主并进入房间（出处：`RoomManager.create`、`RoomManager.createAiGame`）。
- 加入：已是成员时直接返回；房间关闭或未列出（人机房间）为 `ROOM_NOT_FOUND`；人数满或象棋对局已不在等待中为 `ROOM_FULL`；象棋房间第二人加入即执黑开局，红方（房主）先走；扑克房间在下标小于 `capacity` 的空座位中分配，手牌进行中加入的标记 `waitingNextHand`，并优先选不在本手中的座位（出处：`RoomManager.join`、`pickFreeSeat`）。
- 隐式释放：用户所在房间已关闭（已结束的象棋对局）时，创建房间、创建人机对局、加入其他房间会先在全局锁内让其离开该房间（不再计分；房主转给剩余最早成员；房间无人即从内存删除；其余成员收到推送），再继续原操作；所在房间未关闭时仍为 `ALREADY_IN_ROOM`（出处：`RoomManager.releaseFinished`、`RoomManager.create`、`RoomManager.createAiGame`、`RoomManager.join`）。
- 离开：房主离开时由 `members` 中最早的其余成员接任；房间无人时关闭并从内存删除；进行中的象棋对局中离开视为认输；扑克手牌中离开视为弃牌（记 `leave_fold`），并按已投入额立即结算 `-committed`（出处：`RoomManager.leave`、`RoomManager.pokerLeave`）。
- 房间状态：已关闭为 `closed`；象棋按对局 `waiting` 与否为 `waiting`/`playing`；扑克有进行中的手牌为 `playing`，否则 `waiting`（出处：`roomStatus`）。

### 揭棋（`src/shared/xiangqi/index.ts`）

- 开局：每方 15 枚非将帅棋子只在本方开局位置之间用注入的 `Rng` 打乱（Fisher–Yates），全部盖着；将/帅在 `e0`/`e9` 并翻开（出处：`createBoard`、`src/shared/rng.ts`）。生产使用 `crypto.randomInt`（出处：`src/server/main.ts`、`src/shared/rng.ts`）。
- 盖着的棋子按其所在位置的开局棋子类型走（`openingType`）；盖着时士只能在本方九宫内斜走一步、象不能过河、兵只能向前一步；走后翻开，`lastMove.revealed` 记录实际身份（出处：`pseudoMoves`、`applyMove`）。
- 翻开后按实际身份走：士不受九宫限制、象不受河界限制（仍受象眼）；兵过河后可横走；将/帅限于九宫；马腿、炮架照常（出处：`pseudoMoves`）。
- 合法性：走后不能被将军、不能将帅照面（出处：`legalMoves`）。
- 终局：双方只剩将帅判和（`bare_kings`）；轮到走棋的一方无合法着法即判负，被将军时为 `checkmate`，否则为 `stalemate`（出处：`detectEnd`）。
- 被吃的棋子（含盖着的）以实际身份记入 `captured` 与 `lastMove.captured`（出处：`applyMove`、`RoomManager.chessMove`）。

### 象棋对局流程（`src/server/rooms/roomManager.ts`）

- 走棋须轮到自己，否则 `NOT_YOUR_TURN`；不合法为 `ILLEGAL_MOVE`；走棋使对方待回应的提和失效，并清除 `drawDeclined`（`chessMove`）。
- 提和：已有待回应的提和时 `DRAW_OFFER_PENDING`；人机对局中提和立即判和（`draw_agreed`）；回应只能由被提和方进行，否则 `NO_DRAW_OFFER`；拒绝时记录 `drawDeclined = {by: 提和方}` 并清除 `drawOffer`（`chessDrawOffer`、`chessDrawResponse`）。
- 对局结束（将死、困毙、认输、离开即认输、同意和棋、只剩将帅）时：状态置 `finished`、清除提和信息、房间 `closed = true`（从大厅移除，成员仍在房间内，可调用 leave 返回大厅），并在房间锁内结算（`finishChess`）。
- 积分结算：胜 +10、负 −10、和 0；联机双方都结算，人机对局只结算用户；写库失败时 `settled=false`，每 5 秒在房间锁内重试，成功后推送（出处：`src/server/rooms/chessSettlement.ts`）。
- 电脑对手：执黑；用户走棋后延迟 `AI_MOVE_DELAY_MS` 在房间锁内走棋；基于“遮盖了盖棋身份的公开局面”做 2 层极小极大搜索，盖棋价值按未出现身份的平均值估算，同分着法用 `Rng` 随机选择；只走引擎合法着法；从不主动提和（出处：`src/shared/ai/chessAi.ts`、`RoomManager.scheduleAiMove`）。

### 德州扑克（`src/shared/poker/`、`src/server/rooms/roomManager.ts`）

- 开始：仅房主；至少 2 个已占座位（含电脑玩家）；无进行中的手牌或待开始的下一手；首手庄家为房主座位，之后按座位顺时针轮转（`pokerStart`、`startPokerHand`）。
- 发牌与盲注：52 张牌用 `Rng` 洗牌；从小盲开始每人 2 张底牌；单挑时庄家下小盲，否则庄家下家为小盲、再下家为大盲；翻牌前从大盲下家开始行动（出处：`startHand`）。
- 下注轮：翻牌前、翻牌（3 张）、转牌（1 张）、河牌（1 张）；翻牌后从庄家下家第一位可行动者开始；除一人外全部弃牌时直接由剩下的人赢得底池（`stage: complete`，不摊牌）；河牌轮结束或可行动者不足 2 人时补齐公共牌并摊牌（出处：`advance`、`endRound`、`showdown`）。
- 行动规则：无下注时可过牌/下注，有下注时可跟注/加注/弃牌；最小下注为大盲，最小加注到 `currentBet + lastRaiseSize`；每手每人投入不超过 1000，跟注额与加注上限按剩余额度截断，达到上限的玩家不再行动；不足一次完整加注的加注不为已行动玩家重新开放加注；下注不检查筹码余额（出处：`legalActions`、`applyAction`）。
- 摊牌与分池：按投入分层计算主池与边池，弃牌者不参与分配；平分时零头给庄家之后顺时针第一位赢家（出处：`src/shared/poker/pots.ts`）。牌型 10 级（高牌至皇家同花顺），含 A-2-3-4-5 顺子（出处：`src/shared/poker/evaluator.ts`）。
- 结算：每手结束按净输赢（赢得额 − 投入额）在房间锁内写库，余额可为负数，没有下限；已在手中途离开而结算过的用户不重复结算；写库失败每 5 秒后台重试（不推送）（出处：`finishPokerHand`、`settlePoker`、`src/server/rooms/pokerSettlement.ts`）。
- 余额来源：入座、开始每手时从数据库读取真人用户的 `chips_balance`（出处：`refreshBalances`、`loadChipBalances`）。
- 下一手：每手结束后延迟 `POKER_NEXT_HAND_DELAY_MS` 自动开始，不足 2 个已占座位时停在 `idle`；自动开始失败时记录 `background_task_failed`，房主可手动开始（出处：`scheduleNextHand`）。
- 电脑玩家：仅房主在无进行中的手牌时添加，已占座位数达到房间 `capacity` 时为 `ROOM_FULL`，名称“电脑 N”，占座位计入人数，筹码 1000 只在房间内存中；轮到时延迟 `POKER_BOT_DELAY_MS` 行动；翻牌前按底牌强弱（对子或两张 T 以上为强、同花连张或带 A 为中）决定加注/跟注/过牌/弃牌，强牌只在当前下注不超过 4 个大盲时按最小加注加注；翻牌后成牌（非高牌）跟注或过牌，否则过牌或弃牌（出处：`addPokerBot`、`scheduleBot`、`src/shared/ai/pokerBot.ts`）。

## 前端（`src/web/`）

- 路由：`/register`、`/login`（`AuthPage`）、`/lobby`（`LobbyPage`）、`/room/:id`（`RoomPage`），其他路径重定向到 `/lobby`（出处：`src/web/main.tsx`）。
- REST 调用统一经 `api.ts` 的 `request`：同源 Cookie，非 GET 带 `Content-Type: application/json`；收到 `401 UNAUTHENTICATED` 时跳转 `/login`；`fetch` 抛错（网络不通）时转为 `code` 为 `NETWORK_ERROR`、`status` 为 0 的 `ApiRequestError`，提示“网络连接失败，请检查网络后重试”（出处：`src/web/api.ts`）。
- 登录、注册成功后进入 `/lobby`；登录/注册页显示品牌名“DeonGame”，出错时显示服务端返回的中文提示（出处：`src/web/pages/AuthPage.tsx`）。
- 大厅：顶栏（`TopBar`，名称“我的信息”）显示用户名、象棋积分、扑克筹码（负数带 `data-negative="true"`）与“退出登录”（调用 `POST /api/auth/logout` 后进入 `/login`）；每 2 秒轮询 `GET /api/rooms` 与 `GET /api/me`（页面隐藏时暂停，重新可见时立即轮询一次）；`activeRoomId` 非空时显示“回到对局”入口，游戏卡片与加入按钮置灰并说明“你有进行中的对局”；大厅不再因用户在房间中而自动跳转（出处：`src/web/pages/LobbyPage.tsx`、`src/web/hooks/usePolling.ts`、`src/web/components/TopBar.tsx`、`src/shared/ui/lobby.ts`）。
- 大厅游戏卡片“中国象棋·盲棋”“德州扑克”各带图标与一句介绍，点按打开预选该游戏的开房弹窗（`CreateRoomDialog`：游戏类型；象棋“联机对战”/“和电脑对战”；扑克“人数上限” 2–9，默认 9）（出处：`src/web/pages/LobbyPage.tsx`、`src/web/components/CreateRoomDialog.tsx`）。
- 房间列表列为房间名（前端拼为“{房主用户名}的房间”）、游戏类型、人数 `players/capacity`、状态（“等待中”/“对局中”）、加入按钮；不可加入时按钮禁用并显示原因：有进行中的对局为“你有进行中的对局”，`full` 为“已满员”，象棋房间对局中为“对局中”；扑克房间对局中有空座时可加入（出处：`src/shared/ui/lobby.ts` 的 `roomName`、`joinState`）。
- 房间页先 `GET /api/rooms/:id/state`，再建立 socket.io 连接接收 `room:state`；每次（重新）连接成功都重新读取房间状态；`GET` 返回 403/404 时带提示回到大厅；收到本房间的 `room:closed` 时回到大厅（出处：`src/web/pages/RoomPage.tsx`）。
- 房间页“回到大厅”只跳转 `/lobby`，不调用离开接口；“离开房间”先弹出确认（象棋“对局中离开将判负”、扑克“本手进行中离开将弃牌并让出座位”），确认后调用 `POST /api/rooms/:id/leave`（出处：`src/web/pages/RoomPage.tsx`）。
- 快照队列：只接受更高 `version` 的快照；象棋有新走棋且版本连续时播放动画，动画期间后续快照排队，排队超过 2 个或版本不连续时直接显示最新快照、不播动画；动画超时上限 `ANIM_WATCHDOG_MS`（出处：`src/web/hooks/useRoomFeed.ts`、`src/web/anim/durations.ts`）。
- 象棋棋盘：SVG 画 9 条竖线、10 条横线（河界处竖线断开）、双方九宫斜线、兵卒与炮位的角标，河界文字“楚河”“汉界”；棋子位于 9×10 网格的单元中心，即交叉点（视图坐标 90×100）；执黑方视角棋盘旋转 180°；棋子为圆形木质样式，翻开的红子红字、黑子黑字，暗子不显示字，红方背面与黑方背面使用不同底色（红色系、蓝灰色系）（出处：`src/web/components/ChessBoard.tsx`、`src/web/components/ChessPiece.tsx`、`src/shared/ui/board.ts`、`src/web/styles/chess.css`）。
- 象棋交互：可走位置只取自服务端 `chess.legalMoves`；格子按 `data-marks` 标记 `target`（可走点）、`last-from`、`last-to`（上一步起止点）；不是自己回合点棋子提示“还没轮到你”、选中前点对方棋子提示“这是对方的棋子”、点不可走位置提示“这里不能走”；提示由 `Toast`（名称“操作提示”）显示 2.5 秒；走棋被拒时提示原因并重新读取房间状态（出处：`src/web/components/ChessBoard.tsx`、`src/web/components/Toast.tsx`、`src/web/pages/RoomPage.tsx`）。
- 象棋动画：移动 300ms、翻面 320ms、吃子 260ms（出处：`src/web/anim/durations.ts`）。结果对话框“对局结果”显示胜/负/和、原因、积分变化（`+10` 形式）与最新积分（未结算时“积分结算中”），对局方有“再来一局”（人机对局调用 `POST /api/chess/ai-games`，联机调用 `POST /api/rooms` 建新象棋房间）与“回到大厅”（调用 leave 后回到大厅）（出处：`src/web/pages/RoomPage.tsx` 的 `ChessResult`、`playAgain`）。
- 扑克牌桌：椭圆牌桌，宽度小于 600px 时为竖向（3:4），否则横向（2:1）；座位按 `seatLayout` 均匀排在椭圆边上，查看者固定在下方；座位显示庄家、小盲、大盲标记与筹码（负数 `data-negative="true"`），行动中的座位 `data-acting="true"`；牌由 `PlayingCard` 以花色图案与点数绘制，他人底牌为“牌背”，赢家最佳 5 张（`bestCards`）`data-highlight="true"`；“本手结果”区显示赢家与赢得额（出处：`src/web/components/PokerTable.tsx`、`src/web/components/PlayingCard.tsx`、`src/web/components/SuitIcon.tsx`、`src/shared/ui/seatLayout.ts`）。
- 扑克动画：发牌每张 120ms、筹码推入底池 380ms、翻开公共牌 260ms，经 Web Animations API 执行，阶段暴露为牌桌 `data-anim`（`idle`/`dealing`/`collecting`/`revealing`）（出处：`src/web/anim/pokerAnim.ts`、`src/web/anim/durations.ts`）。
- 扑克操作区（名称“操作区”，轮到自己时 `data-active="true"`）：弃牌、过牌、跟注（显示跟注额）、加注；加注有滑块（名称“加注金额”）、输入框（名称“金额”）与快捷金额“半个底池”“一个底池”“最大”；快捷金额 = 本轮已下注 + 跟注额 + round(比例 ×（底池 + 跟注额）)，截断到 `[minRaiseTo, maxRaiseTo]`，“最大”为 `maxRaiseTo`；超出范围时提示“加注金额须在 {min}～{max} 之间”（出处：`src/web/components/PokerActionBar.tsx`、`src/shared/ui/raise.ts`）。
- 音效：Web Audio 合成，不使用音频文件；首次 `pointerdown`/`touchend`/`keydown` 时解锁音频；事件由相邻两次快照推导：象棋走子、翻子、吃子、将军、结束，扑克发牌、下注、弃牌、赢得底池（翻公共牌与收池只有动画无声音）；每次请求播放都派发 `deongame:sound` 事件（`detail: {name, played}`）（出处：`src/web/audio/sound.ts`、`src/shared/ui/events.ts`、`src/web/pages/RoomPage.tsx`）。
- 静音：房间页“静音”按钮（`aria-pressed`）切换，状态只保存在页面内存中，刷新后恢复为有声；在 `(pointer: coarse) and (hover: none)` 的设备上且未静音时固定显示“听不到声音？请关闭手机静音模式”（出处：`src/web/components/SoundControls.tsx`、`src/web/audio/sound.ts`）。
- 连接状态提示（`role="status"`，名称“连接状态”）：加载中“加载中…”、断线“连接已断开，正在重连…”，正常时为空（出处：`src/web/components/ConnectionStatus.tsx`、`src/web/pages/LobbyPage.tsx`、`src/web/pages/RoomPage.tsx`）。
- 象棋状态区（`role="status"`，名称“对局状态”）显示执子方、轮次、将军、提和、“等待对手加入”；`drawDeclined.by` 等于自己执子方时显示“对方拒绝了提和”，该信息来自服务端状态（出处：`src/web/pages/RoomPage.tsx` 的 `ChessStatus`）。
- 主要控件的无障碍名称：棋盘 `role="group"`“棋盘”，格子名称为 `"{位置} {内容}"`（如“红暗子”“黑将”“空”）；“对局结果”对话框；“房间成员”“被吃的棋子”“我的信息”“房间列表”；扑克“牌桌”“底池”“公共牌”“座位 N：名称”“庄家”“小盲”“大盲”“操作区”“金额”输入框、“本手结果”、“牌局记录”（`role="log"`），牌为 `role="img"`（出处：`src/web/components/*.tsx`、`src/web/pages/*.tsx`）。
- 样式：`tokens.css` 定义统一的配色、字体（正文 `PingFang SC`/`Microsoft YaHei`/`Noto Sans SC`，棋子楷体）、圆角、阴影与点按尺寸 `--tap: 44px`；断点 `@media (max-width: 480px)`（大厅）、`@media (max-width: 599px)`（牌桌）；`index.html` 设置 `viewport`（出处：`src/web/styles/*.css`、`src/web/index.html`）。

## 日志与可观测性

- 日志为 pino JSON 行，写到标准输出，字段 `level`（文字）、`time`（ISO）、`event`、`msg` 等（出处：`src/server/logger.ts`）。
- 日志事件：`server_started`、`server_stopping`、`config_invalid`、`startup_failed`、`db_connect_retry`、`db_pool_error`、`user_registered`、`user_logged_in`、`user_logged_out`、`login_failed`、`room_created`（含 `capacity` 字段）、`room_joined`、`room_left`、`ai_game_created`、`chess_move`、`chess_resign`、`chess_draw_offer`、`chess_draw_response`、`chess_finished`、`poker_hand_started`、`poker_bot_added`、`poker_action`、`poker_hand_settled`、`settlement_failed`、`settlement_retried_ok`、`background_task_failed`、`request_rejected`（4xx，info 级）、`request_failed`（5xx 的 `AppError`）、`unhandled_error`（出处：`src/server/**/*.ts`）。日志字段为用户 id、房间 id、对局/手牌 id、错误码与错误消息，不记录密码与会话令牌（出处：同上）。
- 部署声明的错误日志规则：`level` 为 `error`/`fatal` 为高严重度；`^FATAL ERROR:` 文本为高严重度；5 分钟内 20 条以上 `warn` 为中严重度（出处：`docs/deployment.json` 的 `operations.errorLogRules`）。

## 部署

- 镜像两阶段构建：构建阶段 `npm ci`、`npm run build`、`npm prune --omit=dev`；运行阶段只复制 `package.json`、`node_modules`、`dist`，`NODE_ENV=production`、`PORT=8080`，以 `1000:1000` 运行，`CMD ["node", "dist/server/main.js"]`（出处：`Dockerfile`）。
- `.dockerignore` 排除 `node_modules`、`dist`、`test-results`、`playwright-report`、`.git`、`.ai-delivery`、`e2e`、`tests`（出处：`.dockerignore`）。
- 数据库迁移随服务启动自动执行，无单独迁移步骤（出处：`src/server/http/app.ts`）。
- 对局状态在单个进程内存中（出处：`docs/deployment.json` 的服务描述、`src/server/rooms/roomManager.ts`）。

## 测试

- 单元测试 `tests/unit/`：`xiangqi`、`poker`、`ai`、`roomManager`、`chessRoom`、`aiRoom`、`pokerRoom`、`config`、`password`、`boardGeometry`、`legalMovesView`、`lobbyUi`、`raise`、`seatLayout`、`uiEvents`（出处：`tests/unit/`）。
- 集成测试 `tests/integration/`：`auth`、`unauthenticated`、`rooms`、`chess`、`ai`、`poker`；每个 Vitest worker 用 schema `it_<运行编号>_<worker>` 在进程内启动服务（`127.0.0.1:0`，`seededRng(42)`，三个延迟均为 0，`COOKIE_SECURE=false`），结束时 `DROP SCHEMA … CASCADE`；数据库连接取自 `AIDH_DEP_POSTGRES_*` 环境变量（出处：`tests/support/server.ts`）。
- 端到端 `e2e/`：`auth`、`rooms`、`chess`、`ai`、`poker`、`lobby`、`board`、`table`、`mobile`，辅助 `e2e/support/`（`users.ts`、`lobby.ts`、`poker.ts`）；`webServer` 先 `npm run build` 再以 `PORT=${E2E_PORT:-4173}`、`DB_SCHEMA=e2e_<运行编号>`、`COOKIE_SECURE=false`、延迟 50/50/500 毫秒启动；用户通过 `POST /api/auth/register` 造数，用户名前缀 `qa_<运行编号>_`（出处：`playwright.config.ts`、`e2e/support/users.ts`）。

## 约定

- 服务端代码以 `.js` 后缀导入（NodeNext 解析），前后端共用 `src/shared/`（出处：`tsconfig.server.json`、`src/server/**/*.ts`）。
- 业务错误统一抛 `AppError(错误码)`，由 Express 错误处理中间件转为 JSON 错误响应（出处：`src/server/errors.ts`、`src/server/http/app.ts`）。
- 房间状态只经 `viewFor` 按查看者裁剪后输出（REST 与推送共用）（出处：`src/server/rooms/view.ts`）。
- 所有改变房间的操作在房间锁内执行，并使 `version` 加 1；服务端自发任务（电脑走棋、电脑玩家行动、下一手）用 `setTimeout(...).unref()` 延迟后在房间锁内执行，失败交给 `onBackgroundError`（出处：`src/server/rooms/roomManager.ts`）。
- 随机性通过 `Rng` 注入，生产用 `cryptoRng`，测试用 `seededRng`（出处：`src/shared/rng.ts`、`src/server/main.ts`、`tests/support/server.ts`）。
- 结算幂等依赖数据库主键（`chess_results.game_id`、`poker_settlements(hand_id, user_id)`）（出处：`src/server/db/chessResults.ts`、`src/server/db/pokerSettlements.ts`）。
- ESLint 规则：`@typescript-eslint/no-unused-vars` 为 error，以 `_` 开头的参数除外；全局变量同时启用 node 与 browser（出处：`eslint.config.js`）。
- 接口说明 `docs/api.md` 的错误码表未列出 `NOT_HOST`、`ILLEGAL_ACTION`、`HAND_IN_PROGRESS`、`NOT_ENOUGH_PLAYERS`，象棋快照说明未列出 `drawDeclined` 字段；这些在代码中已存在（出处：`docs/api.md`、`src/shared/protocol.ts`）。
