# 操作与部署

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `XTEAM_ORIGIN` | `http://localhost:3100` | 浏览器精确来源；公网必须配置 HTTPS |
| `XTEAM_DATABASE` | `data/xteam.db` | 独立 SQLite 路径 |
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `3100` | 端口 |
| `XTEAM_VERSION` | `development` | `/health` 回显版本 |

单实例运行，数据目录权限限制为服务用户，磁盘/备份按敏感资料保护。应用有登录失败限速；代理后按连接地址计数，同一代理下共享额度。不要把不同公网来源反代到同一实例。会话有效期 7 天，写请求校验 Origin 与 CSRF。

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
