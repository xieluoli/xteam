# Release 升级

侧栏底部“检查更新”打开设置中的系统更新。部署管理员可检查正式 Release、确认目标并升级；普通成员只能查看版本和结果。检查不会自动部署。

最新版采用固定仓库 `xieluoli/xteam` 的 Latest 正式 Release，排除草稿、预发布，不回退到 main。tag 固定为完整 SHA，须已合入 main 且该提交最新的 main / `check.yml` CI 通过。已有版本领先 Release 时不降级；目标变化必须重新检查确认。

## 从本机升级

本机需要 Node.js 24，不需要安装项目依赖。以下命令直接通过 HTTPS 和现有账号认证，不连接 VPS 的 SSH：

```sh
node scripts/upgrade.ts status --url https://xteam.space01.cc --email operator@example.com
node scripts/upgrade.ts check --url https://xteam.space01.cc --email operator@example.com
node scripts/upgrade.ts upgrade --url https://xteam.space01.cc --email operator@example.com
```

密码从交互终端隐藏输入，不放入参数。升级前展示 Release 与 SHA，并要求输入 `upgrade` 确认；`--yes` 可跳过这次确认，仍执行账号权限和目标校验。退出码：0 成功/无更新，1 参数、认证、连接错误或取消，2 升级失败或已回退。结束时退出本次临时登录，不保存凭据。

升级中断连接时继续等待结果；再次运行 `status` 可查询持久状态，不要重复触发。页面刷新后也读取同一状态。

## 首次启用（管理员操作一次）

本功能首次安装与之后的升级分开。先在测试实例演练，再按已批准的发布流程更新现有实例；不使用未经合入的分支部署。此文档不代表已在生产安装或创建 Release。

宿主需要已安装的 Node.js 24、git、gh、Docker 和 tar。不能用应用容器内的 Node 代替宿主进程，也不自动安装新工具。先运行 `gh auth status`，不足权限时走官方登录，不把令牌写入命令、服务文件或聊天。运行升级服务的宿主账号必须有固定仓库读取权限及 Docker 权限。

1. 核对宿主当前容器 `xteam-rewrite`、`XTEAM_VERSION` 完整 SHA、`/data` 持久挂载、端口及 `.NetworkSettings.Networks` 的全部网络和别名。保留旧容器、旧镜像及所有数据卷。
2. 创建 `/opt/xteam-updater`（仅宿主管理员可写，权限 700），从已审阅版本安装 [updater.ts](../scripts/updater.ts) 到 `/opt/xteam-updater/updater.ts`。用 git/gh 将固定仓库克隆到 `/opt/xteam-updater/source`，保持 origin 为该仓库的 HTTPS 或 SSH `.git` 地址。升级构建使用独立临时归档，不重置此 checkout。
3. 为 socket 建立目录 `/opt/xteam-rewrite/update`，所有者 root、组为容器用户实际 GID、权限 750。应用只能访问 socket，不能写目录或升级服务脚本。安装 [systemd 示例](../scripts/xteam-updater.service)，核对 Node 的实际绝对路径与容器 GID，再启用服务。
4. 按现有部署流程保留全部运行配置，为应用增加只读挂载 `/opt/xteam-rewrite/update:/run/xteam-update:ro`，设置 `XTEAM_UPGRADE_SOCKET=/run/xteam-update/updater.sock` 和 `XTEAM_UPGRADE_ADMINS=operator@example.com`。邮箱必须由管理员明确指定；多个邮箱以逗号分隔。不启用时省略 socket 配置，页面显示未启用。
5. 通过真实域名登录，先验证普通成员触发得到 403，再验证指定账号和本机 CLI 的检查/确认。只有正式 Release 可用且版本向前时才进行实际升级演练；不要为了演示重新发布旧 demo 版本。

宿主配置（不属于应用环境）：

| 变量 | 默认值 |
| --- | --- |
| `XTEAM_UPDATER_DIRECTORY` | `/opt/xteam-updater` |
| `XTEAM_UPDATER_SOURCE` | 上述目录的 `source` |
| `XTEAM_UPDATER_SOCKET` | `/opt/xteam-rewrite/update/updater.sock` |
| `XTEAM_UPDATER_CONTAINER` | `xteam-rewrite` |
| `XTEAM_UPDATER_HEALTH` | `https://xteam.space01.cc/health` |
| `XTEAM_UPDATER_GROUP` | 需填写容器用户实际 GID，示例为 1000 |

宿主进程仅接受固定的检查、升级和状态操作；没有任意命令、仓库或路径输入。应用容器不挂载 Docker socket。升级权限不等于创建用户、创建 Release 或其他服务运维权限。首次安装进程和权限配置仍须按现有运维授权执行。

## 切换与恢复

升级顺序：校验 Release/CI/向前版本 → 构建固定 SHA → SQLite 在线备份并检查完整性 → 保存权限 600 的备份 → 目标镜像只读检查备份 → 保存恢复记录 → 保留并停止旧容器 → 重建应用、保留环境/挂载/端口/完整网络及别名 → 公网 `/health.version` 等于 Release SHA → 记录成功。

当前自动切换仅覆盖既有 `/data` 的简单容器配置；静态 IP、特权模式、设备、额外挂载类型等需管理员核对，程序在切换前停止。它不处理跨数据库架构迁移。备份和旧容器不自动清理；不要删除卷。

构建或备份失败不停止旧应用。切换或健康检查失败时保留失败容器，恢复旧容器名称并启动；只回退应用，不把旧数据库备份覆盖新数据。宿主进程在切换时中断，重启后根据恢复记录核对容器身份并回退。回退失败会持久记录“需管理员核对”，不会继续自动部署。

宿主 `status.json` 保存阶段和结果，`transaction.json` 保存切换身份，`backups/` 保存备份。目录不能向网页用户开放。记录回退失败时，管理员先核对原/新容器 ID、镜像、完整网络和公网版本，再按记录恢复；不盲目恢复数据库。版本验收同时保留 Release、tag、完整 SHA、线上页面及 CLI 结果。
