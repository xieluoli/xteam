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

## 按需读取

| 工具 | 可选筛选 | 默认与组合语义 |
| --- | --- | --- |
| `list_todos` | `completed`（布尔值） | 不传返回全部；`false` 仅未完成、`true` 仅已完成；可与 `project_id`、标题 `q` 同时使用 |
| `get_project_context` | `completed`（布尔值） | 只筛选返回的 Todo，项目简介和链接保持完整；不传仍返回全部 Todo |
| `list_skills` | `label`（单个标签） | 非空、最多 100 字符，去掉首尾空白后精确匹配；可组合名称 `q`；仅返回元数据 |

网页 API 使用相同规则：`GET /api/todos?project_id=<项目ID>&completed=false`、`GET /api/projects/<项目ID>/context?completed=false` 和 `GET /api/skills?label=<已编码标签>&q=<已编码名称>`。HTTP `completed` 仅接受 `true` / `false` 字符串；空值、其他值或重复参数报错。MCP 传 JSON 布尔值。

## 外部 agent 接续示例

以下为工具参数示意，先取得真实 ID，再替换占位符：

1. `list_projects`：`{"q":"项目名称"}`，找到稳定项目 ID。
2. `get_project_context`：`{"id":"<项目ID>","completed":false}`，读取简介、链接及尚未完成的行动。
3. `list_agents` 查找工作准则；`list_skills`：`{"q":"review","label":"研发"}`，按名称与实际已有标签找到方法，再用 `get_agent` / `get_skill` 的 `{"id":"<资源ID>"}` 读取正文及必要文本文件。
4. 在外部完成工作后，`update_todo`：`{"id":"<Todo ID>","description":"已完成的内容、验证结果、交付链接与遗留问题","completed":true}`。`description` 会整体替换；补充进展时先读取并合并需要保留的既有说明，再回写新文本，省略 `completed` 可保留完成状态。
5. `get_project_context`：`{"id":"<项目ID>","completed":true}` 查看已完成结果。网页项目详情点击“刷新项目”可看到外部回写，无需重新登录。

网页 Todo 区可选择全部、未完成或已完成；总计仍表示整个项目。点击“复制项目上下文”导出纯文本 Markdown，包含项目简介、稳定 ID、链接和全部 Todo 的状态及说明/结果，供外部客户端阅读；网页显示筛选不截断这份复制内容。复制不抓取链接正文，也不包含 MCP 令牌。

当前 Todo 仍只有未完成/已完成；未提供工作会话、心跳或 Token 采集，也没有实时推送。刷新项目是显式读取操作。

删除工具是永久操作，客户端应确认用户意图；项目删除连同其链接、Todo 删除。文档 URL 不代表有第三方访问权限。MCP 不执行模板、脚本、命令，也不访问服务器文件。
