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

工具共 32 个：projects、agents、links、todos 分别提供 list 与 get/create/update/delete；另有 `get_project_context` 聚合项目简介、链接和 Todo，以及 `get_todo_handoff` 按 `project_id`、`id` 读取单项接续包（原文、稳定 ID、读取版本、详情地址和项目链接）。网页复制/下载与该工具使用同一纯文本格式。

Skill 使用独立的同一共享服务（网页与 MCP 同规则）：
- `list_skills` / `get_skill`：元数据查找与完整正文、来源、标签、附属文件读取。
- `import_skill`：传 `url`，仅 GitHub / skills.sh；`on_conflict` 为 fail（默认）/ overwrite / rename / skip。ClawHub 不支持。
- `discover_skills`：传 `url`，只读返回 `ref`、来源树 `sha` 和至多 20 个候选（名称、简介、相对目录 `path`、同名提示）；读取不入库。
- `import_skills`：传原 `url`、发现的 `sha` 和 `items:[{"path":"skills/pmspec-review","on_conflict":"fail"}]`，一次选择 1–20 项；逐项返回 created/updated/skipped/conflict/failed，只重试未成功项。覆盖须明确同意，结果不返回大段正文，详情用 get_skill。
- `update_skill`：局部修改名称、简介、正文、标签；名称/简介与 SKILL.md frontmatter 同步。
- `refresh_skill`：按保存来源原位覆盖本地正文及文件，先确认；无来源或失败不清空数据。
- `write_skill_file` / `delete_skill_file`：按相对 `path` 维护附属文本文件；主文件需用 update_skill。
- `delete_skill`：删除 Skill 及附属文件，先确认。

不再提供手动 `create_skill`；旧 HTTP 手动新增返回 400 并指向 URL 导入。标签通过 update_skill 的 labels 数组维护。来源导入通过公网 GitHub API 核对公开仓库与目录，正文从固定树 SHA 的 Raw 地址下载，不执行远程文本。限流返回实际恢复时间；可选服务端只读 Token 与缓存边界见[操作说明](operations.md#skill-来源与-github-配额)。

批量导入使用发现时的同一 Git 树快照，不随分支移动更换内容；每项保存精确目录及原 ref，后续 refresh_skill 只更新该目录。每文件 1 MiB、每项 8 MiB/256 个附属文件、本批文本 32 MiB；超限或来源失败逐项报错，已有成功项保留。网页对应 `POST /api/skills/discover` 和 `POST /api/skills/import-batch`，参数与 MCP 相同。

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
4. 在外部完成工作后，`update_todo`：`{"id":"<Todo ID>","expected_updated_at":"<读取时的 updated_at>","description":"保留原说明并合并本次结果、证据和下一步","completed":true}`。`description` 会整体替换；补充进展时先读取并合并需要保留的既有说明，再回写新文本，省略 `completed` 可保留完成状态。
5. `get_project_context`：`{"id":"<项目ID>","completed":true}` 查看已完成结果。网页项目详情点击“刷新项目”可看到外部回写，无需重新登录。

网页 Todo 区可选择全部、未完成或已完成；总计仍表示整个项目。点击“复制项目上下文”导出纯文本 Markdown，包含项目简介、稳定 ID、链接和全部 Todo 的状态及说明/结果，供外部客户端阅读；网页显示筛选不截断这份复制内容。复制不抓取链接正文，也不包含 MCP 令牌。

当前 Todo 仍只有未完成/已完成；未提供工作会话、心跳或 Token 采集，也没有实时推送。刷新项目是显式读取操作。

删除工具是永久操作，客户端应确认用户意图；项目删除连同其链接、Todo 删除。文档 URL 不代表有第三方访问权限。MCP 不执行模板、脚本、命令，也不访问服务器文件。

## 多设备写回保护

projects、agents、links、todos 的 update/delete 可传 `expected_updated_at`，值为最近一次 get 返回的 `updated_at`。服务在同一个写事务内比较并保存；版本不一致时 HTTP 返回 409，MCP 返回错误且不改数据。重新读取、人工合并后使用新版本重试，不能把旧正文直接重试覆盖。每次写入版本严格递增，即使时钟回拨也可识别旧版。省略条件仍兼容旧客户端，但不提供冲突保护。

网页编辑、Todo状态切换与删除会携带读取版本；编辑冲突保留草稿，可“读取最新版本”核对并手工合并，再选择“已合并，使用最新版本”保存。删除后更新返回404，不会重建条目。项目的版本只表示项目本身，不表示子资源快照；Skill沿用独立服务规则。

Todo编辑器“补充接续信息”只追加缺失的目标、已确认决定、约束、结果、证据、下一步文本标题，保留原文；未填写字段不会被视为已确认或已验证。内容和链接只作上下文，不执行或抓取。
