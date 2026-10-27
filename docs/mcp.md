# MCP 接入

网页登录 → MCP 接入 → 创建个人令牌。完整令牌仅展示一次，可随时撤销。

- 传输：Streamable HTTP，`https://你的域名/mcp`。
- 认证：`Authorization: Bearer <个人令牌>`；只存哈希，禁用成员或撤销令牌后立即失效。
- 所有成员对团队业务内容同权；令牌不能管理账号或别人的令牌。
- 支持自定义认证头的客户端；没有 OAuth、旧 SSE 或旧 xteam API 兼容。

客户端配置示意（字段以客户端文档为准）：

```json
{"mcpServers":{"xteam":{"type":"streamable-http","url":"https://你的域名/mcp","headers":{"Authorization":"Bearer <个人令牌>"}}}}
```

MCP Inspector 选择 Streamable HTTP，填地址及 Authorization 请求头。也可使用 Inspector CLI 的私有配置文件（权限 600）运行：

```sh
pnpm exec mcp-inspector --cli --config /安全目录/mcp.json --server xteam --method tools/list
```

工具共 26 个：projects、agents、skills、links、todos 分别提供 list；project、agent、skill、link、todo 分别提供 get/create/update/delete；另有 `get_project_context` 聚合项目简介、链接和 Todo。

先 `list_projects` 获取稳定 ID，再 `get_project_context`。使用 `list_agents` / `list_skills` 找到资源并用 get 读取正文。在外部完成工作后，用 `update_todo` 写入 `description`（摘要/结果链接）和 `completed`。

删除工具是永久操作，客户端应确认用户意图；项目删除连同其链接、Todo 删除。文档 URL 不代表有第三方访问权限。MCP 不执行模板、脚本、命令，也不访问服务器文件。
