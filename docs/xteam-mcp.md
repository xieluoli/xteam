# XTeam MCP（本地首版）

XTeam 通过远程 Streamable HTTP `/mcp` 提供工作区范围的 Issue 工具，不要求 daemon。当前实现以官方 Go MCP SDK v1.8.0 处理协议，支持无会话请求/JSON 响应。OAuth、stdio、用量采集和资产安装不在本轮范围。

## 创建与连接

1. 登录 XTeam，进入 Settings → API Tokens → MCP keys。
2. 填写名称、选择一个有权访问的工作区，选择有效期（7/30/90 天）。读取默认启用，创建/修改与删除分别显式启用。
3. 完整密钥只显示一次。保存到本地安全环境变量 `XTEAM_MCP_KEY`；不要写进仓库、URL、终端日志或分享的配置。
4. 将界面生成的配置加入用户自行选择的 Codex 配置位置：

```toml
[mcp_servers.xteam]
url = "https://<你的XTeam域名>/mcp"
bearer_token_env_var = "XTEAM_MCP_KEY"
```

此模板不含真实密钥。`url` 使用实际对外地址。现有 Next 代理转发 `/mcp`；自建网关也需要将该路径转发给 Go 后端。MCP Key 不是原有 `mul_` API Token：它不能登录网页、调用普通 API、读取其他工作区或创建更多密钥。

客户端必须每次请求携带 `Authorization: Bearer <key>`。服务端不依赖协议连接缓存权限，撤销/过期/失去成员资格后，新请求被拒绝；已在执行的操作不承诺中途回滚。撤销不删除此前创建的 Issue。

## 工具

| 工具 | 参数与权限 |
|---|---|
| `xteam_identity` | 无参数；返回用户、工作区和权限 |
| `xteam_issue_list` | `limit`（1–50，默认20）、`offset`、可选 `status` / `project_id`；读取 |
| `xteam_issue_search` | `query`，可选 `limit` / `offset`；读取 |
| `xteam_issue_get` | `id`（UUID 或工作区编号）；读取 |
| `xteam_issue_create` | 必填 `request_id` 和 `title`，可选 `description,status,priority,project_id,start_date,due_date`；写入 |
| `xteam_issue_update` | `id` 与 `changes`，字段与创建时相同（无 `request_id`）；写入 |
| `xteam_issue_delete` | `id`、`confirmed=true`；删除权限与用户明确授权 |

创建时同 Key、同 `request_id`、相同字段只创建一次；换字段重用该标识会失败。请求记录与 Issue 在同一事务提交，并发重试也只创建一次；原 Issue 已删除后不能重用旧标识重新创建。不同 Key 的请求不互相去重。

日期格式为 `YYYY-MM-DD`。修改可用 `null` 清除项目/日期；描述沿用现有 Issue API 语义。没有暴露指派 Agent/Squad、执行、唤醒、评论或其他 API 参数，更新始终抑制直接指派运行。已有业务事件/清理规则继续复用，不把 MCP 确认字段当作客户端人类批准的证明。

删除是破坏性操作，会执行既有 Issue 删除清理（包括必要的关联解绑/任务取消）；调用前必须向用户说明并取得授权。工具注解只帮助客户端展示，不是服务端权限替代品。

## 密钥与运维边界

- 数据库存储密钥哈希和前缀，页面列表不返回完整密钥；创建响应 `Cache-Control: no-store`。
- 请求和工具调用审计只包含身份/工作区/Key ID/工具/结果，不记录 Key、Issue 正文或原始参数。
- 单次 MCP 请求体上限128 KiB。路由复用现有 Redis 每IP限流（120次/分钟）；没有配置 Redis 时遵循既有 fail-open 行为，不宣称无限制环境已受限流保护。
- 迁移 `576` 建表，`577–579` 各自并发建立唯一索引，均已登记重试清理。工作区删除清理密钥及其请求记录；不增加外键/级联。
- 旧 API Tokens、平台执行引擎及旧客户端协议保持不变。新增能力不代表已部署到 VPS。

## 本地验证

相关测试：
- `server/internal/handler/mcp_test.go`：协议/SDK客户端、CRUD、并发创建去重、权限、过期撤销、跨工作区。
- `server/cmd/server/mcp_integration_test.go`：真实路由下的两类凭据隔离。
- `packages/views/settings/components/mcp-keys-section.test.tsx`、`packages/core/api/mcp-keys.test.ts`：页面和响应校验。
- `e2e/mcp-keys.spec.ts`：原生 TestApiClient 夹具创建并清理工作区，在真实页面创建 Key、调用同源 MCP、撤销后拒绝。

官方 SDK/协议客户端验收与真实 Codex 客户端调用分开记录。未经明确授权，不调用用户已安装的真实 Agent CLI/账号或付费模型。可以先在隔离配置中检查 Codex 接入；没有运行就明确 Not run，不能把 TOML 可复制视为 Codex 已连接。

## 父子关系与历史用量快照

Issue 创建/修改支持 `parent_issue_id`（目标工作区的 Issue UUID）；修改传 `null` 可解除父级。服务端复用真实父子关系，拒绝跨工作区、自引用及祖先循环。不提供指派或执行工具；已有子任务规则仍属于原业务事件，批量迁移应先核对目标父 Issue 没有会触发运行的规则。

新增两个工具：
- `xteam_issue_usage_list`：`id`（UUID 或编号），需要 `issues:read`，返回该 Issue 的导入历史快照数组。
- `xteam_issue_usage_import`：需要 `issues:write`，替换一份来源确定的历史快照，不创建平台运行或计费记录。

导入字段：`id`、`source_workspace_id`、`source_issue_id`、`source_issue_identifier`、`source_name`、`captured_at`（RFC3339）、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、`task_count`（有用量记录的运行数）。计数必须是非负安全整数。

`coverage` 可省略或为 `null`，表示源端未提供覆盖情况，未知不能解释为零。已知时提供 `terminal_task_count`、`metered_task_count`、`unreported_task_count`，结束数必须等于已上报数加缺报数。四类 Token 保留源端计量语义，不擅自相加成账单；此接口不导入费用或模型明细。

快照以「目标工作区 + 目标 Issue + 来源工作区 + 来源 Issue」唯一标识：同一快照重试不累计，新时间替换旧值，旧时间或同时间不同内容返回冲突。不同来源分别展示，不默认合计，避免交叉来源重复计数。保存时与 Issue 删除串行化，Issue/工作区删除会清理快照。

详情显示“导入的历史 Token”、来源、快照时间、四类计数及覆盖情况；独立于当前 XTeam 的本地运行消耗，不改变原 `/usage` 统计。只读详情 API 为 `GET /api/issues/:id/imported-usage`；写入只通过 MCP 权限入口。本轮不自动采集会话、不注册 hooks，不冒充实际执行用量或账单凭证。
