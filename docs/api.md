# DeonGame 接口说明

本文件随功能分批补充。当前包含：账号、房间、实时推送（基础）、健康检查。

## 通用约定

- 所有接口以 JSON 收发。写请求（POST）必须带 `Content-Type: application/json`，否则返回 `415 UNSUPPORTED_MEDIA_TYPE`；请求体上限 16KB。
- 登录态保存在 Cookie `dg_session`（HttpOnly、SameSite=Lax、Path=/，生产环境 Secure），有效期 30 天，剩余不足 15 天时自动续期。
- 除注册、登录、健康检查外，所有接口要求登录；未登录返回 `401 UNAUTHENTICATED`。
- 错误统一格式：`{"error":{"code":"<错误码>","message":"<中文提示>"}}`。

| HTTP | code | message |
|---|---|---|
| 400 | VALIDATION_FAILED | 用户名为必填项 / 密码为必填项 / 请求参数不合法 |
| 401 | UNAUTHENTICATED | 请先登录 |
| 401 | INVALID_CREDENTIALS | 用户名或密码错误 |
| 403 | NOT_IN_ROOM | 你不在这个房间中 |
| 404 | ROOM_NOT_FOUND | 房间不存在或已关闭 |
| 409 | USERNAME_TAKEN | 用户名已被占用 |
| 409 | ROOM_FULL | 房间已满 |
| 409 | ALREADY_IN_ROOM | 你已在其他房间中，请先离开当前房间 |
| 409 | NOT_YOUR_TURN | 还没轮到你 |
| 409 | ILLEGAL_MOVE | 走法不合规 |
| 409 | GAME_NOT_ACTIVE | 对局未在进行中 |
| 409 | DRAW_OFFER_PENDING | 已有待回应的提和 |
| 409 | NO_DRAW_OFFER | 没有待回应的提和 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 请求格式不支持 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

## 账号

`User` 对象：`{ id, username, rating, chips, currentRoomId, activeRoomId }`，`currentRoomId` 为当前所在房间 id 或 `null`；`activeRoomId` 为“有进行中的对局”的房间 id 或 `null`（所在房间存在且未关闭时等于 `currentRoomId`，否则为 `null`），大厅据此显示“回到对局”。

### POST /api/auth/register

请求 `{ "username": "alice", "password": "..." }`。用户名、密码去掉首尾空白后不能为空（原样保存）；用户名区分大小写且唯一。

- `201 { user }`，并设置会话 Cookie（注册即登录）。新用户积分 1000、筹码 1000。
- `400 VALIDATION_FAILED`（消息逐项说明：`用户名为必填项`、`密码为必填项`、`用户名不能超过 200 个字符`、`密码不能超过 200 个字符`，先检查用户名）、`409 USERNAME_TAKEN`。

### POST /api/auth/login

请求同上。

- `200 { user }`，并设置会话 Cookie。
- `401 INVALID_CREDENTIALS`（用户不存在与密码错误同一提示）、`400 VALIDATION_FAILED`。

### POST /api/auth/logout

吊销当前会话并清除会话 Cookie；之后用旧 Cookie 访问受保护接口得到 `401`。没有会话时同样成功（幂等）。

- `204`（无响应体）。

### GET /api/me

- `200 { user }`。

## 房间

`RoomListItem`：`{ id, game: "chess"|"poker", hostUsername, players, capacity, full, status: "waiting"|"playing" }`。

`RoomSnapshot`（按查看者裁剪）：`{ roomId, game, mode, version, hostUserId, members:[{userId,username}], capacity, status: "waiting"|"playing"|"closed", you:{userId}, chess?, poker? }`。

- `chess`：`{ gameId, status: "waiting"|"active"|"finished", players:{red,black}, yourColor, turn, inCheck, board, captured, lastMove, drawOffer, result }`。
  - `board`：只列出有棋子的位置 `[{pos, side, piece}]`，`pos` 为 `"{列}{行}"`（列 a–i，行 0–9，红方在 0–4 行）；盖着的棋子 `piece` 恒为 `"hidden"`，对任何人（包括持有者）都不暴露身份。
  - `captured`：`[{side, piece}]`，被吃的盖棋也显示实际身份。`lastMove`：`{from, to, side, revealed?, captured?}` 或 `null`。
  - `drawOffer`：`{by}` 或 `null`。`result`：`{outcome: "red_win"|"black_win"|"draw", reason: "checkmate"|"stalemate"|"resign"|"draw_agreed"|"bare_kings", settled, ratingChanges:[{userId, delta, rating}]}` 或 `null`（`settled=false` 表示结算写库失败、后台每 5 秒重试）。
- `poker`：`{ handId, handNumber, stage: "idle"|"preflop"|"flop"|"turn"|"river"|"showdown"|"complete", blinds:{small:5,big:10}, handCommitCap:1000, board, pot, currentBet, toActSeat, seats, actions, showdown, winners, you:{seat, legal} }`。
  - 牌面为两位字符串：点数 `23456789TJQKA` + 花色 `s h d c`（如 `"Ah"`、`"Td"`）。
  - `seats[]`：`{seat, kind, userId?, name, chips, committedThisHand, committedThisRound, inHand, folded, atCap, waitingNextHand, isDealer, isSmallBlind, isBigBlind, holeCards?}`；`chips` 为扣除本手投入后的余额（可为负数）。`holeCards` 只对查看者本人的座位、以及摊牌时亮牌的座位出现，其他人的底牌不会出现在任何响应或推送中。
  - `actions[]`：`{seat, name, type: "small_blind"|"big_blind"|"fold"|"check"|"call"|"bet"|"raise"|"leave_fold", amount, to?}`；`to` 为下注/加注后的本轮总额。
  - `showdown[]`：`{seat, holeCards, handRank, handLabel}`；`winners[]`：`{seat, name, amount}`（`amount` 为分得的底池）。
  - `you.legal`：只在轮到查看者时非空，`{fold, check, call, callAmount, bet, raise, minRaiseTo, maxRaiseTo}`。

### GET /api/rooms

列出大厅中未关闭的房间，最新创建的在前：`200 { rooms: RoomListItem[] }`。

### POST /api/rooms

请求 `{ "game": "chess" | "poker", "capacity"?: number }`。象棋房间 2 人（忽略 `capacity`）；德州扑克房间人数上限 `capacity` 为 2～9 的整数，缺省 9，只开放前 `capacity` 个座位（电脑玩家计入人数，满员后加入与添加电脑都返回 `409 ROOM_FULL`）。创建者成为房主并进入房间。

- `201 { room: RoomSnapshot }`。
- `400 VALIDATION_FAILED`（`capacity` 不是 2～9 的整数时消息为 `人数上限必须是 2～9 的整数`）、`409 ALREADY_IN_ROOM`（同一时间只能在一个房间）。

### POST /api/rooms/:id/join

- `200 { room }`；已是成员时幂等返回。象棋房间第二人加入即开局（房主执红先走）。
- `404 ROOM_NOT_FOUND`、`409 ROOM_FULL`、`409 ALREADY_IN_ROOM`。

### POST /api/rooms/:id/leave

- `200 {}`。房主离开时由最早加入的其余成员接任；房间无人即关闭。离开进行中的象棋对局时对局结束、房间从大厅移除，剩余玩家需“返回大厅”。
- `403 NOT_IN_ROOM`、`404 ROOM_NOT_FOUND`。

### 象棋对局（揭棋）

以下接口仅对局双方可用，成功均返回 `200 { room }`（请求者视角），并向对手推送 `room:state`。通用错误：`403 NOT_IN_ROOM`、`404 ROOM_NOT_FOUND`、`409 GAME_NOT_ACTIVE`。被拒绝的操作不改变对局状态。

- `POST /api/rooms/:id/chess/move`，请求 `{ "from": "a3", "to": "a4" }`：`400 VALIDATION_FAILED`、`409 NOT_YOUR_TURN`、`409 ILLEGAL_MOVE`（含走对方棋子、从空位走）。盖棋按所在开局位置的棋子走法走，走后翻开；对手走棋使其待回应的提和失效。
- `POST /api/rooms/:id/chess/resign`：认输，对方胜。
- `POST /api/rooms/:id/chess/draw-offer`：提和；同时只能有一个待回应的提和（`409 DRAW_OFFER_PENDING`）。
- `POST /api/rooms/:id/chess/draw-response`，请求 `{ "accept": true|false }`：只有被提和的一方可回应（`409 NO_DRAW_OFFER`）；同意即和棋。

对局结束（将死或困毙判负、认输、离开即认输、同意和棋、双方只剩将帅自动和棋）时在房间锁内写库结算：胜 +10、负 −10、和 0，每局只结算一次。结束后房间从大厅移除，成员仍留在房间内直至“返回大厅”（调用 leave）；离开已结束的对局不再计分。

### POST /api/chess/ai-games

- 请求 `{}`，`201 { room }`：创建与电脑的揭棋对局（`mode: "ai"`），创建即开局，用户执红先走；`players.black` 为 `{ "computer": true, "username": "电脑" }`。
- 该对局不出现在大厅列表中，其他用户加入返回 `404 ROOM_NOT_FOUND`；已在其他房间时 `409 ALREADY_IN_ROOM`；未登录 `401`。
- 用户走棋后电脑约 `AI_MOVE_DELAY_MS`（默认 600ms）后自动走棋（只基于公开局面，按同一引擎合规着法），走后推送 `room:state`。电脑收到提和立即同意（和棋），从不主动提和。结算只改变用户积分。

### 德州扑克

以下接口成功均返回 `200 { room }`（请求者视角），并向房间其他成员推送各自视角的 `room:state`。通用错误：`403 NOT_IN_ROOM`、`404 ROOM_NOT_FOUND`。被拒绝的操作不改变牌局状态。

- `POST /api/rooms/:id/poker/start`：仅房主；至少 2 名玩家入座（`409 NOT_ENOUGH_PLAYERS`）、当前无进行中的牌局（`409 HAND_IN_PROGRESS`），非房主 `403 NOT_HOST`。庄家位从房主开始，每手顺时针轮转；单挑时庄家下小盲、翻牌前先行动。
- `POST /api/rooms/:id/poker/bots`，请求 `{}`，`201 { room }`：仅房主（`403 NOT_HOST`）在无进行中的手牌时（`409 HAND_IN_PROGRESS`）添加电脑玩家“电脑 1”“电脑 2”…，占一个座位并计入人数（达到房间人数上限时 `409 ROOM_FULL`）。电脑玩家筹码 1000、只在本房间内存中，不影响任何用户的积分或余额；轮到它时约 `POKER_BOT_DELAY_MS`（默认 800ms）后自动按合规行动入口行动。房间无真人时随房间移除。
- `POST /api/rooms/:id/poker/action`，请求 `{ "type": "fold"|"check"|"call"|"bet"|"raise", "amount"?: n }`：`amount` 为下注/加注后的本轮总额（“下注到”），`bet`/`raise` 必填正整数。`400 VALIDATION_FAILED`、`409 GAME_NOT_ACTIVE`（无进行中的牌局）、`409 NOT_YOUR_TURN`、`409 ILLEGAL_ACTION`（如有下注时过牌、无下注时跟注、加注额不足或超过每手 1000 上限）。

每手结束（只剩一人或摊牌）时按净输赢写库结算筹码（每手只结算一次，余额可为负数；写库失败时后台每 5 秒重试），随后约 4 秒（`POKER_NEXT_HAND_DELAY_MS`）自动开始下一手（不足 2 人时停在 `idle`）。牌局中加入的玩家标记 `waitingNextHand`，下一手入局；牌局中离开视为弃牌，按已投入额结算。

### GET /api/rooms/:id/state

仅房间成员可读：`200 { room }`；`403 NOT_IN_ROOM`、`404 ROOM_NOT_FOUND`。

## 实时推送（socket.io，路径 `/socket.io`）

- 握手时校验 `dg_session` Cookie；未登录或会话无效时拒绝连接（`connect_error`，消息 `unauthorized`）。带 `Origin` 头时须与访问的主机一致。
- 服务端 → 客户端：
  - `room:state`：`RoomSnapshot`。连接建立时若用户在房间中立即推送一次；房间成员变化、对局状态变化（走棋、提和、结束）时推送给其他成员。
  - `room:closed`：`{ roomId }`，房间已关闭。

## 健康检查

`GET /healthz`：数据库可用时 `200 {"status":"ok"}`，否则 `503 {"status":"db-unavailable"}`。
