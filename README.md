# XTEAM

一个轻量的团队资源空间：项目简介与链接、简单 Todo、Agent 模板、Skill 文本库，以及供外部 AI 使用的 MCP 服务。

**一个团队，邮箱密码登录，网页与 MCP 共用数据。** 不运行 Agent，不读取服务器目录，不代取第三方私有文档。模板与 Skill 是可复制的 Markdown 文本，不是插件安装器。

## 启动

需要 Node.js 24、pnpm 11。

```sh
pnpm install --frozen-lockfile
pnpm admin set-password you@example.com
pnpm build
pnpm start
```

打开 `http://localhost:3100`，使用刚创建的账号登录。密码至少 12 位，管理员命令交互输入。没有自助注册或邮件验证码。

- [操作与部署](docs/operations.md)：配置、账号、备份恢复、容器及回滚。
- [MCP 接入](docs/mcp.md)：令牌、客户端示例、工具及权限边界。
- [功能与验收](docs/scope.md)：已批准范围与使用闭环。
- [Skill 本地交付与联网限制](docs/skill-delivery.md)。
- [开发规则](AGENTS.md)：目录与验证命令。
- [MIT 许可证](LICENSE)。

## 开发验证

```sh
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

本分支为独立重写，不复用 Multica 源码。旧提交及本地归档仍适用其原许可证，不因新版本采用 MIT 而重新授权。
