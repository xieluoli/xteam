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

工具共 29 个：projects、agents、links、todos 分别提供 list 与 get/create/update/delete；另有 `get_project_context` 聚合项目简介、链接和 Todo。

Skill 使用独立的同一共享服务（网页与 MCP 同规则）：
- `list_skills` / `get_skill`：元数据查找与完整正文、来源、标签、附属文件读取。
- `import_skill`：传 `url`，仅 GitHub / skills.sh；`on_conflict` 为 fail（默认）/ overwrite / rename / skip。ClawHub 不支持。
- `update_skill`：局部修改名称、简介、正文、标签；名称/简介与 SKILL.md frontmatter 同步。
- `refresh_skill`：按保存来源原位覆盖本地正文及文件，先确认；无来源或失败不清空数据。
- `write_skill_file` / `delete_skill_file`：按相对 `path` 维护附属文本文件；主文件需用 update_skill。
- `delete_skill`：删除 Skill 及附属文件，先确认。

不再提供手动 `create_skill`；旧 HTTP 手动新增返回 400 并指向 URL 导入。标签通过 update_skill 的 labels 数组维护。来源导入会访问受限的公网 GitHub API，不执行远程文本。

先 `list_projects` 获取稳定 ID，再 `get_project_context`。使用 `list_agents` / `list_skills` 找到资源并用 get 读取正文。在外部完成工作后，用 `update_todo` 写入 `description`（摘要/结果链接）和 `completed`。

删除工具是永久操作，客户端应确认用户意图；项目删除连同其链接、Todo 删除。文档 URL 不代表有第三方访问权限。MCP 不执行模板、脚本、命令，也不访问服务器文件。
