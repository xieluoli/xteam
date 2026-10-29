# XTEAM 界面约定

## 主题

[主题变量](web/themes.css)保留 tweakcn 的原始默认配置：

- 默认 [Japan Blues](https://tweakcn.com/themes/cmmhql9yf000404jshrdebgfj)。
- 可切换 [cyberpunk](https://tweakcn.com/themes/cmvtcqfox000204k2co0edk2u)。

只修正 Japan Blues 导出中 `card-foreground` 的 `#oklch` 语法错误。字体使用主题声明与本地 fallback，不下载字体。危险动作使用原主题的 `destructive` 角色；Japan Blues 的该角色为近黑色，不能擅自替换成红色。

[启动脚本](public/theme-init.js)在渲染前恢复 `xteam-theme`。未知值和不可用存储回退 Japan Blues；选择只属于当前浏览器。切换由[共享选择器](web/components/theme-choice.tsx)完成，不刷新或重建业务页面。

所有控件、菜单和 body 下弹层使用同一组语义变量。[Tailwind 映射](web/theme.css)负责颜色、圆角、阴影、44px 操作目标和减少动效；[布局样式](web/style.css)不定义新色板。cyberpunk 使用方角和原配置紫色阴影。

## 页面

- 项目和 Agent 使用目录行，名称与简介同列；时间及打开操作靠右，窄屏自然换行。
- 项目排序只使用名称或项目信息更新时间。Todo 和链接变化不属于项目信息更新，不请求所有项目上下文来伪造活动时间。
- 项目详情以 Todo 为主栏，关联链接和项目 ID 为辅栏，手机先显示 Todo。复制为主操作，刷新次级，编辑和删除进入更多菜单。
- 复制始终包含简介、全部链接和全部 Todo 及结果，不随筛选缩减。成功读取才更新刷新时间；失败保留之前的内容和时间。
- Skill 保留表格、筛选、批量操作、Overview/Files 与文件树；空结果隐藏表头，读取失败提供重试。
- MCP 保持地址、令牌、客户端配置三步顺序；一次性令牌与风险说明靠近操作。

## 公共交互

继续使用[已有 shadcn 控件](web/components/ui)与[公共弹窗](web/components/app-ui.tsx)。表单顶部关闭、底部取消/保存，忙碌时禁止关闭与重复提交，失败保留输入。删除确认显示对象和影响范围，焦点默认停在取消。导航提供跳到主要内容、当前位置及中文移动抽屉名称。

避免：布局调整顺带换色、把手动刷新叫实时同步、用颜色作为唯一状态、把资源内容当程序执行，以及为设计预览删减业务功能。

## 验证

[主题及持久化](tests/browser/theme-switch.spec.ts)、[双主题响应式](tests/browser/theme-responsive.spec.ts)、[项目排序与刷新](tests/browser/project-layout.spec.ts)、[资源失败恢复](tests/browser/resource-states.spec.ts)，并保留原有[浏览器工作流](tests/browser/workflow.spec.ts)和[Skill 回归](tests/browser/skills.spec.ts)。

运行 `pnpm test`、`pnpm build`、`pnpm test:e2e`。视觉证据使用临时测试数据；不为截图改动生产资源。
