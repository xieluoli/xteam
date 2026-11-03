import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { todoHandoffText } from '../shared/todo-handoff.js';
export const resourceKinds = ['projects', 'agents', 'links', 'todos'] as const;
export type ResourceKind = typeof resourceKinds[number];
const name = z.string().trim().min(1, '名称不能为空').max(200);
const description = z.string().max(50000).default('');
export const schemas = {
    projects: z.object({ name, description }),
    agents: z.object({ name, description, content: z.string().max(100000).default('') }),
    links: z.object({ project_id: z.string().min(1), title: name, url: z.url().max(4000).refine(value => ['https:', 'http:'].includes(new URL(value).protocol), '仅支持 http/https 链接'), category: z.enum(['dingtalk', 'feishu', 'gitee', 'github', 'other']).default('other') }),
    todos: z.object({ project_id: z.string().min(1), title: name, description, completed: z.boolean().default(false) }),
};
export class ResourceError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export type Resource = Record<string, string | boolean> & {
    id: string;
};
export function resources(database: Database.Database) {
    const normalize = (row: Record<string, unknown>): Resource => ({ ...row, ...('completed' in row ? { completed: Boolean(row.completed) } : {}) }) as Resource;
    function get(kind: ResourceKind, id: string) {
        const row = database.prepare(`SELECT * FROM ${kind} WHERE id=?`).get(id) as Record<string, unknown> | undefined;
        if (!row)
            throw new ResourceError('资源不存在或已删除', 404);
        return normalize(row);
    }
    function list(kind: ResourceKind, query = '', projectId?: string, completed?: unknown) {
        const label = kind === 'links' || kind === 'todos' ? 'title' : 'name';
        const scoped = (kind === 'links' || kind === 'todos') && projectId !== undefined;
        const filterCompleted = kind === 'todos' && completed !== undefined;
        if (filterCompleted && completed !== true && completed !== false && completed !== 'true' && completed !== 'false')
            throw new ResourceError('completed 必须为 true 或 false');
        const values: (string | number)[] = [query];
        if (scoped) values.push(projectId);
        if (filterCompleted) values.push(Number(completed === true || completed === 'true'));
        const rows = database.prepare(`SELECT * FROM ${kind} WHERE instr(lower(${label}),lower(?))>0 ${scoped ? 'AND project_id=?' : ''} ${filterCompleted ? 'AND completed=?' : ''} ORDER BY updated_at DESC,id DESC`).all(...values) as Record<string, unknown>[];
        return rows.map(normalize);
    }
    function save(kind: ResourceKind, input: unknown, id?: string) {
        const existing = id ? get(kind, id) : undefined;
        const parsed = schemas[kind].safeParse(input);
        if (!parsed.success)
            throw new ResourceError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'));
        const data: Record<string, unknown> = { ...parsed.data };
        if ('project_id' in data) {
            get('projects', String(data.project_id));
            if (existing && existing.project_id !== data.project_id)
                throw new ResourceError('不能将资源移动到其他项目');
        }
        const identifier = id ?? randomUUID();
        const updatedAt = new Date(Math.max(Date.now(), existing ? Date.parse(String(existing.updated_at)) + 1 : 0)).toISOString();
        const values = { ...data, id: identifier, updated_at: updatedAt };
        const columns = Object.keys(values);
        database.prepare(`INSERT INTO ${kind} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(key => key !== 'id').map(key => `${key}=excluded.${key}`).join(',')}`).run(...Object.values(values).map(value => typeof value === 'boolean' ? Number(value) : value));
        return get(kind, identifier);
    }
    function update(kind: ResourceKind, id: string, input: Record<string, unknown>) {
        const expected = z.string().min(1).max(100).optional().safeParse(input.expected_updated_at);
        if (!expected.success) throw new ResourceError('expected_updated_at 必须为读取时的 updated_at 字符串');
        return database.transaction(() => {
            const existing = get(kind, id);
            if (expected.data !== undefined && expected.data !== existing.updated_at)
                throw new ResourceError('资源已被其他设备修改，请重新读取最新内容并合并后重试；当前草稿尚未保存。', 409);
            return save(kind, { ...existing, ...input }, id);
        }).immediate();
    }
    function remove(kind: ResourceKind, id: string, expectedUpdatedAt?: unknown) {
        const expected = z.string().min(1).max(100).optional().safeParse(expectedUpdatedAt);
        if (!expected.success) throw new ResourceError('expected_updated_at 必须为读取时的 updated_at 字符串');
        database.transaction(() => {
            const existing = get(kind, id);
            if (expected.data !== undefined && expected.data !== existing.updated_at)
                throw new ResourceError('资源已被其他设备修改，请重新读取最新内容后确认删除。', 409);
            if (kind === 'projects') {
                database.prepare('DELETE FROM links WHERE project_id=?').run(id);
                database.prepare('DELETE FROM todos WHERE project_id=?').run(id);
            }
            database.prepare(`DELETE FROM ${kind} WHERE id=?`).run(id);
        }).immediate();
        return { ok: true };
    }
    const context = (id: string, completed?: unknown) => ({ project: get('projects', id), links: list('links', '', id), todos: list('todos', '', id, completed) });
    function handoff(projectId: string, id: string, origin: string) {
        const project = get('projects', projectId);
        const todo = get('todos', id);
        if (todo.project_id !== projectId) throw new ResourceError('Todo 不属于此项目', 404);
        const links = list('links', '', projectId);
        return { project, todo, links, text: todoHandoffText(project, todo, links, `${origin}/#project/${projectId}/todo/${id}`) };
    }
    return { get, list, save, update, remove, context, handoff };
}
