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
| 415 | UNSUPPORTED_MEDIA_TYPE | 请求格式不支持 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

## 账号

`User` 对象：`{ id, username, rating, chips, currentRoomId }`，`currentRoomId` 为当前所在房间 id 或 `null`。

### POST /api/auth/register

请求 `{ "username": "alice", "password": "..." }`。用户名、密码去掉首尾空白后不能为空（原样保存）；用户名区分大小写且唯一。

- `201 { user }`，并设置会话 Cookie（注册即登录）。新用户积分 1000、筹码 1000。
- `400 VALIDATION_FAILED`、`409 USERNAME_TAKEN`。

### POST /api/auth/login

请求同上。

- `200 { user }`，并设置会话 Cookie。
- `401 INVALID_CREDENTIALS`（用户不存在与密码错误同一提示）、`400 VALIDATION_FAILED`。

### GET /api/me

- `200 { user }`。

## 房间

`RoomListItem`：`{ id, game: "chess"|"poker", hostUsername, players, capacity, full, status: "waiting"|"playing" }`。

`RoomSnapshot`（按查看者裁剪）：`{ roomId, game, mode, version, hostUserId, members:[{userId,username}], capacity, status: "waiting"|"playing"|"closed", you:{userId}, chess?, poker? }`。

- `chess`：`{ gameId, status: "waiting"|"active"|"finished", players:{red,black}, yourColor, turn }`（棋盘在后续批次加入）。
- `poker`：`{ handId, handNumber, stage, seats:[{seat,kind,userId?,name}] }`（牌局在后续批次加入）。

### GET /api/rooms

列出大厅中未关闭的房间，最新创建的在前：`200 { rooms: RoomListItem[] }`。

### POST /api/rooms

请求 `{ "game": "chess" | "poker" }`。象棋房间 2 人，德州扑克房间 9 座。创建者成为房主并进入房间。

- `201 { room: RoomSnapshot }`。
- `400 VALIDATION_FAILED`、`409 ALREADY_IN_ROOM`（同一时间只能在一个房间）。

### POST /api/rooms/:id/join

- `200 { room }`；已是成员时幂等返回。象棋房间第二人加入即开局（房主执红先走）。
- `404 ROOM_NOT_FOUND`、`409 ROOM_FULL`、`409 ALREADY_IN_ROOM`。

### POST /api/rooms/:id/leave

- `200 {}`。房主离开时由最早加入的其余成员接任；房间无人即关闭。离开进行中的象棋对局时对局结束、房间从大厅移除，剩余玩家需“返回大厅”。
- `403 NOT_IN_ROOM`、`404 ROOM_NOT_FOUND`。

### GET /api/rooms/:id/state

仅房间成员可读：`200 { room }`；`403 NOT_IN_ROOM`、`404 ROOM_NOT_FOUND`。

## 实时推送（socket.io，路径 `/socket.io`）

- 握手时校验 `dg_session` Cookie；未登录或会话无效时拒绝连接（`connect_error`，消息 `unauthorized`）。带 `Origin` 头时须与访问的主机一致。
- 服务端 → 客户端：
  - `room:state`：`RoomSnapshot`。连接建立时若用户在房间中立即推送一次；房间成员变化时推送给其他成员。
  - `room:closed`：`{ roomId }`，房间已关闭。

## 健康检查

`GET /healthz`：数据库可用时 `200 {"status":"ok"}`，否则 `503 {"status":"db-unavailable"}`。
