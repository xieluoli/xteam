import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { BookOpen, FileText, Plus, Search, Download, Workflow, Paperclip } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { AppDialog, Choice, FieldLabel as Label, useConfirmation } from './components/app-ui';
import type { Page, Space } from '../server/knowledge';
import './knowledge.css';

type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type Summary = Pick<Page, 'id' | 'title' | 'space_id' | 'parent_id' | 'kind' | 'version' | 'archived'>;
type Dialog = 'space' | 'page' | 'skill' | 'workflow' | 'agent' | null;
function download(name: string, data: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function Knowledge({ api, route, onDirty }: { api: Api; route: string; onDirty: (dirty: boolean) => void }) {
    const confirm = useConfirmation();
    const [spaces, setSpaces] = useState<Space[]>([]);
    const [spaceId, setSpaceId] = useState('');
    const [pages, setPages] = useState<Summary[]>([]);
    const [current, setCurrent] = useState<Page | null>(null);
    const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; title: string }[]>([]);
    const [draft, setDraft] = useState({ title: '', content: '' });
    const [editing, setEditing] = useState(false);
    const [history, setHistory] = useState<Page[] | null>(null);
    const [latest, setLatest] = useState<Page | null>(null);
    const [attachments, setAttachments] = useState<any[]>([]);
    const [archived, setArchived] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[] | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [kind, setKind] = useState('document');
    const [parentId, setParentId] = useState('');
    const [allSkills, setAllSkills] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);
    const [flows, setFlows] = useState<any[]>([]);
    const [flow, setFlow] = useState<any>(null);
    const [steps, setSteps] = useState<{ title: string; skill_id: string; agent_id?: string }[]>([]);
    const [selectedSkill, setSelectedSkill] = useState('');
    const [selectedAgent, setSelectedAgent] = useState('');
    const read = useRef(0);
    const pageRequest = useRef(crypto.randomUUID());
    useEffect(() => { if (dialog === 'page') pageRequest.current = crypto.randomUUID(); }, [dialog]);
    const dirty = !!(editing && current && (draft.title !== current.title || draft.content !== current.content));
    const flowMode = route.startsWith('#workflow');
    useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
    useEffect(() => () => onDirty(false), [onDirty]);
    async function catalogs() { const [s, a, w] = await Promise.all([api('/skills'), api('/agents'), api('/wiki/workflows')]); setAllSkills(s); setAgents(a); setFlows(w); }
    useEffect(() => { let active = true; api('/wiki/spaces').then(s => { if (active) { setSpaces(s); setSpaceId(old => old || s[0]?.id || ''); } }).catch(e => { if (active) setError(e.message); }); void catalogs().catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
    useEffect(() => {
        let active = true;
        if (!spaceId) { setPages([]); return; }
        api(`/wiki/spaces/${spaceId}/pages?archived=${archived}`).then(p => { if (active) setPages(p); }).catch(e => { if (active) setError(e.message); });
        return () => { active = false; };
    }, [spaceId, archived]);
    useEffect(() => {
        const request = ++read.current;
        setError(''); setNotice(''); setEditing(false); setHistory(null); setLatest(null); setCurrent(null); setFlow(null); setAttachments([]); setBreadcrumbs([]); setLoading(false);
        if (route.startsWith('#space/')) setSpaceId(route.slice(7));
        if (route.startsWith('#page/')) {
            const id = route.slice(6); setLoading(true);
            Promise.all([api('/wiki/pages/' + id), api('/wiki/pages/' + id + '/attachments'), api('/wiki/pages/' + id + '/breadcrumbs'), api('/wiki/spaces')]).then(([p, a, b, s]) => { if (read.current === request) { setCurrent(p); setSpaces(s); setSpaceId(p.space_id); setAttachments(a); setBreadcrumbs(b); setDraft({ title: p.title, content: p.content }); } }).catch(e => { if (read.current === request) setError(e.message); }).finally(() => { if (read.current === request) setLoading(false); });
        } else if (route.startsWith('#workflow/')) {
            setLoading(true); api('/wiki/workflows/' + route.slice(10) + '/context').then(f => { if (read.current === request) setFlow(f); }).catch(e => { if (read.current === request) setError(e.message); }).finally(() => { if (read.current === request) setLoading(false); });
        }
        return () => { read.current++; };
    }, [route]);
    async function perform(work: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
    async function reloadPages() { if (spaceId) setPages(await api(`/wiki/spaces/${spaceId}/pages?archived=${archived}`)); }
    async function save() {
        if (!current) return;
        const id = current.id, version = current.version, request = read.current;
        await perform(async () => {
            const saved = await api('/wiki/pages/' + id, 'PATCH', { ...draft, expected_version: version });
            if (read.current !== request) return;
            setCurrent(saved); setDraft({ title: saved.title, content: saved.content }); setEditing(false); setLatest(null); setHistory(null); setNotice('页面已保存');
            try { await reloadPages(); } catch { setNotice('页面已保存；目录刷新失败，可稍后重试。'); }
        });
    }
    async function archive() {
        if (!current || !await confirm({ title: current.archived ? '恢复此页面？' : '归档此页面？', message: '页面正文和历史会保留。', action: current.archived ? '恢复页面' : '归档页面' })) return;
        const request = read.current;
        await perform(async () => { const p = await api('/wiki/pages/' + current.id, 'PATCH', { archived: !current.archived, expected_version: current.version }); if (read.current !== request) return; setCurrent(p); setNotice(p.archived ? '已归档，可在归档目录恢复' : '已恢复'); await reloadPages(); });
    }
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
        await perform(async () => {
            if (dialog === 'space') {
                const s = await api('/wiki/spaces', 'POST', data); setSpaces(value => [s, ...value]); setSpaceId(s.id); setDialog(null); location.hash = 'space/' + s.id;
            } else if (dialog === 'page') {
                const p = await api('/wiki/pages', 'POST', { ...data, space_id: spaceId, kind, parent_id: parentId || null, request_id: pageRequest.current });
                setDialog(null); setPages(value => [...value, p]); location.hash = 'page/' + p.id;
            } else if (dialog === 'skill' && current) {
                const s = await api('/wiki/pages/' + current.id + '/skill', 'POST', { ...data, expected_version: current.version });
                setDialog(null); setSelectedSkill(s.id); setAllSkills(value => [s, ...value]); setNotice(`已保存 Skill「${s.name}」，可绑定到 Agent 或工作流程`);
            } else if (dialog === 'agent') {
                const a = await api('/agents', 'POST', data); setDialog(null); setSelectedAgent(a.id); setAgents(value => [a, ...value]); setNotice(`已创建 Agent「${a.name}」`);
            } else if (dialog === 'workflow') {
                const w = await api('/wiki/workflows', 'POST', { ...data, steps }); setDialog(null); setFlows(value => [w, ...value]); location.hash = 'workflow/' + w.id;
            }
        });
    }
    async function upload(file: File) {
        if (!current) return;
        const request = read.current;
        if (file.size > 8 * 1024 * 1024) { setError('附件不能超过 8 MiB'); return; }
        await perform(async () => {
            const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('附件读取失败')); reader.readAsDataURL(file); });
            const a = await api('/wiki/pages/' + current.id + '/attachments', 'POST', { name: file.name, data }); if (read.current !== request) return; setAttachments(value => [...value.filter(x => x.id !== a.id), a]); setNotice('附件已保存');
        });
    }
    function tree(parent: string | null, depth = 0): React.ReactNode {
        if (depth > 50) return null;
        return pages.filter(p => archived || p.parent_id === parent).map(p => <li key={p.id}><a className={current?.id === p.id ? 'selected' : ''} href={'#page/' + p.id}><FileText aria-hidden="true" className="size-4"/><span>{p.title}</span>{p.kind === 'sop' && <small>SOP</small>}</a>{!archived && <ul>{tree(p.id, depth + 1)}</ul>}</li>);
    }
    const space = spaces.find(s => s.id === spaceId);
    return <div className="knowledge-app">
        <div className="page-heading"><div><h1 tabIndex={-1}>{flowMode ? '工作流程' : '组织知识'}</h1><p className="muted">把知识沉淀成可复用的方法。</p></div><div className="actions"><Button variant="outline" asChild><a href={flowMode ? '#knowledge' : '#workflows'}>{flowMode ? <BookOpen/> : <Workflow/>}{flowMode ? '知识空间' : '工作流程'}</a></Button><Button onClick={() => { setDialog(flowMode ? 'workflow' : 'space'); setSteps([]); }}>{flowMode ? '新建工作流程' : '新建空间'}</Button></div></div>
        {error && <div className="wiki-error" role="alert">{error}<Button variant="ghost" size="sm" onClick={() => setError('')}>关闭</Button></div>}
        {notice && <p role="status" className="wiki-notice">{notice}</p>}
        {flowMode ? <section className="wiki-flow-layout"><aside className="wiki-directory"><h2>团队流程</h2><ul>{flows.map(w => <li key={w.id}><a href={'#workflow/' + w.id}><Workflow className="size-4"/>{w.name}</a></li>)}</ul>{!flows.length && <p className="muted">保存 SOP 为 Skill 后，将它们组合成工作流程。</p>}</aside><article className="wiki-document">{loading ? <p role="status">正在读取…</p> : flow ? <><div className="page-heading"><div><h2>{flow.workflow.name}</h2><p>{flow.workflow.description}</p></div><Button variant="outline" onClick={() => download('workflow-' + flow.workflow.id + '.json', flow)}><Download/>导出流程</Button></div><ol className="wiki-steps">{flow.steps.map((s: any, i: number) => <li key={i}><h3>{s.title}</h3><p>{s.skill.name}{s.agent ? ` · ${s.agent.name}` : ''}</p>{s.skill.update_available && <p className="muted">来源有更新；此步骤保留已选版本。</p>}<details><summary>查看 Skill</summary><pre>{s.skill.content}</pre></details></li>)}</ol></> : <div className="wiki-empty"><Workflow/><h2>组织的方法，成为可复用的步骤</h2><p>选择已沉淀的 Skill，为步骤关联 Agent，保存团队认可的工作路径。</p></div>}</article></section> : <>
        <form className="wiki-search" onSubmit={e => { e.preventDefault(); void perform(async () => setResults(await api('/wiki/search?q=' + encodeURIComponent(query)))); }}><Search aria-hidden="true"/><Input aria-label="搜索组织知识" placeholder="搜索页面标题与正文…" value={query} onChange={e => setQuery(e.target.value)} required maxLength={200}/><Button variant="outline" disabled={busy}>搜索</Button>{results && <Button type="button" variant="ghost" onClick={() => { setResults(null); setQuery(''); }}>清除</Button>}</form>
        {results && <section className="wiki-results" aria-label="搜索结果"><h2>{results.length} 条结果</h2>{results.map(p => <a key={p.id} href={'#page/' + p.id} onClick={() => setResults(null)}><strong>{p.title}</strong><p>{p.excerpt}</p></a>)}</section>}
        <div className="wiki-layout"><aside className="wiki-directory"><div className="wiki-directory-header"><h2>知识空间</h2><Button variant="ghost" size="icon" aria-label="新建知识空间" onClick={() => setDialog('space')}><Plus/></Button></div>{spaces.length ? <Choice label="知识空间" value={spaceId} onChange={id => { location.hash = 'space/' + id; }} options={spaces.map(s => ({ value: s.id, label: s.name }))}/> : <p className="muted">还没有知识空间</p>}
        {spaceId && <><div className="wiki-directory-header"><Button variant="ghost" size="sm" onClick={() => { setKind('document'); setParentId(''); setDialog('page'); }}><Plus/>新建页面</Button><Button variant="ghost" size="sm" onClick={() => setArchived(v => !v)}>{archived ? '返回目录' : '归档'}</Button></div><ul className="wiki-tree">{tree(null)}</ul>{!pages.length && <p className="muted">{archived ? '暂无归档页面' : '从一份产品介绍或 SOP 开始。'}</p>}</>}
        </aside><article className="wiki-document">{loading ? <p role="status">正在读取页面…</p> : current ? <>
        <nav className="wiki-breadcrumbs" aria-label="页面路径"><a href={'#space/' + current.space_id}>{space?.name}</a>{breadcrumbs.map(p => <span key={p.id}> / <a href={'#page/' + p.id}>{p.title}</a></span>)}</nav>
        <div className="page-heading"><div><span className="wiki-kind">{current.kind === 'sop' ? 'SOP' : '知识页面'}{current.archived ? ' · 已归档' : ''}</span>{!editing && <h2>{current.title}</h2>}<small className="muted">版本 {current.version} · {new Date(current.updated_at).toLocaleString('zh-CN')}</small></div><div className="actions">{!editing && !current.archived && <Button onClick={() => setEditing(true)}>编辑页面</Button>}<Button variant="outline" disabled={busy || editing} onClick={() => void perform(async () => setHistory(history ? null : await api('/wiki/pages/' + current.id + '/history')))}>历史</Button><Button variant="ghost" disabled={busy || editing} onClick={() => void archive()}>{current.archived ? '恢复页面' : '归档页面'}</Button></div></div>
        {editing ? <div className="wiki-editor"><Label>页面标题<Input aria-label="页面标题" value={draft.title} maxLength={200} onChange={e => setDraft(v => ({ ...v, title: e.target.value }))}/></Label><Label>页面正文<Textarea aria-label="页面正文" value={draft.content} rows={18} maxLength={500000} onChange={e => setDraft(v => ({ ...v, content: e.target.value }))}/></Label><div className="actions"><Button disabled={busy || !draft.title.trim()} onClick={() => void save()}>保存页面</Button><Button variant="outline" disabled={busy} onClick={() => void (async () => { if (dirty && !await confirm({ title: '放弃未保存的修改？', message: '正文将恢复为已保存版本。', action: '放弃修改' })) return; setEditing(false); setDraft({ title: current.title, content: current.content }); setLatest(null); })()}>取消编辑</Button><Button variant="ghost" disabled={busy} onClick={() => void perform(async () => setLatest(await api('/wiki/pages/' + current.id)))}>读取最新版本</Button></div>{latest && <section className="wiki-conflict"><h3>最新版本 {latest.version}</h3><pre>{latest.content}</pre><Button variant="outline" onClick={() => { setCurrent(latest); setLatest(null); setNotice('已采用最新版本号，请核对并合并当前草稿后保存。'); }}>我已合并，使用最新版本号</Button></section>}<details><summary>预览草稿</summary><div className="wiki-markdown"><ReactMarkdown>{draft.content}</ReactMarkdown></div></details></div> : <div className="wiki-markdown"><ReactMarkdown>{current.content || '此页面还没有正文。'}</ReactMarkdown></div>}
        {history && <section className="wiki-history"><h3>页面历史</h3>{history.map(h => <details key={h.version}><summary>版本 {h.version} · {h.title}</summary><pre>{h.content}</pre><Button variant="outline" size="sm" disabled={busy || editing} onClick={() => void perform(async () => { const p = await api('/wiki/pages/' + current.id, 'PATCH', { title: h.title, content: h.content, kind: h.kind, expected_version: current.version }); setCurrent(p); setDraft({ title: p.title, content: p.content }); setHistory(await api('/wiki/pages/' + current.id + '/history')); setNotice('已恢复历史内容，原有历史仍保留'); })}>将内容恢复为新版本</Button></details>)}</section>}
        <section className="wiki-attachments"><div className="wiki-directory-header"><h3><Paperclip className="size-4"/>资料与附件</h3>{!current.archived && <Label className="wiki-upload">上传原件<input className="wiki-file-input" type="file" aria-label="上传资料原件" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }}/></Label>}</div>{attachments.length ? <ul>{attachments.map(a => <li key={a.id}><a href={'/api/wiki/attachments/' + a.id + '/download'}>{a.name}</a><small>{Math.ceil(a.size / 1024)} KB</small>{a.media_type.startsWith('image/') && <img src={'/api/wiki/attachments/' + a.id + '/download'} alt={a.name} loading="lazy"/>}</li>)}</ul> : <p className="muted">保留截图、调研原件和介绍文档。</p>}</section>
        {current.kind === 'sop' && !current.archived && <section className="wiki-capabilities"><div className="page-heading"><div><h3>沉淀为团队 Skill</h3><p className="muted">保存当前 SOP，供工作流程和 Agent 复用。</p></div><Button variant="outline" disabled={editing || busy} onClick={() => setDialog('skill')}>保存为 Skill</Button></div></section>}
        </> : <div className="wiki-empty"><BookOpen/><h2>{space?.name || '让组织知识有一个自己的家'}</h2><p>{space?.description || '沉淀背景、资料和 SOP，让团队与 AI 使用同一份知识。'}</p><Button onClick={() => { if (!spaceId) setDialog('space'); else { setKind('document'); setParentId(''); setDialog('page'); } }}>{spaceId ? '创建第一份页面' : '创建知识空间'}</Button></div>}
        {spaceId && <div className="wiki-export"><Button variant="ghost" disabled={busy} onClick={() => void perform(async () => download('space-' + spaceId + '.json', await api('/wiki/spaces/' + spaceId + '/export')))}><Download/>导出空间与原件</Button></div>}
        </article></div>
        <section className="wiki-bindings"><div className="page-heading"><div><h2>Skill 与 Agent</h2><p className="muted">选择团队方法，绑定到一个 Agent。</p></div><Button variant="outline" onClick={() => setDialog('agent')}>新建 Agent</Button></div><div className="wiki-binding-form"><Choice label="选择 Skill" value={selectedSkill} onChange={setSelectedSkill} options={allSkills.map(s => ({ value: s.id, label: s.name }))}/><Choice label="选择 Agent" value={selectedAgent} onChange={setSelectedAgent} options={agents.map(a => ({ value: a.id, label: a.name }))}/><Button disabled={busy || !selectedSkill || !selectedAgent} onClick={() => void perform(async () => { const s = allSkills.find(s => s.id === selectedSkill); await api('/wiki/agents/' + selectedAgent + '/skills', 'POST', { skill_id: selectedSkill, expected_skill_version: s.updated_at }); setNotice('已绑定选定 Skill 版本'); })}>绑定 Skill</Button>{selectedAgent && <Button variant="ghost" onClick={() => void perform(async () => download('agent-' + selectedAgent + '.json', await api('/wiki/agents/' + selectedAgent + '/context')))}>导出 Agent 上下文</Button>}</div></section>
        </>}
        {dialog && <AppDialog name="知识操作" title={{ space: '新建知识空间', page: '新建页面', skill: '保存 SOP 为 Skill', workflow: '新建工作流程', agent: '新建 Agent' }[dialog]} busy={busy} close={() => { if (!busy) setDialog(null); }}><form onSubmit={submit}>
        <Label>{dialog === 'page' ? '页面标题' : '名称'}<Input name={dialog === 'page' ? 'title' : 'name'} required maxLength={200} autoFocus placeholder={dialog === 'skill' ? '例如 requirements-review' : ''}/></Label>
        {dialog !== 'page' && <Label>{dialog === 'skill' ? '适用场景' : '简介'}<Textarea name="description" required={dialog === 'skill'} rows={3}/></Label>}
        {dialog === 'page' && <><Choice label="页面类型" value={kind} onChange={setKind} options={[{ value: 'document', label: '知识页面' }, { value: 'sop', label: 'SOP' }]}/><Choice label="父页面" value={parentId || '__root'} onChange={v => setParentId(v === '__root' ? '' : v)} options={[{ value: '__root', label: '空间根目录' }, ...pages.filter(p => !p.archived).map(p => ({ value: p.id, label: p.title }))]}/><Label>初始正文<Textarea name="content" rows={8}/></Label></>}
        {dialog === 'agent' && <Label>Agent 指令<Textarea name="content" rows={8} required/></Label>}
        {dialog === 'workflow' && <section className="wiki-step-editor"><h3>工作步骤</h3>{steps.map((s, i) => <div key={i}><Label>步骤 {i + 1}<Input value={s.title} required onChange={e => setSteps(v => v.map((x, n) => n === i ? { ...x, title: e.target.value } : x))}/></Label><Choice label={'步骤 Skill ' + (i + 1)} value={s.skill_id} onChange={id => setSteps(v => v.map((x, n) => n === i ? { ...x, skill_id: id } : x))} options={allSkills.map(s => ({ value: s.id, label: s.name }))}/><Choice label={'步骤 Agent ' + (i + 1)} value={s.agent_id || '__none'} onChange={id => setSteps(v => v.map((x, n) => n === i ? { ...x, agent_id: id === '__none' ? undefined : id } : x))} options={[{ value: '__none', label: '不指定 Agent' }, ...agents.map(a => ({ value: a.id, label: a.name }))]}/><Button type="button" variant="ghost" onClick={() => setSteps(v => v.filter((_, n) => n !== i))}>移除步骤</Button></div>)}<Button type="button" variant="outline" disabled={!allSkills.length || steps.length >= 30} onClick={() => setSteps(v => [...v, { title: '', skill_id: allSkills[0]?.id || '' }])}>添加步骤</Button>{!allSkills.length && <p>请先将一份 SOP 保存为 Skill。</p>}</section>}
        {error && <p role="alert">{error}</p>}<footer className="modal-footer"><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>取消</Button><Button disabled={busy || dialog === 'workflow' && !steps.length}>{busy ? '保存中…' : '保存'}</Button></footer></form></AppDialog>}
    </div>;
}
