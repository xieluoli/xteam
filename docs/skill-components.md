# Skill 的 Japan Blues 组件接入

2026-10-28 用户明确“接入”，批准在现有 React/Vite 内使用 Tailwind v4 与 shadcn/ui；仅迁移本次 Skill 控件，不迁移 Next.js，不改变服务端、数据及 MCP 行为。

## 接入与边界

- `web/components/ui/`：取自 [shadcn 官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json) 的 Button、Input、Textarea、Select、Checkbox、Tabs、Dialog、DropdownMenu、Table。保留 [MIT 许可](../web/components/ui/LICENSE.md)，仅调整本地 import 路径。
- [主题映射](../web/theme.css)：语义变量转 Tailwind utilities，弹出到 body 的菜单、选择器、弹窗也使用同一主题。当前 token 位于独立[主题配置](../web/themes.css)，双主题与后续布局约定见[界面约定](../DESIGN.md)。
- 不启用全局 Tailwind preflight；旧样式放入 legacy layer，组件 utilities 优先，登录/项目/模板/MCP 页保持既有风格。无全站组件迁移或新业务布局。
- [Skill 页面](../web/skills.tsx) 采用真实 Radix 状态、焦点管理、键盘选择、菜单和标签页；删除自写焦点陷阱、原生下拉、手写菜单及其废弃控件 CSS。保留文件树和预览的页面布局规则。
- [Vite 配置](../vite.config.ts) 接入 Tailwind 插件和 `@` 别名；[组件配置](../components.json) 为 React 非 RSC。Skill 按需加载，避免登录等入口一并加载组件及 Markdown 包。

## 新增依赖

运行依赖：radix-ui、lucide-react、class-variance-authority、clsx、tailwind-merge、tw-animate-css。
开发依赖：tailwindcss、@tailwindcss/vite。
这是本轮接入所需组件/工具链，不新增服务端依赖或任何付费服务。

## 验证

- 先红：旧原生选择器无法找到页面内可主题化的 listbox，组件交互用例实际失败。
- [组件浏览器验收](../tests/browser/skill-components.spec.ts) 检查可见弹层颜色、checkbox 选中颜色、菜单 Escape 后恢复焦点、键盘切换标签页及内容关联；不是只检查源码存在 data-slot。
- 原 Skill 完整浏览器流程改用真实 Select/菜单操作，其余主题、登录、项目/模板/MCP 流程继续回归。
- 最终测试数量见本轮 Issue 评论。全页截图会临时改变视口并关闭定位弹层，弹层审核改用当前视口截图，不以强制点击掩盖问题。
- 组件视觉需用户审阅截图；自动化通过不等于用户验收。联网来源的[历史DNS限制及后续真实验收](skill-delivery.md)分别记录，不以夹具替代公网证据。

本轮未提交/推送、部署、操作线上账号或数据。

## 全站迁移追加（2026-10-28）

用户进一步明确“所有页面检查一下，都不要用自写 UI 了”，已将原“仅 Skill”范围扩大到全站，不再保留其他页的自写基础控件。

- 共享壳层：官方 Sidebar / Sheet / Tooltip / Separator，桌面收起与移动抽屉，四个业务入口及账号操作保持不变；使用 sidebar 专用主题变量和 Lucide 图标。
- 登录、项目列表/详情、关联链接、Todo、Agent 模板及详情、MCP 令牌/配置、改密均使用既有 shadcn Button/Input/Textarea/Label/Card/Badge/Alert/Dialog/Select/Checkbox。
- Skill 同步复用共享 Dialog/Select/字段标签，文件目录改为 Collapsible，结果与冲突提示使用 Alert；危险操作和放弃修改统一 AlertDialog，不再使用原生 confirm。
- [业务组合](../web/components/app-ui.tsx) 只组合官方组件与已有业务状态，不是重新实现基础 UI。正文、普通链接、列表语义与页面排版仍使用正常 HTML/CSS，这不属于自写基础控件。
- 删除旧侧边栏、手写弹窗与焦点陷阱、原生控件皮肤及本次废弃规则；未新增依赖，没有改服务端、登录权限或数据契约。
- 新增[全站浏览器验收](../tests/browser/all-components.spec.ts)：移动导航、取消危险操作、模板与令牌闭环、项目/链接分类/Todo 结果编辑，逐页检查可见控件采用组件并验证移动宽度；没有用静态源码扫描替代流程验证。
- 本轮发现已有文本编辑时标签名混入默认正文，补显式可访问标签；Todo 为服务器异步持久化，测试等待真实选中状态，不强行同步本地状态。
