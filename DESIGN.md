# XTEAM 界面约定

## 主题

主题通过 tweakcn 的 shadcn registry 导入，保留已批准的原始配置：

- 默认 [Japan Blues](https://tweakcn.com/themes/cmmhql9yf000404jshrdebgfj)。
- 可切换 [cyberpunk](https://tweakcn.com/themes/cmvtcqfox000204k2co0edk2u)。

只修正 Japan Blues 导出中 `card-foreground` 的 `#oklch` 语法错误。字体使用主题声明与本地 fallback，不下载字体。危险动作使用原主题的 `destructive` 角色；Japan Blues 的该角色为近黑色，不能擅自替换成红色。

[启动脚本](public/theme-init.js)在渲染前恢复 `xteam-theme`。未知值和不可用存储回退 Japan Blues；选择只属于当前浏览器。切换由[共享选择器](web/components/theme-choice.tsx)完成，不刷新或重建业务页面。

所有控件、菜单和 body 下弹层使用同一组语义变量。[主题入口与 Tailwind 映射](web/theme.css)保存官方 CLI 导入的 Japan Blues tokens、Preflight 和减少动效；[主题覆盖](web/themes.css)只补充独立的 cyberpunk 与 color-scheme。cyberpunk 使用方角和原配置紫色阴影。

## 官方接入与维护

本项目是 React/Vite + Tailwind CSS 4。使用 [shadcn CLI](https://ui.shadcn.com/docs/cli) 导入 tweakcn 的 `registry:style`，由 [components.json](components.json) 中的 `tailwind.css` 指向 `web/theme.css`：

```sh
pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/cmmhql9yf000404jshrdebgfj
```

2026-11-02 实际执行 CLI 4.23.0，未新增项目依赖。该命令把主题写入本地 CSS，页面运行时不请求 tweakcn。后续更新先检查 diff，再保留已注明的 `#oklch` 语法修正、cyberpunk 方角兼容和字体 fallback。不得用整份导出覆盖业务布局。

[shadcn 主题约定](https://ui.shadcn.com/docs/theming)负责语义颜色、字体、圆角、阴影和 spacing；具体控件结构与 size/variant 使用仓库内已有的 [shadcn 组件](web/components/ui)。Next.js 的 `Metadata`、`RootLayout` 示例不适用于本项目；字体通过 CSS 变量、本地 fallback 与 body 的 `font-sans antialiased` 生效，见 [Tailwind 字体文档](https://tailwindcss.com/docs/font-family)。

使用 `@import "tailwindcss"` 引入完整 [Preflight](https://tailwindcss.com/docs/preflight)，不另造一套全局控件 reset。Markdown 标题、段落、列表排版只在 Skill 预览内定义，避免 Preflight 清除浏览器默认样式后失去层次。

## 组件尺寸与层级

根字号为 16px，正文为 `.875rem`（14px）。尺寸沿用现有 shadcn 类名，由主题 `--spacing` 换算，不再全局强制 44px 最小高度，也不以 `height:auto` 覆盖所有 Button。

| 控件 / 规则 | 类名 / 比例 | Japan Blues（spacing .22rem） | cyberpunk（spacing .25rem） |
| --- | --- | --- | --- |
| 默认 Button、Input、Select、图标按钮 | `h-9` / `size-9` | 31.68px | 36px |
| 小 Button | `h-8` | 28.16px | 32px |
| 大 Button | `h-10` | 35.2px | 40px |
| TabsList | `h-9`，内边距 3px | 31.68px | 36px |
| TabsTrigger | `h-[calc(100%-1px)]`，`px-2 py-1` | 位于 TabsList 内 | 位于 TabsList 内 |
| 普通内容间距 | spacing × 2 / 3 / 4 / 6 / 8 | 7.04 / 10.56 / 14.08 / 21.12 / 28.16px | 8 / 12 / 16 / 24 / 32px |

- 新建、保存、复制上下文等主要操作用 `default`；取消、刷新、下载等次级操作用 `outline`，低强调动作与关闭按钮用 `ghost`。`secondary` 仅用于有明确次级强调需要的场景；不得给所有按钮统一刷成主色。
- Tabs 使用现有默认分段样式、激活背景和阴影，保留箭头键切换与可见焦点，不增加自制尺寸或底线风格。
- 布局的 margin、padding、gap 使用主题 spacing 倍数。窄屏内容左右至少 1rem；最大宽度、断点、边框与字体尺寸按各自语义维护，不机械换成 spacing。
- 仅目录长资源名和文件树长路径允许自动增高并换行；它们保留默认或小按钮的最小高度，不影响普通按钮。Todo 勾选区、设置行保留已有结构尺寸。

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

[设计系统尺寸与层级](tests/browser/design-system.spec.ts)、[主题及持久化](tests/browser/theme-switch.spec.ts)、[双主题响应式](tests/browser/theme-responsive.spec.ts)、[项目排序与刷新](tests/browser/project-layout.spec.ts)、[资源失败恢复](tests/browser/resource-states.spec.ts)、[迟到响应与键盘草稿保护](tests/browser/release-regressions.spec.ts)，并保留原有[浏览器工作流](tests/browser/workflow.spec.ts)和[Skill 回归](tests/browser/skills.spec.ts)。

运行 `pnpm test`、`pnpm build`、`pnpm test:e2e`。视觉证据使用临时测试数据；不为截图改动生产资源。
