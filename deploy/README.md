# 部署说明（黑客松开发机）

前端静态站 + 后端 API 由两个 supervisord 进程托管，**只对外暴露 8000**。

## 拓扑

```
浏览器 → 8000 (gateway.mjs) ─┬─ GET /          → dist/ 静态文件
                             ├─ /api/*         → 127.0.0.1:8787 (hono + SQLite)
                             └─ /admin*        → 127.0.0.1:8787 (决策分析台)
```

前端 bundle 里 `VITE_API_BASE_URL` 留空，上报走同源相对路径 `/api/*`，所以必须由网关反代，
不能把前端和 API 拆成两个对外端口。

## 目录约定

| 路径 | 用途 |
|---|---|
| `/root/project/never-ending-requirements` | 代码 + `dist/` 构建产物 |
| `/root/project/epochrush-data/game.sqlite` | SQLite 数据（**在 repo 之外**，`git reset --hard` 不会动它） |
| `/root/project/never-ending-requirements/deploy/gateway.mjs` | 网关脚本 |
| `/tmp/epochrush*.log` / `.err` | 运行日志 |

## 首次部署

```bash
# 1. 拉代码
cd /root/project
git clone https://github.com/xuqiuyongbumian/never-ending-requirements.git
cd never-ending-requirements

# 2. 装依赖 + 构建
npm ci
npm --prefix server install
npm run build

# 3. 数据目录（repo 之外）
mkdir -p /root/project/epochrush-data

# 4. 注册 supervisord 进程
cp deploy/supervisor/*.conf /etc/supervisor/conf.d/
supervisorctl reread && supervisorctl update

# 5. 验证
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/
curl -s http://127.0.0.1:8000/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/admin
```

> 当前开发机到 GitHub 的连接会超时，实际更新方式为：本地打包源码 tar → `hackathon write` 上传 →
> 解包覆盖源码 → `npm run build` → 重启 supervisord。不要直接在该目录执行 `git fetch origin main`，
> 否则会卡住或被旧提交覆盖。数据库始终保存在 repo 外的 `/root/project/epochrush-data/game.sqlite`。

## 更新代码

```bash
cd /root/project/never-ending-requirements
git fetch origin main && git reset --hard origin/main
npm ci && npm --prefix server install
npm run build
supervisorctl restart epochrush epochrush-api
```

`dist/`、`node_modules/`、`server/data/` 都在 `.gitignore` 里，`git reset --hard` 不会清掉它们，
但改完代码必须重新 `npm run build`，否则网关服务的是旧产物。

## 故障排查

| 现象 | 排查 |
|---|---|
| 首页 200 但接口 404 | 网关没反代：确认 `supervisorctl status epochrush` 且 conf 里 `API_PORT=8787` |
| `/api/health` 502 | API 没起来：看 `/tmp/epochrush-api.err`，常见是 `DATABASE_PATH` 目录不可写 |
| `/admin` 404 | 网关未反代 `/admin`：确认 `deploy/gateway.mjs` 的 `proxied` 分支并重启 `epochrush` |
| 页面白屏 | 看网关日志有没有 404 静态资源；确认 `dist/` 已构建 |
| 数据丢失 | 检查 `DATABASE_PATH` 是否被改回 repo 内的 `server/data/` |

## 注意

- 长任务（`git clone`、`npm ci`）**不要**用 `&`/`nohup` 挂后台——`hackathon exec` 有 30s 超时，
  退出时会杀掉子进程。要么拆成多个短命令，要么临时写一个 `autorestart=false` 的 supervisord 程序跑。
- `hackathon write` 有服务端幂等键，同一目标路径第二次改内容会报 409，改用 `exec` + heredoc 落盘。
