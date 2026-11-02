import { useEffect, useRef, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import './skills.css';
import { downloadText } from './text-download';
import { AppDialog as SkillDialog, Choice as SkillSelect, useConfirmation, FieldLabel as Label } from './components/app-ui';
import { Card } from './components/ui/card';
import { Alert, AlertDescription } from './components/ui/alert';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
import { Button as ShadcnButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Checkbox } from './components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './components/ui/dropdown-menu';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { Plus, Download, RefreshCw, Trash2, MoreHorizontal, ExternalLink, Search, SlidersHorizontal, FileText, Folder } from 'lucide-react';
function Button(props: React.ComponentProps<typeof ShadcnButton>) { return <ShadcnButton variant="outline" {...props}/>; }
type SkillFile = { path: string; content: string };
type Skill = { id: string; name: string; description: string; content?: string; files?: SkillFile[]; labels: string[]; source_url: string; source_type: string; created_by_email?: string; updated_by_email?: string; updated_at: string; file_count?: number };
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type ImportCandidate = { path: string; name: string; description: string; existing_skill?: { id: string; name: string } };
type ImportOutcome = { path: string; status: string; error?: string; skill?: { id: string; name: string } };
export function Skills({ api }: { api: Api }) {
    const confirm = useConfirmation();
    const [id, setId] = useState(location.hash.startsWith('#skill/') ? location.hash.slice(7) : '');
    const [items, setItems] = useState<Skill[]>([]);
    const [skill, setSkill] = useState<Skill | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('updated-desc');
    const [filters, setFilters] = useState(false);
    const [creator, setCreator] = useState('');
    const [label, setLabel] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const [results, setResults] = useState<string[]>([]);
    const [importing, setImporting] = useState(false);
    const [url, setUrl] = useState('');
    const [conflict, setConflict] = useState(false);
    const [importSource, setImportSource] = useState<{ sha: string; ref: string; candidates: ImportCandidate[] } | null>(null);
    const [importSelected, setImportSelected] = useState<string[]>([]);
    const [importStrategies, setImportStrategies] = useState<Record<string, string>>({});
    const [importOutcomes, setImportOutcomes] = useState<ImportOutcome[]>([]);
    const [tab, setTab] = useState('overview');
    const [path, setPath] = useState('SKILL.md');
    const [fileFeedback, setFileFeedback] = useState<{ message: string; failed?: boolean; text?: string } | null>(null);
    const copyRequest = useRef(0);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [newFile, setNewFile] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [properties, setProperties] = useState({ name: '', description: '', labels: '' });
    function apply(value: Skill) { setSkill(value); setProperties({ name: value.name, description: value.description, labels: value.labels.join(', ') }); setDirty(false); }
    async function load() {
        const data = await api('/skills'); setItems(data);
        setSelected(previous => previous.filter(identifier => data.some((item: Skill) => item.id === identifier)));
    }
    useEffect(() => { const change = () => { setId(location.hash.startsWith('#skill/') ? location.hash.slice(7) : ''); setTab('overview'); setPath('SKILL.md'); setEditing(false); setDirty(false); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
    useEffect(() => {
        let active = true;
        setError(''); setLoading(true); setSkill(null);
        (id ? api('/skills/' + encodeURIComponent(id)) : api('/skills')).then(value => { if (!active) return; if (id) apply(value); else setItems(value); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [id, refreshVersion]);
    useEffect(() => {
        if (!dirty && !editing) return;
        const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', prevent);
        return () => window.removeEventListener('beforeunload', prevent);
    }, [dirty, editing]);
    async function act(work: () => Promise<void>) { setBusy(true); setError(''); try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }
    async function importUrl(strategy = 'fail') {
        if (busy) return;
        await act(async () => {
            if (!importSource) {
                const source = await api('/skills/discover', 'POST', { url });
                if (source.candidates.length > 1) { setImportSource(source); return; }
            } else {
                const overwrite = importSource.candidates.filter(candidate => importSelected.includes(candidate.path) && importStrategies[candidate.path] === 'overwrite');
                if (overwrite.length && !await confirm({ title: '覆盖已有 Skill？', message: `替换 ${overwrite.map(candidate => candidate.name).join('、')} 的正文和文件？`, action: '覆盖所选', destructive: true })) return;
                const outcome = await api('/skills/import-batch', 'POST', { url, sha: importSource.sha, items: importSelected.map(path => ({ path, on_conflict: importStrategies[path] || 'fail' })) });
                const merged: ImportOutcome[] = [...importOutcomes.filter(item => !outcome.results.some((result: ImportOutcome) => result.path === item.path)), ...outcome.results];
                setImportOutcomes(merged);
                setImportSelected(previous => previous.filter(path => !merged.some(item => item.path === path && ['created', 'updated', 'skipped'].includes(item.status))));
                // Record completed writes before refreshing, so a read failure never repeats them.
                if (outcome.results.every((item: ImportOutcome) => ['created', 'updated', 'skipped'].includes(item.status))) {
                    setImporting(false); setUrl(''); resetImport(); setResults(merged.map(item => `${item.skill?.name || item.path}：${({ created: '已导入', updated: '已覆盖', skipped: '已跳过' } as Record<string, string>)[item.status] || item.error || '未导入'}`));
                }
                await load(); return;
            }
            try { const result = await api('/skills/import', 'POST', { url, on_conflict: strategy }); setConflict(false); setImporting(false); setUrl(''); setResults([result.status === 'skipped' ? '已跳过，原条目未修改' : `${result.skill.name}：${result.status === 'updated' ? '已覆盖' : '已导入'}`]); await load(); }
            catch (error) { if ((error as Error & { data?: { status: string } }).data?.status === 'conflict') setConflict(true); throw error; }
        });
    }
    function resetImport() { setImportSource(null); setImportSelected([]); setImportStrategies({}); setImportOutcomes([]); setConflict(false); setError(''); }
    async function batch(action: 'refresh' | 'delete', identifiers: string[]) {
        const names = identifiers.map(identifier => items.find(item => item.id === identifier)?.name ?? skill?.name ?? identifier).join('、');
        if (!await confirm({ title: action === 'delete' ? '删除 Skill？' : '从来源更新 Skill？', message: action === 'delete' ? `永久删除 ${names}（${identifiers.length} 个 Skill）及其文件？` : `从来源更新 ${names}？将覆盖本地名称、简介、正文和文件，保留标签。`, action: action === 'delete' ? '删除 Skill' : '确认更新', destructive: action === 'delete' })) return;
        await act(async () => {
            const outcome: string[] = [];
            for (const identifier of identifiers) {
                const name = items.find(item => item.id === identifier)?.name ?? skill?.name ?? identifier;
                try { await api('/skills/' + identifier + (action === 'refresh' ? '/refresh' : ''), action === 'refresh' ? 'POST' : 'DELETE'); outcome.push(`${name}：${action === 'refresh' ? '已更新' : '已删除'}`); }
                catch (error) { outcome.push(`${name}：失败 — ${(error as Error).message}`); }
            }
            setResults(outcome); await load();
            if (id) { try { apply(await api('/skills/' + id)); setEditing(false); } catch { location.hash = 'skills'; } }
        });
    }
    async function leaveDraft() { if ((dirty || editing) && !await confirm('放弃未保存的修改？')) return false; setDirty(false); setEditing(false); return true; }
    const filtered = items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) && (!creator || item.created_by_email === creator) && (!label || item.labels.includes(label))).sort((left, right) => { const order = sort.startsWith('name') ? left.name.localeCompare(right.name) : left.updated_at.localeCompare(right.updated_at); return sort.endsWith('asc') ? order : -order; });
    const content = path === 'SKILL.md' ? skill?.content ?? '' : skill?.files?.find(file => file.path === path)?.content ?? '';
    useEffect(() => { copyRequest.current++; setFileFeedback(null); }, [id, path, content, editing, draft]);
    async function copyFile() {
        const request = ++copyRequest.current;
        const text = editing ? draft : content;
        setFileFeedback(null);
        try {
            await navigator.clipboard.writeText(text);
            if (copyRequest.current === request) setFileFeedback({ message: `${path} 已复制` });
        } catch {
            if (copyRequest.current === request) setFileFeedback({ message: `${path} 复制失败，请手动复制下方文本。`, failed: true, text });
        }
    }
    function downloadFile() {
        copyRequest.current++;
        setFileFeedback(null);
        try { downloadText(path, id, content, path.toLowerCase().endsWith('.md') ? 'md' : 'txt'); }
        catch { setFileFeedback({ message: `${path} 下载失败，请重试。`, failed: true }); }
    }
    function tree(paths: string[], prefix = ''): React.ReactNode {
        const groups = [...new Set(paths.map(value => value.slice(prefix.length).split('/')[0]))];
        return groups.map(group => { const current = prefix + group; const children = paths.filter(value => value.startsWith(current + '/')); return children.length ? <Collapsible key={current} defaultOpen className="ml-2"><CollapsibleTrigger asChild><Button variant="ghost" size="sm"><Folder className="size-4" aria-hidden="true"/>{group}</Button></CollapsibleTrigger><CollapsibleContent>{tree(children, current + '/')}</CollapsibleContent></Collapsible> : <Button key={current} variant={path === current ? 'secondary' : 'ghost'} aria-label={current} onClick={async () => { if (await leaveDraft()) setPath(current); }}>{group}</Button>; });
    }
    return <section className="skills-view">{error && !importing && <Alert variant="destructive"><AlertDescription>{error}{!skill && !newFile && <Button disabled={loading || busy} onClick={() => setRefreshVersion(version => version + 1)}>重试读取 Skill</Button>}</AlertDescription></Alert>}{results.length > 0 && <Alert className="skill-results" role="region" aria-label="操作结果"><AlertDescription><Button variant="ghost" size="sm" onClick={() => setResults([])}>关闭结果</Button>{results.map((result, index) => <p key={index}>{result}</p>)}</AlertDescription></Alert>}
        {id ? <><div className="skill-breadcrumb"><a href="#skills" aria-label="返回 Skill 库" onClick={async event => { event.preventDefault(); if (await leaveDraft()) location.hash = 'skills'; }}>Skill 库</a><span> / {skill?.name ?? '详情'}</span><div className="actions"><Button disabled={busy || !skill?.source_url} title={!skill?.source_url ? '没有可更新的 URL 来源' : ''} onClick={() => void batch('refresh', [id])}><RefreshCw/>从来源更新</Button><Button variant="ghost" className="text-destructive" disabled={busy || !skill} onClick={() => void batch('delete', [id])}><Trash2/>删除 Skill</Button></div></div>{loading ? <div className="loading-state" role="status"><p>正在读取 Skill…</p><div className="loading-line"/></div> : skill && <><div className="skill-title"><h1 tabIndex={-1}><FileText aria-hidden="true"/>{skill.name}</h1><div className="muted">{skill.source_url ? <a href={skill.source_url} target="_blank" rel="noreferrer">导入自 {skill.source_type}</a> : '无 URL 来源'} · {(skill.files?.length ?? 0) + 1} 个文件 · {new Date(skill.updated_at).toLocaleString('zh-CN')} {skill.updated_by_email && `由 ${skill.updated_by_email} 更新`}</div></div><Tabs value={tab} onValueChange={async value => { if (await leaveDraft()) setTab(value); }}><TabsList><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="files">文件 {(skill.files?.length ?? 0) + 1}</TabsTrigger></TabsList>
            <TabsContent value={tab}>{tab === 'overview' ? <section className="skill-properties"><h2>属性</h2><p className="muted">名称和简介与 SKILL.md frontmatter 保持同步。</p><form onSubmit={(event: FormEvent) => { event.preventDefault(); void act(async () => { apply(await api('/skills/' + id, 'PATCH', { name: properties.name, description: properties.description, labels: properties.labels.split(/[,，]/).map(value => value.trim()).filter(Boolean) })); setResults(['属性已保存']); }); }}><Label>名称<Input required maxLength={200} value={properties.name} onChange={event => { setDirty(true); setProperties({ ...properties, name: event.target.value }); }}/></Label><Label>简介<Textarea aria-label="简介" rows={4} value={properties.description} onChange={event => { setDirty(true); setProperties({ ...properties, description: event.target.value }); }}/></Label><Label>标签<Input aria-label="标签" placeholder="标签之间用逗号分隔" value={properties.labels} onChange={event => { setDirty(true); setProperties({ ...properties, labels: event.target.value }); }}/></Label><Button variant="default" disabled={busy}>保存属性</Button></form><p className="muted">团队成员均可编辑和删除。内容仅作为文本资源保存，不执行或安装。</p></section> : <div className="skill-files"><aside aria-label="文件目录"><small>主文件</small><Button variant={path === 'SKILL.md' ? 'secondary' : 'ghost'} onClick={async () => { if (await leaveDraft()) setPath('SKILL.md'); }}>SKILL.md</Button><small>辅助文件 {skill.files?.length ?? 0}</small>{tree(skill.files?.map(file => file.path) ?? [])}<Button variant="ghost" size="sm" disabled={busy} onClick={async () => { if (await leaveDraft()) setNewFile(true); }}><Plus/>新增文件</Button></aside><section className="skill-file-content"><header><code data-testid="current-skill-file">当前文件：{path}</code><div className="actions"><Button onClick={() => void copyFile()}>复制当前文件</Button><Button onClick={downloadFile}>下载已保存文件</Button><Button aria-label="预览文件" onClick={async () => { if (await leaveDraft()) setEditing(false); }}>预览</Button><Button aria-label="编辑文件" disabled={busy} onClick={() => { setDraft(content); setEditing(true); }}>编辑</Button>{path !== 'SKILL.md' && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={async () => { if (await confirm({ title: `删除文件「${path}」？`, message: '永久删除此文件，删除后无法恢复。', action: '删除文件', destructive: true })) void act(async () => { apply(await api('/skills/' + id + '/files', 'DELETE', { path })); setPath('SKILL.md'); setEditing(false); }); }}>删除文件</Button>}</div></header>{fileFeedback && <div className="action-feedback" role={fileFeedback.failed ? 'alert' : 'status'} aria-live="polite"><span>{fileFeedback.message}</span>{fileFeedback.text !== undefined && <Textarea aria-label="当前文件手动复制" readOnly value={fileFeedback.text ?? ''} onFocus={event => event.currentTarget.select()}/>}</div>}{editing ? <form onSubmit={event => { event.preventDefault(); void act(async () => { apply(await api('/skills/' + id + (path === 'SKILL.md' ? '' : '/files'), path === 'SKILL.md' ? 'PATCH' : 'PUT', path === 'SKILL.md' ? { content: draft } : { path, content: draft })); setEditing(false); setResults(['文件已保存']); }); }}><Label>文件正文<Textarea aria-label="文件正文" className="code-input" value={draft} onChange={event => setDraft(event.target.value)} rows={25}/></Label><Button variant="default" disabled={busy}>保存文件</Button></form> : /\.md$/i.test(path) ? <div className="skill-preview"><Markdown skipHtml disallowedElements={['img']} urlTransform={value => /^https?:\/\//i.test(value) ? value : ''} components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer"/> }}>{content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')}</Markdown></div> : <pre>{content}</pre>}</section></div>}</TabsContent></Tabs></> }</> : <><div className="page-heading"><div><h1 tabIndex={-1}>Skill 库</h1><p className="muted">团队方法、正文与参考文件，共享在一个地方。</p></div><Button variant="default" onClick={() => { setError(''); setConflict(false); setImporting(true); }}><Download/>从 URL 导入</Button></div><div className="list-toolbar"><Label className="skill-search block"><Search className="size-4" aria-hidden="true"/><Input className="pl-9" aria-label="搜索 Skill" placeholder="搜索 Skill…" value={query} onChange={event => { setQuery(event.target.value); setSelected([]); }}/></Label><div className="actions"><Button onClick={() => setFilters(!filters)}><SlidersHorizontal/>筛选</Button><Label className="skill-sort flex-row items-center">排序<SkillSelect label="排序" value={sort} onChange={setSort} options={[{ value: "updated-desc", label: "最近更新" }, { value: "updated-asc", label: "最早更新" }, { value: "name-asc", label: "名称升序" }, { value: "name-desc", label: "名称降序" }]}/></Label></div></div>{filters && <div className="skill-filters"><Label>添加者<SkillSelect label="添加者" value={creator} onChange={value => { setCreator(value); setSelected([]); }} options={[{ value: "", label: "全部添加者" }, ...[...new Set(items.map(item => item.created_by_email).filter((email): email is string => Boolean(email)))].map(email => ({ value: email, label: email }))]}/></Label><Label>标签筛选<SkillSelect label="标签筛选" value={label} onChange={value => { setLabel(value); setSelected([]); }} options={[{ value: "", label: "全部标签" }, ...[...new Set(items.flatMap(item => item.labels))].map(label => ({ value: label, label }))]}/></Label><Button onClick={() => { setCreator(''); setLabel(''); setSelected([]); }}>清除筛选</Button></div>}{loading ? <div className="loading-state" role="status"><p>正在读取…</p><div className="loading-line"/></div> : <><p className="muted">{filtered.length} 个 Skill</p>{filtered.length > 0 && <div className="skill-table-scroll"><Table className="skill-table"><TableHeader><TableRow><TableHead><Checkbox aria-label="选择全部可见 Skill" checked={filtered.length > 0 && filtered.every(item => selected.includes(item.id)) ? true : filtered.some(item => selected.includes(item.id)) ? "indeterminate" : false} onCheckedChange={checked => setSelected(checked ? filtered.map(item => item.id) : [])}/></TableHead><TableHead>名称</TableHead><TableHead>添加者</TableHead><TableHead>更新时间</TableHead><TableHead><span className="muted">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map(item => <TableRow key={item.id}><TableCell><Checkbox aria-label={'选择 ' + item.name} checked={selected.includes(item.id)} onCheckedChange={checked => setSelected(previous => checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/></TableCell><TableCell><a href={'#skill/' + item.id}>{item.name}</a><small className="muted">{item.labels.join(' · ')}</small></TableCell><TableCell>{item.created_by_email || '历史条目'}</TableCell><TableCell>{new Date(item.updated_at).toLocaleString('zh-CN')}</TableCell><TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={item.name + ' 操作'}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><a href={'#skill/' + item.id} target="_blank" rel="noreferrer"><ExternalLink/>新标签打开</a></DropdownMenuItem><DropdownMenuItem disabled={busy || !item.source_url} onSelect={() => void batch('refresh', [item.id])}><RefreshCw/>从来源更新</DropdownMenuItem><DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => void batch('delete', [item.id])}><Trash2/>删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody></Table></div>}{!filtered.length && <Card className="empty"><h2>{items.length ? '没有匹配的 Skill' : '从 URL 导入第一个 Skill'}</h2><p>支持 GitHub 与 skills.sh 的公开文本资源。</p></Card>}</>}{selected.length > 0 && <div className="skill-batch" role="toolbar" aria-label="所选 Skill 操作"><strong>已选 {selected.length} 项</strong><Button onClick={() => setSelected([])}>取消选择</Button><Button disabled={busy} onClick={() => void batch('refresh', selected)}>更新所选</Button><Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => void batch('delete', selected)}>删除所选</Button></div>}</>}
        {importing && <SkillDialog title="从 URL 导入" description="导入 Skill 正文与附属文本文件。" busy={busy} close={() => { setImporting(false); resetImport(); }}><form onSubmit={event => { event.preventDefault(); void importUrl(); }}>
            <Label>Skill URL<Input required disabled={busy} value={url} onChange={event => { setUrl(event.target.value); resetImport(); }} placeholder="https://github.com/owner/repo"/></Label>
            {!importSource && <div className="skill-sources"><Card><strong>GitHub</strong><small>仓库 / 目录 / SKILL.md</small></Card><Card><strong>Skills.sh</strong><small>skills.sh/owner/repo/skill</small></Card></div>}
            {importSource && <>
                <label className="skill-import-select"><Checkbox aria-label="选择全部候选 Skill" disabled={busy} checked={importSelected.length > 0 && importSource.candidates.every(candidate => importSelected.includes(candidate.path) || importOutcomes.some(item => item.path === candidate.path && ['created', 'updated', 'skipped'].includes(item.status))) ? true : importSelected.length ? 'indeterminate' : false} onCheckedChange={checked => setImportSelected(checked ? importSource.candidates.filter(candidate => !importOutcomes.some(item => item.path === candidate.path && ['created', 'updated', 'skipped'].includes(item.status))).map(candidate => candidate.path) : [])}/>选择全部（{importSource.candidates.length}）</label>
                <div className="skill-import-candidates" aria-label="候选 Skill">{importSource.candidates.map(candidate => {
                    const outcome = importOutcomes.find(item => item.path === candidate.path);
                    const finished = Boolean(outcome && ['created', 'updated', 'skipped'].includes(outcome.status));
                    return <div className="skill-import-candidate" key={candidate.path}>
                        <label className="skill-import-select"><Checkbox aria-label={'导入 ' + candidate.name} checked={importSelected.includes(candidate.path)} disabled={busy || finished} onCheckedChange={checked => setImportSelected(previous => checked ? [...previous, candidate.path] : previous.filter(path => path !== candidate.path))}/><span><strong>{candidate.name}</strong><small className="muted">{candidate.description}</small><code>{candidate.path || '/'}</code></span></label>
                        {(candidate.existing_skill || outcome?.status === 'conflict') && !finished && <fieldset disabled={busy}><SkillSelect label={candidate.name + ' 冲突处理'} value={importStrategies[candidate.path] || 'fail'} onChange={value => setImportStrategies(previous => ({ ...previous, [candidate.path]: value }))} options={[{ value: 'fail', label: '同名时暂停' }, { value: 'skip', label: '跳过' }, { value: 'rename', label: '重命名副本' }, { value: 'overwrite', label: '覆盖原条目' }]}/></fieldset>}
                        {outcome && <p role="status" className={finished ? 'muted' : 'text-destructive'}>{({ created: '已导入', updated: '已覆盖', skipped: '已跳过', conflict: '已有同名 Skill，请选择处理方式' } as Record<string, string>)[outcome.status] || outcome.error || '导入失败'}</p>}
                    </div>;
                })}</div>
            </>}
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            {conflict && <Alert className="skill-conflict"><AlertDescription><p>已有同名 Skill，覆盖将替换正文和文件。</p><Button type="button" disabled={busy} onClick={() => void importUrl('overwrite')}>覆盖原条目</Button><Button type="button" disabled={busy} onClick={() => void importUrl('rename')}>重命名副本</Button><Button type="button" disabled={busy} onClick={() => void importUrl('skip')}>跳过</Button></AlertDescription></Alert>}
            <footer className="modal-footer"><Button type="button" disabled={busy} onClick={() => { setImporting(false); resetImport(); }}>取消</Button><Button variant="default" disabled={busy || !url.trim() || Boolean(importSource && !importSelected.length)}>{busy ? '导入中…' : importSource ? `${importOutcomes.length ? '重试所选' : '导入所选'}（${importSelected.length}）` : '导入'}</Button></footer>
        </form></SkillDialog>}
        {newFile && <SkillDialog title="新增文件" description="为当前 Skill 添加纯文本参考文件。" busy={busy} close={() => setNewFile(false)}><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void act(async () => { const path = String(data.get('path')); if (skill?.files?.some(file => file.path === path)) throw new Error('文件已存在，请从文件树编辑'); apply(await api('/skills/' + id + '/files', 'PUT', { path, content: data.get('content') })); setNewFile(false); setPath(path); }); }}><Label>文件路径<Input name="path" required placeholder="references/example.md"/></Label><Label>新文件正文<Textarea aria-label="新文件正文" name="content" rows={12}/></Label>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button variant="default" disabled={busy}>创建文件</Button></form></SkillDialog>}
    </section>;
}
