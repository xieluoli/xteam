# XTeam CLI

CLI 是独立的 Node.js 24 及以上版本脚本，使用 HTTPS API。没有运行时第三方依赖，也不需要 SSH、服务器目录、飞书或钉钉账号。仓库内运行 `node bin/xteam.mjs --help` 或 `pnpm cli --help`；将脚本放到 PATH 后可直接使用 `xteam`。

## 认证

通过 `XTEAM_URL` 指定实例、`XTEAM_TOKEN` 提供已有个人令牌。令牌与 MCP 共用，成员禁用或令牌撤销后即时失效。实例地址仅允许 HTTPS，回环本机开发地址除外；不接受地址内凭据或重定向。

`xteam auth login --url https://your-xteam` 验证已有环境令牌；`--token-stdin` 可从标准输入读取一次令牌用于验证。配置只保存实例地址，不持久保存令牌，后续命令仍需 `XTEAM_TOKEN`。可用 `XTEAM_CONFIG` 指定实例配置文件。不要在命令参数、脚本源码或 Git 中写入令牌。

## 知识维护

```sh
xteam space list --json
xteam space create --name 产品资料
xteam page list --space SPACE_ID
xteam page create --space SPACE_ID --title 需求评审 --kind sop --file ./review.md --request-id REQUEST_ID
xteam page get PAGE_ID --format markdown
xteam page update PAGE_ID --file ./review.md --expected-version 1
xteam search 评审 --space SPACE_ID --json
xteam attachment upload ./research.pdf --page PAGE_ID
xteam attachment download ATTACHMENT_ID --output ./original.pdf
xteam page archive PAGE_ID --expected-version 2 --yes
xteam page restore PAGE_ID --expected-version 3 --yes
xteam export --space SPACE_ID --output ./wiki-export
```

`--file -` 显式读取标准输入。新建页面重试沿用同一 `--request-id`；同一个请求 ID 携带不同内容会被拒绝。更新必须携带版本号，冲突不会覆盖本地 Markdown。请求结果不确定时先读取最新对象，不自动重放写入。

空间导出目录必须不存在。导出通过临时目录完整写入后切换为目标目录，包含 `manifest.json`、页面 Markdown、原件附件和本地 Skill 文件。Markdown 中的内部页面和附件引用转换为相对路径；原始内容及来源映射保存在 manifest。导出不包含账号、会话或令牌，不等同完整数据库灾备。

## Skill 与工作流程

```sh
xteam skill from-page PAGE_ID --expected-version 1 --name requirements-review --description 需求评审时使用
xteam skill get SKILL_ID --json
xteam skill export SKILL_ID --output ./requirements-review
xteam agent create --name 产品经理 --file ./agent.md
xteam agent bind AGENT_ID --skill SKILL_ID --skill-version SKILL_UPDATED_AT
xteam agent context AGENT_ID --json
xteam workflow create --file ./workflow.json
xteam workflow context WORKFLOW_ID --json
```

`workflow.json` 示例：

```json
{
  "name": "需求到交付",
  "description": "团队认可的工作路径",
  "steps": [
    { "title": "需求评审", "skill_id": "SKILL_ID", "agent_id": "AGENT_ID" }
  ]
}
```

更新流程使用 `workflow update ID --file workflow.json --expected-version N`。相同 Skill/Agent 的既有步骤保留原快照；在文件中显式设置 `refresh_snapshots: true` 才采用当前来源版本。流程及 Agent 上下文 JSON 可直接保存给外部工具，不绑定特定模型供应商。

## 脚本约定

`--json` 成功输出 `{ "schema_version": 1, "data": ... }`；失败在 stderr 输出 `{ "schema_version": 1, "error": { "code": "...", "message": "..." } }`。不会等待隐藏确认；归档恢复需显式 `--yes`。

退出码：0 成功，2 认证失败，3 权限不足，4 版本冲突，5 输入或资源不存在，6 网络或结果不确定，1 其他失败。

## 管理员旧任务迁移

此工具在部署主机上运行，和面向成员的 CLI 分开。只处理旧 Todo，保留项目、链接、Skill、账号和其他卷。

```sh
pnpm archive:todos plan /受限目录/todos.json
pnpm archive:todos apply /受限目录/todos.json /受限目录/全新备份.db
pnpm archive:todos restore BATCH_ID
```

`apply` 验证清单摘要、备份完整性和备份中的任务摘要，再在一个事务内保存原记录到归档表并清理活跃任务。出现并发变化则停止。备份和清单权限设为 600，包含业务原文，不入 Git。数据库原始备份还含账户和认证哈希，应按凭据保护。
