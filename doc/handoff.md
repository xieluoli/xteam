# 多设备接续

[当前任务](task.md) · [工作约定](workflow.md) · [每日记录格式](daily/README.md) · [开发规则](../AGENTS.md)

doc/是共享的任务与接续记录，docs/是正式产品说明。两者随Git同步；各设备的.local/、数据、配置、凭据和个人memory不共享。历史本地证据路径只供原设备定位，不表示其他设备已拿到证据。

## 接手前

1. 完成该设备自己的GitHub认证，执行gh auth status；未登录按gh官方流程认证，不把令牌贴进聊天。Git/GitHub只用git/gh。
2. 在自己的checkout执行git status --short、git fetch origin，核对当前HEAD与origin/main。首次可用gh repo clone xieluoli/xteam；已有干净main可git pull --ff-only，脏工作区先保留修改，不重置或覆盖。
3. 依次读AGENTS.md、doc/task.md、doc/workflow.md、doc/lessons.md、doc/code-standards.md，再按Asia/Shanghai日期读当日task及最近实际完成review。尚未合入的文档PR须通过gh核对；main未包含的进度不能当作已同步。
4. 按任务编号查询已有分支/PR及平台Todo，核对范围、状态、代码可用性、验证与授权。SET-001、UPG-001、SKILL-001源码已由PR #13合入main，可直接获取；UPG首次启用和SKILL来源刷新验收仍未完成，按主入口接续，不重新实现。其他批次的未提交成果仍不能从远端HEAD推断已可拉取。
5. 写明任务的负责设备/agent标识、开始时间、源码分支/完整HEAD、范围和下一步，更新当日task与主入口；有平台权限时同步认领并回读。已有认领先协调，认领说明和本地锁都不是跨设备原子锁，不要同时改同一任务。

## 开始与验证

- 本设备复用已有持久worktree；首次才从已核对基线建立codex/日期分支。工作路径和设备锁只记.local/xteam-cycle/；源码命令显式使用该worktree绝对目录。
- 取得本设备协调锁后核对日初/上次差异，保留用户修改；按原任务ID继续未完步骤，不因换设备重做或增加执行日。
- 先写范围、分段计划及验收再改；行为变更先失败回归再修复。记录实际测试、结果、代码SHA与未验证部分；仅规划、仅开发通过和线上交付分开。
- 缺MCP凭据、线上登录态或发布权限时做其他已授权工作，将不能完成的同步/验收记为阻塞；不复制他人私有配置，不重置账号或绕过认证。

## 完成或交接时

1. 更新当日task：稳定ID、实际范围、完成/阻塞、测试结果及对应代码SHA、PR/CI链接、下一步和负责人；私有证据只写定位和结论，无法共享或未复验要说明。产品改动与纯文档采用不同验证口径。
2. 更新doc/task.md当前状态和指针。实际运行夜间复盘才填写当日review；有真实返工才合并lessons、核对硬规则，不把模板写成复盘完成。
3. 已授权平台同步时先读后合并Todo说明并回读；本机映射缺失按稳定ID重建。失败明确记待同步，不因Git成功就标平台完成。
4. fetch后对照远端同一任务的新进度；同文件冲突逐条核对范围、状态、时间和证据，保留他人备注，不用整文件覆盖或强推。先确认用户改动与暂存区，显式暂存批准路径，审阅git diff --cached --check及git diff --cached。
5. 在授权范围内中文conventional commit提交，每项[A/M/D/R/C]，邮箱xieluoli@foxmail.com；git push到codex/分支，gh查重后创建/更新PR。正文每个改动一行、测试另列，临时UTF-8 Markdown配--body-file；不上传原始证据。
6. 验证最终head的CI和合入条件，gh按预期head合入，回读merged及merge SHA，fetch确认origin/main包含结果。记录远端同步状态；权限或CI阻塞保留分支/PR与下一步，不能写已合入。文档共享不会自动同步未提交代码、平台状态或生产部署。

纯文档同步不触发VPS部署。产品发布仍按各任务授权及workflow的备份、回退、精确SHA和真实域名验收要求执行。
