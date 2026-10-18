# PM · Codex 分发包

xteam 首版仅分发通用 PM 的固定快照；不导出当前工作区私有模板，不含 MCP、账号凭证或执行引擎。

- [MIT 协议](LICENSE)：仅适用于本分发包，不改变仓库根 Multica License 与 NOTICE。
- [安装入口](INSTALL.md)
- [完整工作准则](capabilities.md)
- [来源](SOURCE.md) · [PMSpec 来源维护](PMSPEC-SOURCES.md)
- [预检/安装器](install.mjs) · [安装行为测试](install.test.mjs)
- [打包工具](build.mjs) · [整包离线安装测试](build.test.mjs)
- [技能完整性锁](source-lock.json)

## 构建与验证

在 xteam 仓库根目录，用 Node.js 22+ 运行：

```sh
node --test distribution/pm-demo/install.test.mjs distribution/pm-demo/build.test.mjs
node distribution/pm-demo/build.mjs --output .context/pm-release
```

输出包含 `pm-demo-codex-<内容版本>.tar.gz`、`SHA256SUMS`、`release.json`。包内有两个 Codex 原生角色、六项完整 Skill 及附属文件；整个包可以离线安装。`version` 是内容快照摘要，不是模型版本。预检/安装不会启动用户安装的 Agent CLI 或发起模型调用。

PMSpec 固定 commit 见来源锁。供应快照更新需同时核对正文、附属文件、来源锁和角色工作准则，重新跑整包验证，不手动改一个哈希绕过源审查。`pmspec-init` 自带安装器保留原样；PM 安装使用包根安装器，不自动调用 init 的模型/审核冒烟。

## 发布检查点（未授权不执行）

1. 审阅本次生成包，确认没有公司私有内容、访问凭证或项目数据；保留来源声明。
2. 获得提交/推送/发布授权后，从明确代码版本构建，将完整包及 SHA256SUMS 上传到固定的 GitHub Release；不要覆盖已发布同版本资产。
3. 校验远端资产真实可下载，下载字节哈希与构建输出一致。
4. 依据 `release.json` 形成部署配置 `XTEAM_PM_INSTALL_RELEASE`（JSON 字符串），字段为 `url`、`sha256`、`version`、`instructions`（取 `agentInstructions`）、`skillNames`。url 必须是此仓固定 Release 的 `.tar.gz`，不能用 latest 或临时 Token 链接。
5. 单独获准更新 VPS 后，将此变量传给前端服务。未配置、配置格式不符或模板不匹配时 Copy 保持不可用，不展示不存在的公开下载地址。

该环境变量不是密钥，但不得夹带原始令牌；只包含已获准公开的固定快照元信息。项目源码公开不等于任意工作区资产已获准公开。

## 当前首版的有意限制

- 只有 `pm-demo` 且工作准则与启用技能名称/集合匹配已发布快照、无 MCP 配置时，才提供安装入口。弹窗明确安装公开快照，不是工作区实时导出；技能内容自行修改不会被自动公开上传。
- 不注册为全局角色，不改 `config.toml`、`AGENTS.md`、模型/权限/运行时，不加 npm 依赖；本地有 Node 才执行安装。
- 本地文件安装、宿主发现、实际调用是三个状态；安装器只证明第一个。需要真实 Codex 冒烟须另获授权，默认测试只用隔离临时目录。
- 不自动升级、不做购物车/自定义装配，不提供 Mika 或其他模板的虚假 Copy。
