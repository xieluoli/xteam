# XTEAM

企业自己的知识与组织能力空间：知识页面、SOP、本地 Skill、Agent 与工作流程，通过网页、CLI 和 MCP 访问，并可导出迁移。

**一个企业内部团队，邮箱密码登录，三个入口共用数据。** SOP 可保存为 Skill 并绑定到工作流程或 Agent；绑定保留选定版本，不自动执行。既有项目、链接和来源 Skill 保留。

## 启动

需要 Node.js 24、pnpm 11。

```sh
pnpm install --frozen-lockfile
pnpm admin set-password you@example.com
pnpm build
pnpm start
```

打开 `http://localhost:3100`，使用刚创建的账号登录。密码至少 12 位，管理员命令交互输入。没有自助注册或邮件验证码。

- [操作与部署](docs/operations.md)：配置、账号、备份恢复、容器及回滚；Skill 来源可选服务端 `XTEAM_GITHUB_TOKEN` 配置见[配额说明](docs/operations.md#skill-来源与-github-配额)。
- [组织知识与可复用能力](docs/wiki.md)：知识页面、SOP、Skill、工作流程与迁移边界。
- [CLI](docs/cli.md)：终端知识维护、结构化输出、导出与旧任务迁移。
- [Release升级](docs/upgrades.md)：页面与命令行入口、首次启用和回退。
- [MCP 接入](docs/mcp.md)：令牌、客户端示例、工具及权限边界。
- [功能与验收](docs/scope.md)：已批准范围与使用闭环。
- [Skill 本地交付与联网限制](docs/skill-delivery.md)。
- [开发规则](AGENTS.md)：目录与验证命令。
- [任务与进度](doc/task.md) · [多设备接续](doc/handoff.md) · [每日任务与复盘](doc/daily/README.md)。
- [界面约定](DESIGN.md)：主题切换、页面布局与公共交互。
- [MIT 许可证](LICENSE)。

## 开发验证

```sh
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

本分支为独立重写，不复用 Multica 源码。旧提交及本地归档仍适用其原许可证，不因新版本采用 MIT 而重新授权。
