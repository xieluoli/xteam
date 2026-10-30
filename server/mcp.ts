import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { resources, resourceKinds, schemas } from './resources.js';
import { skills } from './skills.js';
import type { SkillFetch } from './skill-source.js';
import { hashToken } from './store.js';
export function attachMcp(app: Express, database: Database.Database, origin: string, skillFetch?: SkillFetch) {
    app.all('/mcp', async (request, response) => {
        response.set('Cache-Control', 'no-store');
        if (request.get('origin') && request.get('origin') !== origin) {
            response.status(403).json({ error: 'Origin rejected' });
            return;
        }
        const bearer = request.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
        const member = (bearer ? database.prepare('SELECT users.id FROM tokens JOIN users ON users.id=tokens.user_id WHERE tokens.hash=? AND users.enabled=1').get(hashToken(bearer)) : undefined) as { id: string } | undefined;
        if (!member) {
            response.status(401).json({ error: '有效的个人访问令牌必填' });
            return;
        }
        if (request.method !== 'POST') {
            response.set('Allow', 'POST').status(405).end();
            return;
        }
        const service = resources(database);
        const server = new McpServer({ name: 'xteam', version: '1.0.0' });
        const register = (name: string, description: string, inputSchema: Record<string, z.ZodType>, action: (args: any) => unknown, destructive = false, readOnly = false) => {
            server.registerTool(name, { description, inputSchema, annotations: { destructiveHint: destructive, readOnlyHint: readOnly, openWorldHint: false } }, async (args) => {
                try {
                    return { content: [{ type: 'text', text: JSON.stringify(await action(args)) }] };
                }
                catch (error) {
                    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '操作失败' }] };
                }
            });
        };
        for (const kind of resourceKinds) {
            const singular = { projects: 'project', agents: 'agent', links: 'link', todos: 'todo' }[kind];
            register(`list_${kind}`, `查找团队 ${kind}，可按名称过滤；链接和 Todo 可按项目过滤；Todo 的 completed 默认全部，false 仅未完成、true 仅已完成。`, { q: z.string().optional(), project_id: z.string().optional(), ...(kind === 'todos' ? { completed: z.boolean().optional() } : {}) }, args => service.list(kind, args.q, args.project_id, args.completed), false, true);
            register(`get_${singular}`, `读取 ${singular} 完整正文与稳定 ID。`, { id: z.string() }, args => service.get(kind, args.id), false, true);
            register(`create_${singular}`, `创建共享 ${singular}。`, schemas[kind].shape, args => service.save(kind, args));
            register(`update_${singular}`, `修改共享 ${singular}。只传需要修改的字段；Todo 可写结果摘要与完成状态。`, { ...schemas[kind].partial().shape, id: z.string() }, ({ id, ...data }) => service.update(kind, id, data));
            register(`delete_${singular}`, kind === 'projects' ? '永久删除项目及其链接和 Todo；应先确认用户意图。' : `永久删除共享 ${singular}；应先确认用户意图。`, { id: z.string() }, args => service.remove(kind, args.id), true);
        }
        const skillService = skills(database, skillFetch);
        register('list_skills', '按名称及单个精确标签查找团队 Skill 元数据，不返回正文或附属文件。', { q: z.string().optional(), label: z.string().optional() }, args => skillService.list(args.q, args.label), false, true);
        register('get_skill', '读取 Skill 正文、来源、标签及附属文本文件，不执行内容。', { id: z.string() }, args => skillService.get(args.id), false, true);
        register('import_skill', '从 GitHub 或 skills.sh URL 导入；同名默认冲突，覆盖需用户明确同意。', { url: z.string(), on_conflict: z.enum(['fail', 'overwrite', 'rename', 'skip']).optional() }, args => skillService.importUrl(args, member.id));
        register('discover_skills', '只读发现 URL 下的 Skill 候选与来源树快照，不执行或导入内容。', { url: z.string() }, args => skillService.discover(args), false, true);
        register('import_skills', '选择来源树快照内的 1–20 个目录批量导入，逐项返回结果；覆盖需用户明确同意，只重试未成功项。', { url: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/), items: z.array(z.object({ path: z.string().max(1000), on_conflict: z.enum(['fail', 'overwrite', 'rename', 'skip']).optional() })).min(1).max(20) }, args => skillService.importMany(args, member.id));
        register('update_skill', '修改名称、简介、正文或标签，属性与 frontmatter 同步。', { id: z.string(), name: z.string().optional(), description: z.string().optional(), content: z.string().optional(), labels: z.array(z.string()).optional() }, ({ id, ...data }) => skillService.update(id, data, member.id));
        register('refresh_skill', '从保存的来源覆盖本地正文及文件；应先确认用户意图。失败保留旧内容。', { id: z.string() }, args => skillService.refresh(args.id, member.id), true);
        register('write_skill_file', '保存附属文本文件；SKILL.md 使用 update_skill 修改，不执行内容。', { id: z.string(), path: z.string(), content: z.string() }, args => skillService.file(args.id, args.path, args.content, member.id));
        register('delete_skill_file', '永久删除附属文件；应先确认用户意图。', { id: z.string(), path: z.string() }, args => skillService.file(args.id, args.path, undefined, member.id, true), true);
        register('delete_skill', '永久删除 Skill 及附属文件；应先确认用户意图。', { id: z.string() }, args => skillService.remove(args.id), true);
        register('get_project_context', '一次读取项目简介、关联链接与 Todo；completed 可选，默认包含全部 Todo，false 仅未完成、true 仅已完成。链接不代表第三方正文权限。', { id: z.string(), completed: z.boolean().optional() }, args => service.context(args.id, args.completed), false, true);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        response.on('close', () => { void transport.close(); void server.close(); });
        try {
            await server.connect(transport);
            await transport.handleRequest(request, response, request.body);
        }
        catch {
            if (!response.headersSent)
                response.status(500).json({ error: 'MCP 请求失败' });
        }
    });
}
