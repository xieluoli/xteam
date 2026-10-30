# 操作与部署

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `XTEAM_ORIGIN` | `http://localhost:3100` | 浏览器精确来源；公网必须配置 HTTPS |
| `XTEAM_DATABASE` | `data/xteam.db` | 独立 SQLite 路径 |
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `3100` | 端口 |
| `XTEAM_VERSION` | `development` | `/health` 回显版本 |
| `XTEAM_UPGRADE_SOCKET` | 未启用 | 宿主升级服务的 Unix socket，应用不访问 Docker socket |
| `XTEAM_UPGRADE_ADMINS` | 无 | 可触发检查和升级的账号邮箱，逗号分隔 |
| `XTEAM_GITHUB_TOKEN` | 无，匿名读取 | 可选的服务端公开仓库只读 Token，提高 GitHub API 配额；只发送到 `api.github.com` |

单实例运行，数据目录权限限制为服务用户，磁盘/备份按敏感资料保护。应用有登录失败限速；代理后按连接地址计数，同一代理下共享额度。不要把不同公网来源反代到同一实例。会话有效期 7 天，写请求校验 Origin 与 CSRF。

正式 Release 的页面/本机命令行升级、首次启用和回退见 [Release 升级](upgrades.md)。

## Skill 来源与 GitHub 配额

来源只支持公开仓库。GitHub API 用于核对仓库公开性和读取目录树，正文与附属文本从 `raw.githubusercontent.com` 按固定树 SHA 下载。网页和 MCP 共用相同流程，不逐文件请求 Blob API。

未设置 Token 时仍受匿名每出口 IP 60 次/小时的 REST 配额限制；使用普通用户认证后通常为该用户共享的 5,000 次/小时，仍可能遇到次级限流。按响应给出的恢复时间重试，不持续点击。Raw 下载也不承诺无限可用。

需要提高配额时，由部署管理员创建专用、最小权限的公开仓库只读细粒度 PAT，将其作为 `XTEAM_GITHUB_TOKEN` 注入应用容器环境后重建应用。配置文件权限设为600，沿用既有受保护的环境文件；不要放进网页、命令参数、Git、PR、日志或聊天，不复制开发设备的 `gh` 凭据。该配置只允许公开仓库读取，不扩展私有来源支持；Raw 下载不携带 Token，不跟随重定向。

进程内最多缓存128个响应、合计32 MiB，并合并相同 URL 的并发请求。仓库/分支信息缓存30秒，固定树与文件缓存15分钟；来源更新最多受30秒元数据缓存影响。失败不缓存，重启清空缓存，不改变数据库中的正文或文件。

## 账号

```sh
pnpm admin set-password member@example.com
pnpm admin disable member@example.com
```

set-password 创建或重置账号并启用；交互输入强密码，不写进参数或日志。重置使旧网页会话失效；disable 同时删除会话及 MCP 令牌，重新启用也不会恢复旧令牌。用户可以在网页修改自己的密码、退出登录。

## 备份恢复

```sh
pnpm backup /安全目录/xteam-backup.db
```

使用 SQLite 在线备份，不在运行时只复制主文件（WAL 可能尚未合并）。检查备份完整性并在独立数据路径验证读取；备份中包含账号哈希、会话和令牌哈希，应限制权限。

恢复：停止**新版应用** → 保存当前数据目录 → 用已验证备份替换新版 SQLite 文件，清理对应新版旧 WAL/SHM 文件 → 启动同版本应用 → 测试登录和业务条目。不操作旧 PostgreSQL 数据卷。

## 容器

```sh
docker build -t xteam:local .
docker run -d --name xteam --restart unless-stopped \
  -p 127.0.0.1:13100:3100 -v xteam-data:/data \
  -e XTEAM_ORIGIN=https://你的域名 xteam:local
docker exec -it xteam pnpm admin set-password you@example.com
```

SQLite 持久化在独立 `/data`。HTTPS 反代全部请求到新版应用；不要保留旧 `/api`、`/mcp` 的分流。服务不提供远程账号管理。

## 此次旧版归档与回滚

旧代码已保存在本机 Git bundle 与文件快照中，含原许可证和私有配置，未上传；排除依赖/构建缓存及无法序列化的运行中 socket。归档恢复核对 Git refs 和 9,930 个文件。归档不是旧数据库备份。

VPS 切换前保存旧 Caddyfile，新版用独立目录、容器与数据库；旧容器、PostgreSQL/Redis 卷均不删除。回滚时恢复切换前 Caddyfile 并 reload Caddy，使域名重新指向保留的旧 frontend/backend。不要运行删除卷命令。
