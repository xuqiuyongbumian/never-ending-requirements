# Game API 与决策分析台

这是一个独立的 Node.js + Hono + SQLite 服务，用于接收游戏的匿名行为事件与单局结算，并提供排行榜、成就判定和后台决策分析台。运行时不依赖 Cloudflare Worker、D1 或外部数据库。

## 环境要求

- Node.js 22.13 或更新版本（使用内置 `node:sqlite`）。
- 根目录与 `server/` 的依赖均已安装。

```sh
npm ci
npm install --prefix server
```

## 本地启动

```sh
npm run db:migrate
npm run dev:server
```

默认监听 `http://127.0.0.1:8787`。可用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 绑定地址 |
| `DATABASE_PATH` | `./data/game.sqlite` | SQLite 文件路径；相对路径按 `server/` 工作目录解析 |
| `ADMIN_TOKEN` | 空 | 设置后 `/api/admin/*` 需要 `Authorization: Bearer <token>`；空值表示本地开放模式 |
| `GAME_VERSION` | `0.1.0` | 后台展示的版本号 |
| `GAME_URL` | 空 | 后台右上角「打开游戏」链接；为空时隐藏 |

生产构建未配置 `VITE_API_BASE_URL` 时，客户端会默认使用同源 `window.location.origin` 上报，适合由网关把 `/api/*` 反代到本服务的部署方式；本地开发构建仍保持静默。浏览器端在根目录 `.env.local` 配置：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_GAME_VERSION=0.1.0
```

不要把 `ADMIN_TOKEN` 写入任何 `VITE_` 变量，它们会被打包进浏览器。

## 决策分析台

启动 API 后访问：

```text
http://127.0.0.1:8787/admin
```

面板包含五个视图：

- **总览**：玩家数、对局数、胜率、平均分、事件量、时代分布、近 7 日趋势、决策风格与热门成就。
- **用户档案**：按昵称或 sessionId 搜索匿名玩家；点击进入单用户档案，查看每局得分、事件时间线、招募/升级/调度/冲刺/需求变更决策、未结算对局、成就墙与完整事件流。
- **决策分析**：全量或单用户的需求变更选择分布、招聘偏好、冲刺/调度节奏、需求验收/漏单、技术债原因和界面操作计数。
- **排行榜**：按最佳得分、胜场、验收需求排序，可从行进入玩家档案。
- **成就系统**：20 项成就的解锁对局数、解锁玩家数、解锁率与最近解锁记录。

如果设置了 `ADMIN_TOKEN`，面板会先要求输入令牌，并把令牌保存在当前标签页的 `sessionStorage`；后台资源本身公开，但所有 `/api/admin/*` 数据接口都受保护。

### 演示数据

```sh
npm run seed:demo
# 覆盖已有演示数据
npm --prefix server run seed:demo -- --force
```

脚本会写入 12 个匿名会话、14 局结算和约 600 条事件，覆盖高质量上线、冲刺型上线、残血翻盘、中途离开等路径，便于直接查看各视图。演示数据只使用 `demo-session-*` / `demo-run-*` / `demo_*` 前缀，`--force` 只会删除这些前缀的记录。

## 数据库与迁移

迁移文件位于 `server/migrations/`，执行记录写入 `schema_migrations`。启动时会自动应用未执行的迁移，也可以手动运行：

```sh
npm run db:migrate
```

当前迁移：

- `0001_initial.sql`：`game_events`、`game_runs` 及时间、事件类型、run、结果、分数索引。
- `0002_analytics_fields.sql`：结算昵称 `nickname` 与 `(session_id, ended_at)` 索引。

成就没有单独的解锁表。服务端根据已保存的 `game_runs` 与 `game_events` 确定性推导成就，因此历史数据无需回填，修改成就规则会对所有历史对局重新生效。

## API

所有响应均为 JSON。错误格式：

```json
{ "error": { "code": "invalid_event", "message": "..." } }
```

### `GET /api/health`

```json
{ "ok": true }
```

### `POST /api/events`

接收单条事件、事件数组，或 `{ "events": [...] }`。数组最多 25 条，请求体最大 64 KiB。事件时间戳必须是带毫秒的 ISO 8601 UTC 字符串。

```json
{
  "events": [
    {
      "eventId": "8ca77e86-95b4-43a1-a7d1-0e9a6c0833e2",
      "sessionId": "b8d0a194-b4d5-49c1-9990-130fa0eef889",
      "runId": "a203c1db-e561-4fb5-aa0a-2ed33e9876da",
      "type": "event_choice",
      "timestamp": "2026-10-22T10:00:00.000Z",
      "elapsed": 38.2,
      "properties": { "event": "scope-creep", "choice": "freeze-scope", "techDebt": 24 }
    }
  ]
}
```

支持的事件类型：

`enter`、`game_start`、`recruit`、`era_upgrade`、`event_choice`、`requirement_prioritized`、`rush_activated`、`request_complete`、`request_missed`、`debt_change`、`online_incident`、`win`、`loss`、`replay`、`change_event`、`rush_completed`、`load_error`、`ui_action`、`run_abandoned`。

`eventId` 可省略；省略时服务端从事件内容生成稳定的 SHA-256 ID。新客户端会发送 UUID。相同 ID 的完全重试返回 202 并计入 `duplicates`；相同 ID 但内容不同返回 409。

成功响应：

```json
{ "ok": true, "received": 1, "inserted": 1, "duplicates": 0 }
```

### `POST /api/runs`

保存一局结算。`score` 由服务端计算，客户端传入会被拒绝。`nickname` 可选，最长 24 字符；服务端会折叠空白，只随结算保存，不出现在事件里。

```json
{
  "runId": "a203c1db-e561-4fb5-aa0a-2ed33e9876da",
  "sessionId": "b8d0a194-b4d5-49c1-9990-130fa0eef889",
  "startedAt": "2026-10-22T10:00:00.000Z",
  "endedAt": "2026-10-22T10:05:00.000Z",
  "result": "win",
  "completedRequests": 12,
  "recruitCount": 4,
  "missedRequests": 1,
  "finalEra": 2,
  "finalTechDebt": 35,
  "finalProjectHealth": 87,
  "gameVersion": "0.1.0",
  "nickname": "上线守门人"
}
```

`runId` 幂等：完全相同的重试返回 200 和原分数；内容变化返回 409。响应额外包含服务端成就判定与排名：

```json
{
  "ok": true,
  "duplicate": false,
  "run": { "runId": "...", "score": 2100, "nickname": "上线守门人" },
  "achievements": [{ "id": "first-launch", "unlocked": true, "progress": 1, "detail": "成功上线" }],
  "achievementPoints": 70,
  "unlockedAchievements": 4,
  "rank": { "rank": 3, "total": 12 }
}
```

### `GET /api/leaderboard`

查询参数：`sort=score|wins|completed`（默认 `score`）、`limit`（1–100，默认 10）、`sessionId`（用于标记 `isYou`）。

```json
{
  "ok": true,
  "sort": "score",
  "entries": [
    {
      "rank": 1,
      "playerKey": "4ff0e11f2e",
      "displayName": "上线守门人",
      "bestScore": 3300,
      "wins": 2,
      "losses": 0,
      "runs": 2,
      "winRate": 1,
      "bestCompleted": 13,
      "lastPlayedAt": "2026-10-22T10:05:00.000Z",
      "isYou": false
    }
  ]
}
```

公开排行榜不返回完整 `sessionId`，只返回派生 `playerKey`。同一玩家多局取最佳值；分数相同依次比较胜场、最近游玩时间。

### `GET /api/achievements`

查询参数二选一：

- `runId=...`：返回该局 20 项成就的进度与解锁结果。
- `sessionId=...`：返回该会话跨对局合并后的成就墙、总点数、解锁数与每局摘要。

```json
{
  "ok": true,
  "scope": "session",
  "sessionId": "...",
  "displayName": "上线守门人",
  "totalPoints": 230,
  "unlockedCount": 11,
  "achievements": [
    {
      "id": "flawless-launch",
      "name": "零失误上线",
      "unlocked": true,
      "value": 1,
      "target": 1,
      "progress": 1,
      "detail": "0 漏单",
      "unlockedAt": "2026-10-22T10:05:00.000Z",
      "runId": "...",
      "unlockedRuns": 2
    }
  ],
  "runs": [{ "runId": "...", "endedAt": "...", "unlocked": 11, "points": 230 }]
}
```

### 管理接口

需要 `ADMIN_TOKEN` 时统一使用请求头：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

也支持 `?token=`，方便本地 curl；生产环境建议只用请求头。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/meta` | 无需令牌。返回 `{ authRequired, dashboard, gameVersion, gameUrl }` |
| `GET` | `/api/admin/overview` | 总览指标、结果/时代分布、近 7 日趋势、决策风格、热门成就 |
| `GET` | `/api/admin/sessions?limit=&offset=&search=` | 玩家列表、分页与昵称/sessionId 搜索 |
| `GET` | `/api/admin/sessions/:sessionId` | 单个玩家档案：run、事件时间线、决策日志、成就墙、未结算 run |
| `GET` | `/api/admin/decisions?sessionId=` | 决策聚合；带 `sessionId` 时只看该玩家 |
| `GET` | `/api/admin/achievements` | 成就定义、解锁统计与最近解锁 |
| `GET` | `/api/admin/leaderboard?sort=&limit=` | 含完整 `sessionId` 的管理端排行榜 |

## 分数规则

```text
score = max(0,
  (result === "win" ? 1000 : 0)
  + completedRequests × 100
  + round(finalProjectHealth × 10)
  - round(finalTechDebt × 5)
  - missedRequests × 100
)
```

公式定义在 `shared/scoring.ts`，服务端与客户端共用；服务端始终重新计算，不信任客户端分数。

## 成就规则

成就定义和判定在 `shared/achievements.ts`，服务端与客户端共用：

- 交付：初次交锋、首战告捷、零失误上线、满血上线、绝境翻盘、需求清道夫。
- 团队：满编团队、Agent 时代、孤胆英雄。
- 决策：决策大师、范围守门人、范围接纳者、质量优先、极限速度、调度大师。
- 风险：轻装上阵、救火队员、债台高筑。
- 速度：极速交付、冲刺上瘾。

每项成就返回 `value / target / progress / detail`，因此前台既能展示已解锁状态，也能展示进度。会话级成就墙按 `endedAt` 取最早解锁时间，同一成就跨多局只计一次点数。

## 数据与运行限制

- 不要求账号、设备号或 IP；只使用客户端生成的匿名 `sessionId` 和可选昵称。
- 事件字段经过 JSON Schema 校验，事件类型白名单，SQL 使用预处理语句。
- 请求体限制 64 KiB；事件批次最多 25 条。
- 速率限制按 `sessionId` 在进程内计数：默认每分钟 80 次事件请求、10 次结算提交；这是单进程尽力保护，不是分布式防刷。
- CORS 开放且不带凭证；公开部署建议按实际域名收紧 `origin`。
- 客户端上报的 run 指标仍是不可信输入；服务端只保证分数由服务端公式计算，无法阻止修改后的客户端伪造指标。
- 排行榜、成就与后台依赖匿名 session；清除浏览器数据会丢失本地事件与成就回退数据。
- SQLite 需要放在持久化卷上，并在接收流量前执行迁移。

## 测试

```sh
npm --prefix server test
npm run build
```

测试使用真实的内存 SQLite，覆盖迁移、事件校验与幂等、分数、速率限制、排行榜、成就推导、后台鉴权、单用户档案和事件-only 会话。根目录 `npm test` 还会运行游戏逻辑、共享成就/决策目录和上报队列测试。
