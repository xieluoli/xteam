import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { resources, resourceKinds, schemas } from './resources.js';
import { hashToken } from './store.js';
export function attachMcp(app: Express, database: Database.Database, origin: string) {
    app.all('/mcp', async (request, response) => {
        response.set('Cache-Control', 'no-store');
        if (request.get('origin') && request.get('origin') !== origin) {
            response.status(403).json({ error: 'Origin rejected' });
            return;
        }
        const bearer = request.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
        const member = bearer ? database.prepare('SELECT users.id FROM tokens JOIN users ON users.id=tokens.user_id WHERE tokens.hash=? AND users.enabled=1').get(hashToken(bearer)) : undefined;
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
                    return { content: [{ type: 'text', text: JSON.stringify(action(args)) }] };
                }
                catch (error) {
                    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '操作失败' }] };
                }
            });
        };
        for (const kind of resourceKinds) {
            const singular = { projects: 'project', agents: 'agent', skills: 'skill', links: 'link', todos: 'todo' }[kind];
            register(`list_${kind}`, `查找团队 ${kind}，可按名称过滤；链接和 Todo 可按项目过滤。`, { q: z.string().optional(), project_id: z.string().optional() }, args => service.list(kind, args.q, args.project_id), false, true);
            register(`get_${singular}`, `读取 ${singular} 完整正文与稳定 ID。`, { id: z.string() }, args => service.get(kind, args.id), false, true);
            register(`create_${singular}`, `创建共享 ${singular}。`, schemas[kind].shape, args => service.save(kind, args));
            register(`update_${singular}`, `修改共享 ${singular}。只传需要修改的字段；Todo 可写结果摘要与完成状态。`, { ...schemas[kind].partial().shape, id: z.string() }, ({ id, ...data }) => service.update(kind, id, data));
            register(`delete_${singular}`, kind === 'projects' ? '永久删除项目及其链接和 Todo；应先确认用户意图。' : `永久删除共享 ${singular}；应先确认用户意图。`, { id: z.string() }, args => service.remove(kind, args.id), true);
        }
        register('get_project_context', '一次读取项目简介、关联链接与 Todo。链接仅为地址，不代表获得第三方正文权限。', { id: z.string() }, args => service.context(args.id), false, true);
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
