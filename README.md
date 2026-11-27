# deongame
AIDelivery Hub project: 

网页游戏大厅：注册登录、开房/加入房间，揭棋与德州扑克（分批交付中）。接口说明见 [docs/api.md](docs/api.md)。

## 运行

需要 Node.js 22+ 与 PostgreSQL。连接信息只从环境变量读取：`AIDH_DEP_POSTGRES_ADDRESS`（host:port）、`AIDH_DEP_POSTGRES_DATABASE`、`AIDH_DEP_POSTGRES_USER`、`AIDH_DEP_POSTGRES_PASSWORD`、`AIDH_DEP_POSTGRES_SSLMODE`（disable/require/verify-full）、`AIDH_DEP_POSTGRES_AUTH_MODE`（仅支持 credential）。

```bash
npm ci
npm run build
npm start            # node dist/server/main.js，启动时自动执行数据库迁移
```

可选环境变量：`PORT`（默认 8080）、`DB_SCHEMA`（默认 public）、`COOKIE_SECURE`（生产默认 true）、`LOG_LEVEL`、`AI_MOVE_DELAY_MS`、`POKER_BOT_DELAY_MS`、`POKER_NEXT_HAND_DELAY_MS`。

开发：`npm run dev`（Vite 前端，代理到 8080 的服务端）。

## 检查与测试

```bash
npm run lint && npm run typecheck
npm run test:unit          # tests/unit，无外部依赖
npm run test:integration   # tests/integration，需要数据库；每个 worker 使用独立 schema 并在结束时删除
npx playwright test        # e2e/，先构建再以独立 DB_SCHEMA 启动服务
npx playwright test e2e/rooms.spec.ts -g "<用例标题>" --project=mobile   # 单个用例
```
