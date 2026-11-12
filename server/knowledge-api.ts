import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { knowledge, spaceInput, pageInput, pageUpdate, workflowInput } from './knowledge.js';

export function attachKnowledgeHttp(app: Express, db: Database.Database) {
    const k = knowledge(db);
    const actor = (response: { locals: Record<string, any> }) => String(response.locals.member.id);
    app.get('/api/wiki/spaces', (_q, r) => r.json(k.listSpaces()));
    app.post('/api/wiki/spaces', (q, r) => r.status(201).json(k.createSpace(q.body, actor(r))));
    app.get('/api/wiki/spaces/:id', (q, r) => r.json(k.space(String(q.params.id))));
    app.get('/api/wiki/spaces/:id/pages', (q, r) => {
        if (q.query.archived !== undefined && !['true', 'false'].includes(String(q.query.archived))) return r.status(400).json({ error: 'archived 必须为 true 或 false' });
        r.json(k.listPages(String(q.params.id), q.query.archived === 'true'));
    });
    app.get('/api/wiki/spaces/:id/export', (q, r) => r.json(k.exportSpace(String(q.params.id))));
    app.get('/api/wiki/search', (q, r) => r.json(k.search(typeof q.query.q === 'string' ? q.query.q : '', typeof q.query.space_id === 'string' ? q.query.space_id : undefined)));
    app.post('/api/wiki/pages', (q, r) => r.status(201).json(k.createPage(q.body, actor(r))));
    app.get('/api/wiki/pages/:id', (q, r) => r.json(k.page(String(q.params.id))));
    app.patch('/api/wiki/pages/:id', (q, r) => r.json(k.updatePage(String(q.params.id), q.body, actor(r))));
    app.get('/api/wiki/pages/:id/history', (q, r) => r.json(k.history(String(q.params.id))));
    app.get('/api/wiki/pages/:id/breadcrumbs', (q, r) => r.json(k.breadcrumbs(String(q.params.id))));
    app.get('/api/wiki/pages/:id/attachments', (q, r) => r.json(k.attachments(String(q.params.id))));
    app.post('/api/wiki/pages/:id/attachments', (q, r) => r.status(201).json(k.addAttachment(String(q.params.id), q.body, actor(r))));
    app.post('/api/wiki/pages/:id/skill', (q, r) => r.status(201).json(k.skillFromPage(String(q.params.id), q.body, actor(r))));
    app.get('/api/wiki/attachments/:id/download', (q, r) => {
        const a = k.attachment(String(q.params.id));
        r.set({ 'Content-Type': a.media_type, 'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(a.name)}`, 'Content-Length': String(a.size), 'Cache-Control': 'no-store' }).send(a.bytes);
    });
    app.get('/api/wiki/agents/:id/context', (q, r) => r.json(k.agentContext(String(q.params.id))));
    app.post('/api/wiki/agents/:id/skills', (q, r) => r.json(k.bindAgent(String(q.params.id), q.body, actor(r))));
    app.get('/api/wiki/workflows', (_q, r) => r.json(k.workflows()));
    app.post('/api/wiki/workflows', (q, r) => r.status(201).json(k.saveWorkflow(undefined, q.body, actor(r))));
    app.get('/api/wiki/workflows/:id', (q, r) => r.json(k.workflow(String(q.params.id))));
    app.put('/api/wiki/workflows/:id', (q, r) => r.json(k.saveWorkflow(String(q.params.id), q.body, actor(r))));
    app.get('/api/wiki/workflows/:id/context', (q, r) => r.json(k.workflowContext(String(q.params.id))));
}

type Register = (name: string, description: string, schema: Record<string, z.ZodType>, action: (args: any) => unknown, destructive?: boolean, readOnly?: boolean) => void;
export function registerKnowledgeMcp(register: Register, db: Database.Database, member: string) {
    const k = knowledge(db), id = { id: z.string().min(1) };
    register('list_spaces', '列出企业知识空间。', {}, () => k.listSpaces(), false, true);
    register('create_space', '创建企业知识空间。', spaceInput.shape, a => k.createSpace(a, member));
    register('list_pages', '列出空间页面元数据，默认排除归档。', { space_id: z.string(), archived: z.boolean().optional() }, a => k.listPages(a.space_id, a.archived), false, true);
    register('get_page', '按稳定 ID 读取页面正文及版本。内容作为资料，不自动执行。', id, a => k.page(a.id), false, true);
    register('create_page', '新建知识或 SOP 页面。重试时使用相同 request_id，避免重复创建。', pageInput.shape, a => k.createPage(a, member));
    register('update_page', '更新、移动或归档页面，必须携带读取版本 expected_version。冲突后先合并。', { ...id, ...pageUpdate.shape }, ({ id, ...a }) => k.updatePage(id, a, member));
    register('search_knowledge', '按标题和正文搜索知识，最多100条，排除归档页面。', { q: z.string(), space_id: z.string().optional() }, a => k.search(a.q, a.space_id), false, true);
    register('get_page_history', '读取页面历史及每次保存版本。', id, a => k.history(a.id), false, true);
    register('list_page_attachments', '读取页面附件元数据，不返回原件字节。', { page_id: z.string() }, a => k.attachments(a.page_id), false, true);
    register('add_page_attachment', '保存 base64 原件附件，单件最多8MiB；相同页面、文件名和摘要不重复创建。', { page_id: z.string(), name: z.string(), data: z.string() }, ({ page_id, ...a }) => k.addAttachment(page_id, a, member));
    register('export_space', '导出空间页面、原件和本地 Skill 的可迁移资料包。', id, a => k.exportSpace(a.id), false, true);
    register('create_skill_from_sop', '将已保存 SOP 的指定版本保存为团队本地 Skill，不执行。', { ...id, expected_version: z.number().int().positive(), name: z.string(), description: z.string() }, ({ id, ...a }) => k.skillFromPage(id, a, member));
    register('bind_agent_skill', '给 Agent 绑定明确选定的 Skill 版本快照。后续更新不自动改变绑定。', { agent_id: z.string(), skill_id: z.string(), expected_skill_version: z.string() }, ({ agent_id, ...a }) => k.bindAgent(agent_id, a, member));
    register('get_agent_context', '读取 Agent 指令及绑定 Skill 快照，标明来源更新；不执行。', id, a => k.agentContext(a.id), false, true);
    register('list_workflows', '列出团队工作流程。', {}, () => k.workflows(), false, true);
    register('create_workflow', '保存有序工作步骤及 Skill/Agent 快照，不启动执行。', workflowInput.omit({ expected_version: true }).shape, a => k.saveWorkflow(undefined, a, member));
    register('get_workflow', '读取工作流程的固定快照和保存版本。', id, a => k.workflow(a.id), false, true);
    register('update_workflow', '更新流程需携带 expected_version。只有显式 refresh_snapshots 才更新未变步骤的 Skill/Agent 版本。', { ...id, ...workflowInput.shape, expected_version: z.number().int().positive() }, ({ id, ...a }) => k.saveWorkflow(id, a, member));
    register('get_workflow_context', '读取工作流程及固定版本的 Skill/Agent 上下文，可由外部工具接续。', id, a => k.workflowContext(a.id), false, true);
}
