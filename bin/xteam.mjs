#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rename, access, rm } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const help = `XTeam CLI — 知识、SOP、Skill 与工作流程

认证：XTEAM_URL 指向实例，XTEAM_TOKEN 提供个人令牌（与 MCP 相同）。
  xteam auth login [--url https://your-xteam] [--token-stdin]
  xteam auth status
  xteam space list | space create --name 名称 [--description 简介]
  xteam page list --space ID [--archived]
  xteam page get ID [--format markdown]
  xteam page create --space ID --title 标题 --file SOP.md [--kind sop] [--parent ID]
  xteam page update ID --file SOP.md --expected-version N
  xteam page archive|restore ID --expected-version N --yes
  xteam page history ID
  xteam search 关键词 [--space ID]
  xteam attachment list --page ID
  xteam attachment upload ./research.pdf --page ID
  xteam attachment download ID --output ./original.pdf
  xteam skill from-page ID --expected-version N --name review --description 使用条件
  xteam skill get ID | skill export ID --output ./review-skill
  xteam agent list | agent create --name 名称 --file instructions.md
  xteam agent bind ID --skill ID --skill-version VERSION
  xteam agent context ID
  xteam workflow list | workflow get ID | workflow context ID
  xteam workflow create --file workflow.json
  xteam workflow update ID --file workflow.json --expected-version N
  xteam export --space ID --output ./wiki-export

通用：--json 结构化输出；--file - 读取标准输入；--request-id KEY 用于新建页面重试。
退出码：0 成功；2 认证；3 权限；4 冲突；5 输入；6 网络；1 其他错误。
导出目录必须不存在；令牌不会保存到配置。流程上下文为固定快照，不自动执行。`;
const strings = ['url','name','description','space','page','title','file','kind','parent','format','expected-version','skill','skill-version','output','request-id'];
const bools = ['json','help','archived','yes','token-stdin','no-input'];
let json = process.argv.includes('--json');
class CliError extends Error { constructor(message, exitCode = 5, code = 'input') { super(message); this.exitCode = exitCode; this.code = code; } }
const required = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new CliError(`需要 ${label}；运行 xteam --help 查看用法`); return value; };
const safeId = id => { if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CliError('导出包含不安全的资源 ID'); return id; };
async function stdin() { const chunks = []; for await (const c of process.stdin) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); }
async function source(file) { required(file, '--file'); return file === '-' ? stdin() : readFile(file, 'utf8'); }
function numberVersion(value) { const n = Number(required(value, '--expected-version')); if (!Number.isSafeInteger(n) || n < 1) throw new CliError('版本必须为正整数'); return n; }
function print(data, format) { process.stdout.write(format === 'markdown' ? String(data.content) + '\n' : JSON.stringify(json ? { schema_version: 1, data } : data, null, json ? undefined : 2) + '\n'); }
async function main() {
    const { values: v, positionals: p } = parseArgs({ allowPositionals: true, options: Object.fromEntries([...strings.map(k => [k, { type: 'string' }]), ...bools.map(k => [k, { type: 'boolean' }])]) });
    json = !!v.json;
    if (v.help || !p.length) { process.stdout.write(help + '\n'); return; }
    const configPath = process.env.XTEAM_CONFIG || join(homedir(), '.config', 'xteam', 'config.json');
    let config = {};
    try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new CliError('无法读取 CLI 实例配置'); }
    let token = process.env.XTEAM_TOKEN || '';
    if (p[0] === 'auth' && p[1] === 'login' && v['token-stdin']) {
        if (v['no-input']) throw new CliError('--token-stdin 与 --no-input 不能一起使用');
        token = (await stdin()).trim();
    }
    if (!token) throw new CliError('请通过 XTEAM_TOKEN 提供个人令牌，或 auth login --token-stdin 验证认证', 2, 'authentication');
    let url;
    try { url = new URL(required(v.url || process.env.XTEAM_URL || config.url, 'XTEAM_URL 或 --url')); } catch { throw new CliError('实例地址无效'); }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new CliError('实例必须使用 HTTPS（本机回环开发地址除外），地址不能包含凭据或参数');
    const base = url.href.replace(/\/$/, '');
    async function request(path, method = 'GET', body, binary = false) {
        let r;
        try { r = await fetch(base + '/api' + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
        catch { throw new CliError('网络请求未完成；写入结果可能不确定，请读取最新对象核对后再重试', 6, 'network'); }
        if (!r.ok) {
            let data = {}; try { data = await r.json(); } catch {}
            const mapping = { 401: [2,'authentication'], 403: [3,'permission'], 409: [4,'conflict'], 400: [5,'input'], 404: [5,'not_found'], 413: [5,'input'], 422: [5,'input'] };
            const [exitCode, code] = mapping[r.status] || [1,'server'];
            throw new CliError(data.error || `请求失败 HTTP ${r.status}`, exitCode, code);
        }
        return binary ? Buffer.from(await r.arrayBuffer()) : r.json();
    }
    const id = () => encodeURIComponent(required(p[2], '资源 ID'));
    const expected = () => numberVersion(v['expected-version']);
    if (p[0] === 'auth' && ['login','status'].includes(p[1])) {
        const me = await request('/me');
        if (p[1] === 'login') { await mkdir(dirname(configPath), { recursive: true }); await writeFile(configPath, JSON.stringify({ url: base }) + '\n', { mode: 0o600 }); }
        print({ user: me.user, url: base, token_persisted: false }); return;
    }
    if (p[0] === 'space' && p[1] === 'list') return print(await request('/wiki/spaces'));
    if (p[0] === 'space' && p[1] === 'create') return print(await request('/wiki/spaces', 'POST', { name: required(v.name, '--name'), description: v.description || '' }));
    if (p[0] === 'page') {
        if (p[1] === 'list') return print(await request(`/wiki/spaces/${encodeURIComponent(required(v.space, '--space'))}/pages?archived=${!!v.archived}`));
        if (p[1] === 'get') { if (v.format && v.format !== 'markdown') throw new CliError('--format 仅支持 markdown'); return print(await request('/wiki/pages/' + id()), v.format); }
        if (p[1] === 'history') return print(await request('/wiki/pages/' + id() + '/history'));
        if (p[1] === 'create') return print(await request('/wiki/pages', 'POST', { space_id: required(v.space, '--space'), title: required(v.title, '--title'), content: await source(v.file), kind: v.kind || 'document', parent_id: v.parent || null, request_id: v['request-id'] || randomUUID() }));
        if (p[1] === 'update') return print(await request('/wiki/pages/' + id(), 'PATCH', { content: await source(v.file), expected_version: expected(), ...(v.title ? { title: v.title } : {}), ...(v.parent ? { parent_id: v.parent } : {}) }));
        if (['archive','restore'].includes(p[1])) { if (!v.yes) throw new CliError('归档或恢复需要显式 --yes；不会等待交互输入'); return print(await request('/wiki/pages/' + id(), 'PATCH', { archived: p[1] === 'archive', expected_version: expected() })); }
    }
    if (p[0] === 'search') return print(await request('/wiki/search?q=' + encodeURIComponent(required(p[1], '关键词')) + (v.space ? '&space_id=' + encodeURIComponent(v.space) : '')));
    if (p[0] === 'attachment') {
        if (p[1] === 'list') return print(await request('/wiki/pages/' + encodeURIComponent(required(v.page, '--page')) + '/attachments'));
        if (p[1] === 'upload') { const file = required(p[2], '文件路径'); return print(await request('/wiki/pages/' + encodeURIComponent(required(v.page, '--page')) + '/attachments', 'POST', { name: basename(file), data: (await readFile(file)).toString('base64') })); }
        if (p[1] === 'download') { const output = required(v.output, '--output'); const bytes = await request('/wiki/attachments/' + id() + '/download', 'GET', undefined, true); await writeFile(output, bytes, { flag: 'wx' }); return print({ output, bytes: bytes.length }); }
    }
    if (p[0] === 'skill' && p[1] === 'from-page') return print(await request('/wiki/pages/' + id() + '/skill', 'POST', { name: required(v.name, '--name'), description: required(v.description, '--description'), expected_version: expected() }));
    if (p[0] === 'skill' && p[1] === 'get') return print(await request('/skills/' + id()));
    if (p[0] === 'agent') {
        if (p[1] === 'list') return print(await request('/agents'));
        if (p[1] === 'create') return print(await request('/agents', 'POST', { name: required(v.name, '--name'), description: v.description || '', content: await source(v.file) }));
        if (p[1] === 'context') return print(await request('/wiki/agents/' + id() + '/context'));
        if (p[1] === 'bind') return print(await request('/wiki/agents/' + id() + '/skills', 'POST', { skill_id: required(v.skill, '--skill'), expected_skill_version: required(v['skill-version'], '--skill-version') }));
    }
    if (p[0] === 'workflow') {
        if (p[1] === 'list') return print(await request('/wiki/workflows'));
        if (p[1] === 'get' || p[1] === 'context') return print(await request('/wiki/workflows/' + id() + (p[1] === 'context' ? '/context' : '')));
        if (p[1] === 'create' || p[1] === 'update') {
            let data; try { data = JSON.parse(await source(v.file)); } catch { throw new CliError('工作流程文件必须为有效 JSON'); }
            return print(await request('/wiki/workflows' + (p[1] === 'update' ? '/' + id() : ''), p[1] === 'update' ? 'PUT' : 'POST', { ...data, ...(p[1] === 'update' ? { expected_version: expected() } : {}) }));
        }
    }
    if (p[0] === 'export' || (p[0] === 'skill' && p[1] === 'export')) {
        const output = resolve(required(v.output, '--output'));
        try { await access(output); throw new CliError('导出目录已存在，请使用新目录，避免覆盖原文件'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const data = p[0] === 'export' ? await request('/wiki/spaces/' + encodeURIComponent(required(v.space, '--space')) + '/export') : await request('/skills/' + id());
        await mkdir(dirname(output), { recursive: true });
        const staging = await mkdtemp(join(dirname(output), '.xteam-export-'));
        const file = async (path, content) => { const target = join(staging, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, { flag: 'wx' }); };
        const skillFiles = async (skill, prefix = '') => {
            await file(join(prefix, 'SKILL.md'), skill.content);
            for (const f of skill.files) {
                if (f.path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00]/.test(f.path) || f.path.startsWith('/')) throw new CliError('Skill 包含不安全的文件路径');
                await file(join(prefix, f.path), f.content);
            }
        };
        try {
            if (p[0] === 'export') {
                for (const page of data.pages) {
                    const markdown = page.content.replace(/(?:\/api\/wiki\/attachments\/)([a-zA-Z0-9_-]+)\/download/g, (url, aId) => { const a = data.attachments.find(a => a.id === aId); return a ? `../attachments/${safeId(a.id)}/${encodeURIComponent(a.name)}` : url; }).replace(/#page\/([a-zA-Z0-9_-]+)/g, './$1.md');
                    await file('pages/' + safeId(page.id) + '.md', '# ' + page.title + '\n\n' + markdown);
                }
                for (const a of data.attachments) { if (basename(a.name) !== a.name || a.name === '.' || a.name === '..') throw new CliError('附件文件名无效'); await file('attachments/' + safeId(a.id) + '/' + a.name, Buffer.from(a.data, 'base64')); }
                for (const skill of data.skills) await skillFiles(skill, 'skills/' + safeId(skill.id));
                await file('manifest.json', JSON.stringify(data, null, 2));
            } else { await skillFiles(data); await file('source.json', JSON.stringify({ id: data.id, name: data.name, source_url: data.source_url, version: data.updated_at }, null, 2)); }
            await rename(staging, output);
        } catch (e) { await rm(staging, { recursive: true, force: true }); throw e; }
        return print({ output, ...(data.pages ? { pages: data.pages.length, attachments: data.attachments.length, skills: data.skills.length } : { skill: data.name }) });
    }
    throw new CliError('未知命令；运行 xteam --help 查看用法');
}
main().catch(e => { const safe = { code: e.code && typeof e.code === 'string' ? e.code : 'error', message: e.message || '命令失败' }; process.stderr.write((json ? JSON.stringify({ schema_version: 1, error: safe }) : safe.message) + '\n'); process.exitCode = e.exitCode || 1; });
