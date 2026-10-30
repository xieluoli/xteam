import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { parseDocument, isMap } from 'yaml';
import { ResourceError } from './resources.js';
import { bundleLimit, discoverSkillSource, downloadSkill, fetchSkillSource, fileLimit, validFilePath, type SkillFetch, type SkillFile } from './skill-source.js';
export type Skill = { id: string; name: string; description: string; content: string; source_url: string; source_type: string; created_at: string; created_by: string; updated_by: string; updated_at: string; created_by_email?: string; updated_by_email?: string; labels: string[]; files: SkillFile[] };
function frontmatter(content: string) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const document = parseDocument(match?.[1] ?? '{}');
    if (document.errors.length || !isMap(document.contents)) throw new ResourceError('SKILL.md frontmatter 必须为有效 YAML 对象');
    const data = document.toJS({ maxAliasCount: 20 }) as Record<string, unknown>;
    return { document, data, body: match ? content.slice(match[0].length) : content };
}
function contentFields(content: string, fallbackName: string, fallbackDescription = '') {
    if (Buffer.byteLength(content) > fileLimit) throw new ResourceError('单文件超过 1 MiB', 413);
    const { data } = frontmatter(content);
    const name = data.name ?? fallbackName;
    const description = data.description ?? fallbackDescription;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || typeof description !== 'string' || description.length > 50000) throw new ResourceError('名称或简介无效');
    return { name: name.trim(), description };
}
function setProperties(content: string, name: string, description: string) {
    const { document, body } = frontmatter(content);
    document.set('name', name); document.set('description', description);
    return `---\n${document.toString()}---\n${body}`;
}
export function skills(database: Database.Database, fetcher?: SkillFetch) {
    function get(id: string): Skill {
        const row = database.prepare(`SELECT skills.*, creator.email AS created_by_email, editor.email AS updated_by_email FROM skills LEFT JOIN users creator ON creator.id=skills.created_by LEFT JOIN users editor ON editor.id=skills.updated_by WHERE skills.id=?`).get(id) as (Omit<Skill, 'labels' | 'files'> & { labels: string }) | undefined;
        if (!row) throw new ResourceError('Skill 不存在或已删除', 404);
        return { ...row, labels: JSON.parse(row.labels), files: database.prepare('SELECT path,content FROM skill_files WHERE skill_id=? ORDER BY path').all(id) as SkillFile[] };
    }
    function list(query = '', label?: unknown) {
        if (label !== undefined && (typeof label !== 'string' || !label.trim() || label.length > 100)) throw new ResourceError('label 需为 1–100 个字符的标签');
        const values = label === undefined ? [query] : [query, (label as string).trim()];
        return (database.prepare(`SELECT skills.id,skills.name,skills.description,skills.source_url,skills.source_type,skills.created_at,skills.created_by,skills.updated_by,skills.updated_at,skills.labels,creator.email AS created_by_email,editor.email AS updated_by_email,(SELECT count(*) + 1 FROM skill_files WHERE skill_id=skills.id) AS file_count FROM skills LEFT JOIN users creator ON creator.id=skills.created_by LEFT JOIN users editor ON editor.id=skills.updated_by WHERE instr(lower(skills.name),lower(?))>0 ${label === undefined ? '' : 'AND EXISTS (SELECT 1 FROM json_each(skills.labels) WHERE json_each.value=?)'} ORDER BY skills.updated_at DESC,skills.id DESC`).all(...values) as (Record<string, unknown> & { labels: string })[]).map(row => ({ ...row, labels: JSON.parse(row.labels) }));
    }
    function persist(skill: Skill) {
        contentFields(skill.content, skill.name, skill.description);
        let total = Buffer.byteLength(skill.content);
        if (skill.files.length > 256) throw new ResourceError('最多 256 个附属文件', 413);
        for (const file of skill.files) { validFilePath(file.path); const size = Buffer.byteLength(file.content); if (size > fileLimit) throw new ResourceError('单文件超过 1 MiB', 413); total += size; }
        if (total > bundleLimit) throw new ResourceError('Skill 超过 8 MiB', 413);
        database.transaction(() => {
            database.prepare(`INSERT INTO skills (id,name,description,content,updated_at,source_url,source_type,created_at,created_by,updated_by,labels) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,content=excluded.content,updated_at=excluded.updated_at,source_url=excluded.source_url,source_type=excluded.source_type,updated_by=excluded.updated_by,labels=excluded.labels`).run(skill.id, skill.name, skill.description, skill.content, skill.updated_at, skill.source_url, skill.source_type, skill.created_at, skill.created_by, skill.updated_by, JSON.stringify(skill.labels));
            database.prepare('DELETE FROM skill_files WHERE skill_id=?').run(skill.id);
            for (const file of skill.files) database.prepare('INSERT INTO skill_files (skill_id,path,content) VALUES (?,?,?)').run(skill.id, file.path, file.content);
        })();
        return get(skill.id);
    }
    function sameName(name: string, except = '') { return database.prepare('SELECT id,name FROM skills WHERE name=? COLLATE NOCASE AND id<>? LIMIT 1').get(name, except) as { id: string; name: string } | undefined; }
    function update(id: string, input: Record<string, unknown>, member: string) {
        const skill = get(id);
        if (input.content !== undefined && typeof input.content !== 'string') throw new ResourceError('正文必须为文本');
        let content = input.content === undefined ? skill.content : input.content as string;
        const fields = contentFields(content, skill.name, skill.description);
        if (input.name !== undefined && typeof input.name !== 'string' || input.description !== undefined && typeof input.description !== 'string') throw new ResourceError('名称和简介必须为文本');
        if (input.name !== undefined) fields.name = (input.name as string).trim();
        if (input.description !== undefined) fields.description = input.description as string;
        if (!fields.name || fields.name.length > 200 || fields.description.length > 50000) throw new ResourceError('名称或简介无效');
        if (sameName(fields.name, id)) throw new ResourceError('已有同名 Skill', 409);
        if (input.content !== undefined || input.name !== undefined || input.description !== undefined) content = setProperties(content, fields.name, fields.description);
        let labels = skill.labels;
        if (input.labels !== undefined) {
            if (!Array.isArray(input.labels) || input.labels.length > 30 || input.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100)) throw new ResourceError('标签需为最多 30 个非空文本');
            labels = [...new Set(input.labels.map(label => label.trim()))];
        }
        return persist({ ...skill, ...fields, content, labels, updated_by: member, updated_at: new Date().toISOString() });
    }
    function importBundle(bundle: Awaited<ReturnType<typeof downloadSkill>>, strategy: unknown, member: string) {
        if (!['fail', 'overwrite', 'rename', 'skip'].includes(String(strategy))) throw new ResourceError('冲突选项无效');
        const fields = contentFields(bundle.content, bundle.fallbackName);
        bundle.content = setProperties(bundle.content, fields.name, fields.description);
        const existing = sameName(fields.name);
        if (existing && (strategy === 'fail' || strategy === 'skip')) return { status: strategy === 'skip' ? 'skipped' : 'conflict', existing_skill: existing, reason: '已有同名 Skill，请明确选择覆盖、重命名或跳过' };
        if (existing && strategy === 'rename') { const base = fields.name; let suffix = 2; while (sameName(fields.name)) fields.name = `${base.slice(0, 190)}-${suffix++}`; bundle.content = setProperties(bundle.content, fields.name, fields.description); }
        const old = existing && strategy === 'overwrite' ? get(existing.id) : undefined;
        const now = new Date().toISOString();
        const skill = persist({ id: old?.id ?? randomUUID(), ...fields, ...bundle, labels: old?.labels ?? [], created_at: old?.created_at ?? now, created_by: old?.created_by ?? member, updated_by: member, updated_at: now });
        return { status: old ? 'updated' : 'created', skill };
    }
    async function importUrl(input: Record<string, unknown>, member: string) {
        if (typeof input?.url !== 'string') throw new ResourceError('请填写 Skill URL');
        if (!['fail', 'skip', 'rename', 'overwrite'].includes(String(input.on_conflict ?? 'fail'))) throw new ResourceError('冲突选项无效');
        return importBundle(await downloadSkill(input.url, fetcher), input.on_conflict ?? 'fail', member);
    }
    async function discover(input: Record<string, unknown>) {
        if (typeof input?.url !== 'string') throw new ResourceError('请填写 Skill URL');
        const source = await discoverSkillSource(input.url, fetcher);
        return { sha: source.sha, ref: source.ref, candidates: source.candidates.map(candidate => {
            const fields = contentFields(candidate.content, candidate.fallbackName);
            return { path: candidate.path, ...fields, existing_skill: sameName(fields.name) };
        }) };
    }
    async function importMany(input: Record<string, unknown>, member: string) {
        if (typeof input?.url !== 'string' || typeof input.sha !== 'string' || !/^[a-f0-9]{40}$/.test(input.sha) || !Array.isArray(input.items) || !input.items.length || input.items.length > 20) throw new ResourceError('请先读取来源并选择 1–20 个 Skill');
        const items = input.items as { path: string; on_conflict?: string }[];
        if (items.some(item => !item || typeof item.path !== 'string' || item.path.length > 1000 || item.path && item.path.split('/').some(part => !part || part.startsWith('.') || /[\\\x00-\x20]/.test(part)) || !['fail', 'skip', 'rename', 'overwrite'].includes(item.on_conflict ?? 'fail')) || new Set(items.map(item => item.path)).size !== items.length) throw new ResourceError('选择的目录或冲突选项无效，不能重复选择');
        // One request shares immutable tree/blob responses; no background import queue is needed.
        const cache = new Map<string, Promise<Buffer>>();
        const cached: SkillFetch = url => { if (!cache.has(url)) cache.set(url, (fetcher ?? fetchSkillSource)(url)); return cache.get(url)!; };
        let total = 0;
        const results = [];
        for (const item of items) {
            try {
                if (total > 32 * fileLimit) throw new ResourceError('本批文本超过 32 MiB，请拆分导入', 413);
                const bundle = await downloadSkill(input.url, cached, { sha: input.sha, path: item.path });
                total += Buffer.byteLength(bundle.content) + bundle.files.reduce((size, file) => size + Buffer.byteLength(file.content), 0);
                if (total > 32 * fileLimit) throw new ResourceError('本批文本超过 32 MiB，请拆分导入', 413);
                const result = importBundle(bundle, item.on_conflict ?? 'fail', member);
                results.push({ path: item.path, status: result.status, skill: result.skill ? { id: result.skill.id, name: result.skill.name } : undefined, existing_skill: result.existing_skill, error: result.reason });
            } catch (error) { results.push({ path: item.path, status: 'failed', error: (error as Error).message }); }
        }
        return { sha: input.sha, results };
    }
    async function refresh(id: string, member: string) {
        const original = get(id);
        if (!original.source_url) throw new ResourceError('此 Skill 没有可更新的 URL 来源，请重新导入', 422);
        const bundle = await downloadSkill(original.source_url, fetcher);
        const fields = contentFields(bundle.content, bundle.fallbackName);
        bundle.content = setProperties(bundle.content, fields.name, fields.description);
        const current = get(id);
        if (JSON.stringify(current) !== JSON.stringify(original)) throw new ResourceError('Skill 在下载期间已修改，请重新确认后更新', 409);
        if (sameName(fields.name, id)) throw new ResourceError('上游名称与已有 Skill 冲突，未更新', 409);
        return persist({ ...current, ...fields, ...bundle, updated_at: new Date().toISOString(), updated_by: member });
    }
    function file(id: string, path: string, content: unknown, member: string, remove = false) {
        validFilePath(path);
        if (!remove && typeof content !== 'string') throw new ResourceError('文件内容必须为文本');
        const skill = get(id);
        const files = skill.files.filter(file => file.path !== path);
        if (!remove) files.push({ path, content: content as string });
        return persist({ ...skill, files, updated_at: new Date().toISOString(), updated_by: member });
    }
    function remove(id: string) { get(id); database.transaction(() => { database.prepare('DELETE FROM skill_files WHERE skill_id=?').run(id); database.prepare('DELETE FROM skills WHERE id=?').run(id); })(); return { ok: true }; }
    return { get, list, update, importUrl, discover, importMany, refresh, file, remove };
}
