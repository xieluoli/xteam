import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ResourceError, resources } from './resources.js';
import { skills, type Skill } from './skills.js';

const title = z.string().trim().min(1).max(200);
const text = z.string().max(50000);
const version = z.number().int().positive();
export const spaceInput = z.object({ name: title, description: text.default('') }).strict();
export const pageInput = z.object({ space_id: z.string().min(1), parent_id: z.string().min(1).nullable().default(null), title, content: z.string().max(500000).default(''), kind: z.enum(['document', 'sop']).default('document'), request_id: z.string().min(1).max(100).optional() }).strict();
export const pageUpdate = z.object({ title: title.optional(), content: z.string().max(500000).optional(), parent_id: z.string().min(1).nullable().optional(), kind: z.enum(['document', 'sop']).optional(), archived: z.boolean().optional(), expected_version: version }).strict();
export const workflowInput = z.object({ name: title, description: text.default(''), steps: z.array(z.object({ title, skill_id: z.string().min(1), agent_id: z.string().min(1).optional() }).strict()).min(1).max(30), expected_version: version.optional(), refresh_snapshots: z.boolean().optional() }).strict();
export type Space = z.infer<typeof spaceInput> & { id: string; created_at: string; updated_at: string; created_by: string };
export type Page = { id: string; space_id: string; parent_id: string | null; title: string; content: string; kind: 'document' | 'sop'; archived: boolean; version: number; created_at: string; updated_at: string; updated_by: string };
export type SkillSnapshot = Pick<Skill, 'id' | 'name' | 'description' | 'content' | 'labels' | 'files' | 'updated_at'>;
type Step = { title: string; skill: SkillSnapshot; agent?: { id: string; name: string; content: string; updated_at: string } };
type Workflow = { id: string; name: string; description: string; steps: Step[]; version: number; updated_at: string; updated_by: string };
type Attachment = { id: string; page_id: string; name: string; media_type: string; size: number; sha256: string; created_at: string };
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new ResourceError(result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('；'));
    return result.data;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const snapshot = (s: Skill): SkillSnapshot => ({ id: s.id, name: s.name, description: s.description, content: s.content, labels: s.labels, files: s.files, updated_at: s.updated_at });

export function knowledge(db: Database.Database) {
    const skillService = skills(db);
    function space(id: string): Space {
        const row = db.prepare('SELECT * FROM knowledge_spaces WHERE id=?').get(id) as Space | undefined;
        if (!row) throw new ResourceError('知识空间不存在', 404);
        return row;
    }
    function listSpaces() { return db.prepare('SELECT * FROM knowledge_spaces ORDER BY updated_at DESC,id').all() as Space[]; }
    function createSpace(input: unknown, member: string): Space {
        const data = parse(spaceInput, input);
        const id = randomUUID(), now = new Date().toISOString();
        db.prepare('INSERT INTO knowledge_spaces VALUES (?,?,?,?,?,?)').run(id, data.name, data.description, now, now, member);
        return space(id);
    }
    function page(id: string): Page {
        const row = db.prepare('SELECT * FROM knowledge_pages WHERE id=?').get(id) as (Omit<Page, 'archived'> & { archived: number }) | undefined;
        if (!row) throw new ResourceError('页面不存在', 404);
        return { ...row, archived: !!row.archived };
    }
    function listPages(spaceId: string, archived = false) {
        space(spaceId);
        return (db.prepare('SELECT id,space_id,parent_id,title,kind,archived,version,updated_at FROM knowledge_pages WHERE space_id=? AND archived=? ORDER BY title,id').all(spaceId, Number(archived)) as Record<string, unknown>[]).map(p => ({ ...p, archived: !!p.archived }));
    }
    function validateParent(parentId: string | null, spaceId: string, id?: string) {
        const seen = new Set<string>(id ? [id] : []);
        while (parentId) {
            if (seen.has(parentId)) throw new ResourceError('页面目录不能形成循环');
            seen.add(parentId);
            const parent = page(parentId);
            if (parent.space_id !== spaceId) throw new ResourceError('父页面必须位于同一空间');
            if (parent.archived) throw new ResourceError('父页面已归档，请先恢复父页面');
            parentId = parent.parent_id;
        }
    }
    function persistPage(value: Page) {
        db.prepare(`INSERT INTO knowledge_pages (id,space_id,parent_id,title,content,kind,archived,version,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,content=excluded.content,kind=excluded.kind,archived=excluded.archived,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(value.id, value.space_id, value.parent_id, value.title, value.content, value.kind, Number(value.archived), value.version, value.created_at, value.updated_at, value.updated_by);
        db.prepare('INSERT INTO knowledge_revisions VALUES (?,?,?)').run(value.id, value.version, JSON.stringify(value));
        db.prepare('UPDATE knowledge_spaces SET updated_at=? WHERE id=?').run(value.updated_at, value.space_id);
        return value;
    }
    function createPage(input: unknown, member: string): Page {
        const data = parse(pageInput, input);
        return db.transaction(() => {
            space(data.space_id);
            const fingerprint = hash(JSON.stringify({ ...data, request_id: undefined }));
            if (data.request_id) {
                const old = db.prepare('SELECT fingerprint,page_id FROM knowledge_requests WHERE member=? AND request_id=?').get(member, data.request_id) as { fingerprint: string; page_id: string } | undefined;
                if (old) {
                    if (old.fingerprint !== fingerprint) throw new ResourceError('重复请求的内容不同，请使用新的 request_id', 409);
                    return page(old.page_id);
                }
            }
            validateParent(data.parent_id, data.space_id);
            const now = new Date().toISOString();
            const value = persistPage({ id: randomUUID(), space_id: data.space_id, parent_id: data.parent_id, title: data.title, content: data.content, kind: data.kind, archived: false, version: 1, created_at: now, updated_at: now, updated_by: member });
            if (data.request_id) db.prepare('INSERT INTO knowledge_requests VALUES (?,?,?,?)').run(member, data.request_id, fingerprint, value.id);
            return value;
        }).immediate();
    }
    function updatePage(id: string, input: unknown, member: string): Page {
        const data = parse(pageUpdate, input);
        return db.transaction(() => {
            const old = page(id);
            if (old.version !== data.expected_version) throw new ResourceError(`版本冲突，请读取最新页面后合并；当前版本 ${old.version}`, 409);
            const { expected_version, ...fields } = data;
            const next = { ...old, ...fields, version: old.version + 1, updated_at: new Date().toISOString(), updated_by: member };
            if (!next.archived) validateParent(next.parent_id, next.space_id, id);
            if (next.archived && db.prepare('SELECT id FROM knowledge_pages WHERE parent_id=? AND archived=0 LIMIT 1').get(id)) throw new ResourceError('请先移动或归档子页面', 409);
            return persistPage(next);
        }).immediate();
    }
    function history(id: string): Page[] { page(id); return (db.prepare('SELECT snapshot FROM knowledge_revisions WHERE page_id=? ORDER BY version DESC').all(id) as { snapshot: string }[]).map(r => JSON.parse(r.snapshot)); }
    function search(query: string, spaceId?: string) {
        if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new ResourceError('搜索词需为 1–200 个字符');
        if (spaceId) space(spaceId);
        return db.prepare(`SELECT id,space_id,parent_id,title,kind,version,updated_at,substr(content,1,240) AS excerpt FROM knowledge_pages WHERE archived=0 AND (instr(lower(title),lower(?))>0 OR instr(lower(content),lower(?))>0) ${spaceId ? 'AND space_id=?' : ''} ORDER BY updated_at DESC,id LIMIT 100`).all(query.trim(), query.trim(), ...(spaceId ? [spaceId] : [])) as { id: string; space_id: string; title: string; excerpt: string }[];
    }
    function breadcrumbs(id: string) {
        const result = [page(id)];
        const seen = new Set([id]);
        while (result[0].parent_id) {
            const parent = page(result[0].parent_id);
            if (seen.has(parent.id)) throw new ResourceError('页面目录存在循环', 409);
            seen.add(parent.id); result.unshift(parent);
        }
        return result.map(p => ({ id: p.id, title: p.title }));
    }
    function attachments(pageId: string): Attachment[] { page(pageId); return db.prepare('SELECT id,page_id,name,media_type,size,sha256,created_at FROM knowledge_attachments WHERE page_id=? ORDER BY created_at,id').all(pageId) as Attachment[]; }
    function attachment(id: string): Attachment & { bytes: Buffer } {
        const a = db.prepare('SELECT id,page_id,name,media_type,size,sha256,created_at,bytes FROM knowledge_attachments WHERE id=?').get(id) as Attachment & { bytes: Buffer } | undefined;
        if (!a) throw new ResourceError('附件不存在', 404);
        page(a.page_id); return a;
    }
    function addAttachment(pageId: string, input: unknown, member: string): Attachment {
        const data = parse(z.object({ name: title.refine(n => !/[\\/\x00-\x1f]/.test(n) && n !== '.' && n !== '..', '附件文件名无效'), data: z.string().max(12 * 1024 * 1024) }).strict(), input);
        const bytes = Buffer.from(data.data, 'base64');
        if (!data.data || bytes.toString('base64') !== data.data) throw new ResourceError('附件需为有效 base64 原件');
        if (bytes.length > 8 * 1024 * 1024) throw new ResourceError('附件不能超过 8 MiB', 413);
        const sha = hash(bytes);
        return db.transaction(() => {
            if (page(pageId).archived) throw new ResourceError('页面已归档，请先恢复', 409);
            const old = attachments(pageId).find(a => a.name === data.name && a.sha256 === sha);
            if (old) return old;
            let type = 'application/octet-stream';
            if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) type = 'image/png';
            else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'image/jpeg';
            else if (['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())) type = 'image/gif';
            else if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') type = 'image/webp';
            else if (bytes.subarray(0,5).toString() === '%PDF-') type = 'application/pdf';
            const id = randomUUID(), now = new Date().toISOString();
            db.prepare('INSERT INTO knowledge_attachments VALUES (?,?,?,?,?,?,?,?,?)').run(id, pageId, data.name, type, bytes.length, sha, bytes, now, member);
            const { bytes: _, ...meta } = attachment(id); return meta;
        }).immediate();
    }
    function skillFromPage(id: string, input: unknown, member: string) {
        const data = parse(z.object({ expected_version: version, name: title, description: text }).strict(), input);
        return db.transaction(() => {
            const p = page(id);
            if (p.version !== data.expected_version) throw new ResourceError('页面版本冲突，请读取最新 SOP', 409);
            if (p.kind !== 'sop' || p.archived) throw new ResourceError('请先保存为未归档的 SOP 页面');
            if (!p.content.trim()) throw new ResourceError('SOP 正文不能为空');
            const skill = skillService.createLocal({ name: data.name, description: data.description, content: p.content }, member);
            db.prepare('INSERT INTO knowledge_skill_sources VALUES (?,?,?)').run(skill.id, p.id, p.version);
            return skill;
        }).immediate();
    }
    function bindAgent(agentId: string, input: unknown, _member: string) {
        const data = parse(z.object({ skill_id: z.string().min(1), expected_skill_version: z.string().min(1) }).strict(), input);
        return db.transaction(() => {
            resources(db).get('agents', agentId);
            const s = skillService.get(data.skill_id);
            if (s.updated_at !== data.expected_skill_version) throw new ResourceError('Skill 版本冲突，请读取最新 Skill 后明确绑定', 409);
            db.prepare('INSERT INTO agent_skill_bindings VALUES (?,?,?,?) ON CONFLICT(agent_id,skill_id) DO UPDATE SET snapshot=excluded.snapshot,created_at=excluded.created_at').run(agentId, s.id, JSON.stringify(snapshot(s)), new Date().toISOString());
            return agentContext(agentId);
        }).immediate();
    }
    function updateAvailable(s: SkillSnapshot) {
        const current = db.prepare('SELECT updated_at FROM skills WHERE id=?').get(s.id) as { updated_at: string } | undefined;
        return { ...s, update_available: current ? current.updated_at !== s.updated_at : false, source_deleted: !current };
    }
    function agentContext(agentId: string) {
        const a = resources(db).get('agents', agentId);
        const bindings = db.prepare('SELECT snapshot FROM agent_skill_bindings WHERE agent_id=? ORDER BY skill_id').all(agentId) as { snapshot: string }[];
        return { schema_version: 1, execution_supported: false, agent: a, skills: bindings.map(b => updateAvailable(JSON.parse(b.snapshot))) };
    }
    function workflow(id: string): Workflow {
        const row = db.prepare('SELECT * FROM knowledge_workflows WHERE id=?').get(id) as Omit<Workflow, 'steps'> & { steps: string } | undefined;
        if (!row) throw new ResourceError('工作流程不存在', 404);
        return { ...row, steps: JSON.parse(row.steps) };
    }
    function workflows() { return db.prepare('SELECT id,name,description,version,updated_at FROM knowledge_workflows ORDER BY updated_at DESC,id').all(); }
    function saveWorkflow(id: string | undefined, input: unknown, member: string): Workflow {
        const data = parse(workflowInput, input);
        return db.transaction(() => {
            const old = id ? workflow(id) : undefined;
            if (old && data.expected_version !== old.version) throw new ResourceError('工作流程版本冲突，请先读取最新版本', 409);
            const steps: Step[] = data.steps.map((s, index) => {
                const previous = old?.steps[index];
                if (!data.refresh_snapshots && previous && previous.skill.id === s.skill_id && previous.agent?.id === s.agent_id) return { ...previous, title: s.title };
                const a = s.agent_id ? resources(db).get('agents', s.agent_id) : undefined;
                return { title: s.title, skill: snapshot(skillService.get(s.skill_id)), ...(a ? { agent: { id: a.id, name: String(a.name), content: String(a.content), updated_at: String(a.updated_at) } } : {}) };
            });
            const value: Workflow = { id: id ?? randomUUID(), name: data.name, description: data.description, steps, version: (old?.version ?? 0) + 1, updated_at: new Date().toISOString(), updated_by: member };
            db.prepare('INSERT INTO knowledge_workflows VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,steps=excluded.steps,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(value.id, value.name, value.description, JSON.stringify(value.steps), value.version, value.updated_at, member);
            return value;
        }).immediate();
    }
    function workflowContext(id: string) {
        const w = workflow(id);
        return { schema_version: 1, execution_supported: false, workflow: { id: w.id, name: w.name, description: w.description, version: w.version }, steps: w.steps.map(s => ({ ...s, skill: updateAvailable(s.skill) })) };
    }
    function exportSpace(id: string) {
        return db.transaction(() => {
            const s = space(id);
            const allPages = (db.prepare('SELECT id FROM knowledge_pages WHERE space_id=? ORDER BY id').all(id) as { id: string }[]).map(p => page(p.id));
            const sources = db.prepare('SELECT knowledge_skill_sources.* FROM knowledge_skill_sources JOIN knowledge_pages ON knowledge_pages.id=knowledge_skill_sources.page_id WHERE knowledge_pages.space_id=? ORDER BY skill_id').all(id) as { skill_id: string; page_id: string; page_version: number }[];
            const relatedSkills = new Set(sources.map(s => s.skill_id));
            const relatedFlows = (workflows() as { id: string }[]).map(w => workflow(w.id)).filter(w => w.steps.some(step => relatedSkills.has(step.skill.id))).map(w => workflowContext(w.id));
            const relatedAgents = (db.prepare('SELECT DISTINCT agent_id FROM agent_skill_bindings').all() as { agent_id: string }[]).flatMap(a => { try { const ctx = agentContext(a.agent_id); const selected = ctx.skills.filter(s => relatedSkills.has(s.id)); return selected.length ? [{ ...ctx, skills: selected }] : []; } catch { return []; } });
            return { schema_version: 1, exported_at: new Date().toISOString(), space: { id: s.id, name: s.name, description: s.description }, pages: allPages.map(({ updated_by, ...p }) => p), revisions: allPages.flatMap(p => history(p.id).map(({ updated_by, ...revision }) => revision)), attachments: allPages.flatMap(p => attachments(p.id).map(a => ({ ...a, data: attachment(a.id).bytes.toString('base64') }))), skills: sources.flatMap(source => { try { return [{ ...snapshot(skillService.get(source.skill_id)), source_page_id: source.page_id, source_page_version: source.page_version }]; } catch { return []; } }), workflows: relatedFlows, agent_contexts: relatedAgents };
        })();
    }
    return { space, listSpaces, createSpace, page, listPages, createPage, updatePage, history, search, breadcrumbs, attachments, attachment, addAttachment, skillFromPage, bindAgent, agentContext, workflow, workflows, saveWorkflow, workflowContext, exportSpace };
}
