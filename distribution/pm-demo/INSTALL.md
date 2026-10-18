# PM · Codex 项目级安装

本包仅安装角色与技能，不执行 PM、技能脚本或付费模型请求。需要已安装的 Codex（支持 `.codex/agents/*.toml`）及 Node.js 22+；缺少条件先说明，不自动安装工具或改全局配置。

## 在 Codex 中安装

确认当前产品项目，不把下载目录当作产品目录。核对 GitHub 发布者、固定发布版本与 SHA256SUMS（校验值须从可信发布记录取得，不能从未知包自证可信），查看本文件、`manifest.json`、`install.mjs` 和角色定义，再运行同一脚本：

```sh
node /path/to/pm-demo/install.mjs --workspace /path/to/product --check
node /path/to/pm-demo/install.mjs --workspace /path/to/product
```

两条均成功才报告文件安装完成。也可在终端直接运行这两条，路径替换为解压包和已存在的产品目录，带空格时加引号。不要下载后管道执行，不以管理员权限运行。

原生落点：`.codex/agents/pm-demo.toml`、`.codex/agents/prototype-review.toml`；六项完整技能位于 `.agents/skills/`。MIT 许可同时保存到 `.xteam/licenses/pm-demo/LICENSE`；安装回执 `.xteam/installs/pm-demo.json` 记录本包快照及文件哈希。

脚本不覆盖已有不同文件或相同 Skill 目录中的额外文件，全部预检通过才写入；相同内容跳过。失败时只清理本轮新增且未被改动的文件，无法安全清理时明确报告，不删用户原文件。同版本再次安装幂等；新版冲突需人工审核，不自动升级或强制替换。

## 宿主核验（不能用文件齐全冒充发现成功）

1. 核对六项技能与两个命名角色定义存在、内容一致。
2. 在 Codex 的技能列表与可用角色信息中核对 PM、prototype-review 及六项技能；若未发现，新开/重启会话后再查。
3. 未获用户明确授权，不启动角色或调用模型做冒烟。报告“文件已安装；宿主发现已验证/未验证；角色调用未运行”。用户明确要求冒烟后，再由主 Agent 按名称委派给 PM 并检查只读响应，不能换角色自演。
4. PMSpec 的手动阶段标记保持不变，先由用户选择阶段，PM 读取对应本地技能正文及索引；不自动开始 explore/propose/apply。
5. peer/子 Agent 是否可用由当前 Codex 版本及权限决定。缺少独立审核、浏览器或宿主加载能力时列出阻塞，不启用实验功能、不改 `config.toml`、`AGENTS.md`、权限、模型、MCP 或全局配置。

本地安装是一份独立快照，不在用户电脑上运行 xteam 守护进程，也不持续连接 VPS。MCP、私有组织数据、登录 Token 不在本包内。`SOURCE.md` 和 `PMSPEC-SOURCES.md` 保留来源说明。只允许将获准公开的通用快照发布到公开 GitHub；公司资产不自动导出。
