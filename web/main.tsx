import { createRoot } from 'react-dom/client';
import { useEffect, useState, lazy, Suspense, type FormEvent } from 'react';
import './theme.css';
import './style.css';
import { Button as ShadcnButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { FieldLabel as Label } from './components/app-ui';
import { Checkbox } from './components/ui/checkbox';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Alert, AlertDescription } from './components/ui/alert';
import { SidebarProvider, SidebarInset, SidebarTrigger } from './components/ui/sidebar';
import { AppSidebar } from './components/app-sidebar';
import { AppDialog, Choice, ConfirmationProvider, useConfirmation } from './components/app-ui';
import { FolderKanban, Bot, Search, ArrowUpRight, Plus, Layers } from 'lucide-react';
function Button(props: React.ComponentProps<typeof ShadcnButton>) { return <ShadcnButton type="button" variant="outline" {...props}/>; }
const Skills = lazy(() => import('./skills.js').then(module => ({ default: module.Skills })));
type Entry = {
    id: string;
    name?: string;
    title?: string;
    description?: string;
    content?: string;
    url?: string;
    category?: string;
    project_id?: string;
    completed?: boolean;
    updated_at?: string;
};
type View = 'projects' | 'agents' | 'skills' | 'mcp';
type Editor = {
    kind: Exclude<View, 'mcp' | 'skills'> | 'links' | 'todos';
    data: Partial<Entry>;
};
const labels = { projects: '项目', agents: 'Agent 模板', skills: 'Skill 库', mcp: 'MCP 接入' };
const categories: Record<string, string> = { github: 'GitHub', gitee: 'Gitee', dingtalk: '钉钉', feishu: '飞书', other: '其他' };
let csrf = '';
async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok)
        throw Object.assign(new Error(value.error ?? value.reason ?? '请求失败'), { data: value });
    return value;
}
function App() {
    const confirm = useConfirmation();
    const [category, setCategory] = useState("other");
    const [user, setUser] = useState<{
        email: string;
    } | null>(null);
    const [booting, setBooting] = useState(true);
    const [error, setError] = useState('');
    const [view, setView] = useState<View>(location.hash.startsWith('#skill') ? 'skills' : 'projects');
    const [projectId, setProjectId] = useState<string | null>(location.hash.startsWith('#project/') ? location.hash.slice(9) : null);
    const [items, setItems] = useState<Entry[]>([]);
    const [query, setQuery] = useState('');
    const [context, setContext] = useState<{
        project: Entry;
        links: Entry[];
        todos: Entry[];
    } | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [detail, setDetail] = useState<Entry | null>(null);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [todoFilter, setTodoFilter] = useState('all');
    const [tokens, setTokens] = useState<{
        id: string;
        name: string;
        created_at: string;
    }[]>([]);
    const [newToken, setNewToken] = useState('');
    const [passwordDialog, setPasswordDialog] = useState(false);
    const [notice, setNotice] = useState('');
    useEffect(() => { setTodoFilter('all'); }, [projectId]);
    useEffect(() => { api('/me').then(value => { csrf = value.csrf; setUser(value.user); }).catch(() => { }).finally(() => setBooting(false)); }, []);
    useEffect(() => {
        let active = true;
        if (!user || view === 'skills')
            return;
        setLoading(true);
        setError('');
        const load = view === 'mcp' ? api('/tokens') : view === 'projects' && projectId ? api(`/projects/${projectId}/context`) : api(`/${view}?q=${encodeURIComponent(query)}`);
        load.then(value => { if (!active)
            return; if (view === 'mcp')
            setTokens(value);
        else if (view === 'projects' && projectId)
            setContext(value);
        else
            setItems(value); }).catch(error => { if (active)
            setError(error.message); }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    }, [user, view, projectId, query, refreshVersion]);
    useEffect(() => { const sync = () => { if (location.hash.startsWith('#skill')) { setView('skills'); setProjectId(null); } else if (location.hash.startsWith('#project/')) { setView('projects'); setProjectId(location.hash.slice(9)); } else if (['#projects', '#agents', '#mcp'].includes(location.hash)) { setView(location.hash.slice(1) as View); setProjectId(null); } }; window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
    async function refresh() {
        if (view === 'mcp')
            setTokens(await api('/tokens'));
        else if (view === 'projects' && projectId)
            setContext(await api(`/projects/${projectId}/context`));
        else
            setItems(await api(`/${view}?q=${encodeURIComponent(query)}`));
    }
    async function act(work: () => Promise<void>) { setBusy(true); setError(''); try {
        await work();
    }
    catch (error) {
        setError((error as Error).message);
    }
    finally {
        setBusy(false);
    } }
    function navigate(next: View) { setView(next); setQuery(''); setProjectId(null); setContext(null); setDetail(null); setNewToken(''); location.hash = next; }
    function openProject(id: string) { setContext(null); setProjectId(id); location.hash = 'project/' + id; }
    async function remove(kind: Editor['kind'], entry: Entry) {
        if (!await confirm(kind === 'projects' ? '永久删除此项目及其全部链接和 Todo？团队模板与 Skill 不受影响。' : '永久删除此条目？'))
            return;
        await act(async () => { await api(`/${kind}/${entry.id}`, 'DELETE'); if (kind === 'projects')
            navigate('projects');
        else {
            setDetail(null);
            await refresh();
        } });
    }
    async function copy(value: string) { setNotice(''); setError(''); try {
        await navigator.clipboard.writeText(value);
        setNotice('已复制');
        setTimeout(() => setNotice(''), 2000);
    }
    catch {
        setError('复制失败，请选中文本手动复制');
    } }
    if (booting)
        return <main className="boot">正在打开团队空间…</main>;
    if (!user)
        return <main className="login"><section className="login-story"><a className="brand" href="/"><Layers className="size-6"/>xteam</a><div><p className="eyebrow">A SMALL SPACE FOR BIG IDEAS</p><h1>团队上下文，<br />放在一起。</h1><p>项目、指令与行动清单。<br />留在一个简单、共享的空间里。</p></div><small>为人和 AI 准备的团队资源空间</small></section><section className="login-panel"><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { const value = await api('/login', 'POST', Object.fromEntries(form)); csrf = value.csrf; setUser(value.user); }); }}><p className="eyebrow">WELCOME BACK</p><h2>登录 XTEAM</h2><p className="muted">使用管理员为你开通的团队账号。</p><Label>邮箱<Input name="email" type="email" autoComplete="username" required autoFocus/></Label><Label>密码<Input name="password" type="password" autoComplete="current-password" required maxLength={256}/></Label>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button type="submit" variant="default" disabled={busy}>{busy ? '登录中…' : '登录'}</Button><p className="footnote">仅限已开通账号 · 忘记密码请联系管理员</p></form></section></main>;
    const currentProject = context?.project;
    const visibleTodos = context?.todos.filter(todo => todoFilter === 'all' || todo.completed === (todoFilter === 'completed')) ?? [];
    const contextText = context ? [
        `# ${context.project.name}`,
        `项目 ID：${context.project.id}`,
        '## 项目简介', context.project.description || '未填写',
        '## 关联链接', context.links.length ? context.links.map(link => `- ${link.title}：${link.url}`).join('\n') : '暂无链接',
        '## Todo', context.todos.length ? context.todos.map(todo => `- [${todo.completed ? 'x' : ' '}] ${todo.title}${todo.description ? '\n' + todo.description.split('\n').map(line => '  ' + line).join('\n') : ''}`).join('\n') : '暂无 Todo',
    ].join('\n\n') : '';
    return <SidebarProvider><AppSidebar view={view} email={user.email} navigate={navigate} password={() => setPasswordDialog(true)} logout={() => void act(async () => { await api('/logout', 'POST'); setUser(null); setNewToken(''); csrf = ''; })}/><SidebarInset className="min-w-0"><header className="topbar"><SidebarTrigger aria-label="切换侧边栏"/><span>团队空间 <span className="slash">/</span> {labels[view]}{projectId && ' / 项目详情'}</span><Badge variant="secondary" className="ml-auto">团队共享</Badge></header><div className="content">{error && <Alert variant="destructive"><AlertDescription>{error}<Button variant="ghost" size="sm" onClick={() => setError('')}>关闭提示</Button></AlertDescription></Alert>}{notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
  {view === 'skills' && <Suspense fallback={<p>正在打开 Skill 库…</p>}><Skills api={api}/></Suspense> }
  {view !== 'mcp' && view !== 'skills' && !projectId && <><div className="page-heading"><div><p className="eyebrow">{view === 'projects' ? 'KEEP THE CONTEXT' : 'REUSABLE KNOWLEDGE'}</p><h1>{labels[view]}</h1><p className="muted">{view === 'projects' ? '把背景、资料和下一步行动放在一起。' : view === 'agents' ? '可复制、可通过 MCP 读取的团队指令模板。' : '沉淀团队方法，让外部 AI 按需读取。'}</p></div><Button variant="default" onClick={() => setEditor({ kind: view, data: {} })}>{view === 'projects' ? '新建项目' : '新建'}</Button></div><div className="list-toolbar"><Label className="search"><Search className="size-4" aria-hidden="true"/><Input className="pl-9" aria-label="按名称查找" placeholder="按名称查找…" value={query} onChange={event => setQuery(event.target.value)}/></Label><span className="muted">{items.length} 个条目</span></div>{loading ? <p className="muted">正在读取…</p> : items.length ? <div className="cards">{items.map(item => <Card className="resource-card" key={item.id}><div className="card-top"><span className="resource-icon">{view === 'projects' ? <FolderKanban/> : <Bot/>}</span><Button variant="ghost" size="sm" onClick={() => setEditor({ kind: view, data: item })}>编辑</Button></div><Button variant="ghost" className="card-name h-auto p-0 text-base" onClick={() => view === 'projects' ? openProject(item.id) : setDetail(item)}>{item.name}</Button><p className="card-description">{item.description || '暂无简介'}</p><footer><small>{new Date(item.updated_at!).toLocaleDateString('zh-CN')}</small><ArrowUpRight className="size-4" aria-hidden="true"/></footer></Card>)}</div> : <Card className="empty"><Plus className="size-6" aria-hidden="true"/><h2>{query ? '没有找到匹配内容' : `创建第一${view === 'projects' ? '个项目' : '份资源'}`}</h2><p>{query ? '换一个名称试试。' : '从一个简单的条目开始，团队成员都能继续维护。'}</p>{!query && <Button onClick={() => setEditor({ kind: view, data: {} })}>开始创建</Button>}</Card>}</>}
  {view === 'projects' && projectId && <><Button variant="ghost" className="back" onClick={() => navigate('projects')}>← 所有项目</Button>{loading ? <p>正在读取项目…</p> : !currentProject || currentProject.id !== projectId ? <section><p>未能读取项目。</p><Button disabled={busy} onClick={() => setRefreshVersion(version => version + 1)}>重试</Button></section> : <><div className="page-heading"><div><p className="eyebrow">PROJECT CONTEXT</p><h1>{currentProject.name}</h1></div><div className="actions"><Button disabled={busy} onClick={() => setRefreshVersion(version => version + 1)}>刷新项目</Button><Button onClick={() => void copy(contextText)}>复制项目上下文</Button><Button onClick={() => setEditor({ kind: 'projects', data: currentProject })}>编辑项目</Button><Button variant="ghost" className="text-destructive" onClick={() => void remove('projects', currentProject)}>删除项目</Button></div></div><Card className="intro"><h2>项目简介</h2><p className="prewrap">{currentProject.description || '添加简介，为团队和外部 AI 提供项目背景。'}</p><small className="muted">项目 ID：{currentProject.id}</small><Button variant="ghost" size="sm" onClick={() => void copy(currentProject.id)}>复制 ID</Button></Card><div className="project-grid"><Card className="panel"><div className="section-title"><h2>关联链接 <small>{context.links.length}</small></h2><Button onClick={() => { setCategory('other'); setEditor({ kind: 'links', data: { project_id: projectId } }); }}>添加链接</Button></div>{context.links.length ? <ul className="link-list">{context.links.map(link => <li key={link.id}><div><Badge variant="secondary">{categories[link.category!]}</Badge><a href={link.url} target="_blank" rel="noopener noreferrer">{link.title} ↗</a><small>{link.url}</small></div><div className="actions"><Button variant="ghost" size="sm" onClick={() => { setCategory(link.category ?? 'other'); setEditor({ kind: 'links', data: link }); }}>编辑</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove('links', link)}>删除</Button></div></li>)}</ul> : <p className="muted inset">还没有链接，添加文档或代码仓库入口。</p>}<p className="footnote inset">仅保存地址；私有文档仍需原平台访问权限。</p></Card><Card className="panel"><div className="section-title"><h2>Todo <small>{context.todos.filter(todo => todo.completed).length}/{context.todos.length}</small></h2><div className="actions"><Choice label="Todo 完成状态" value={todoFilter} onChange={setTodoFilter} options={[{ value: 'all', label: '全部' }, { value: 'incomplete', label: '未完成' }, { value: 'completed', label: '已完成' }]}/><Button onClick={() => setEditor({ kind: 'todos', data: { project_id: projectId, completed: false } })}>添加 Todo</Button></div></div>{visibleTodos.length ? <ul className="todo-list">{visibleTodos.map(todo => <li key={todo.id} className={todo.completed ? 'completed' : ''}><Checkbox aria-label={todo.title} checked={todo.completed} disabled={busy} onCheckedChange={checked => void act(async () => { await api('/todos/' + todo.id, 'PATCH', { completed: checked === true }); await refresh(); })}/><div className="todo-body"><strong>{todo.title}</strong>{todo.description && <p className="prewrap">{todo.description}</p>}<div className="actions"><Button variant="ghost" size="sm" onClick={() => setEditor({ kind: 'todos', data: todo })}>编辑 / 记录结果</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove('todos', todo)}>删除</Button></div></div></li>)}</ul> : <p className="muted inset">{todoFilter === 'incomplete' ? '没有未完成的 Todo。' : todoFilter === 'completed' ? '没有已完成的 Todo。' : '添加下一步行动，完成后把结果留在这里。'}</p>}</Card></div></>}</>}
  {view === 'mcp' && <><div className="page-heading"><div><p className="eyebrow">CONNECT YOUR TOOLS</p><h1>MCP 接入</h1><p className="muted">让外部 AI 读取团队上下文，并把工作结果带回来。</p></div></div><Card className="intro"><h2>1. 连接地址</h2><code>{location.origin}/mcp</code><Button onClick={() => void copy(location.origin + '/mcp')}>复制地址</Button><p className="muted">Streamable HTTP · 使用个人令牌作为 Bearer 认证</p></Card><Card className="panel token-panel"><h2>2. 创建个人令牌</h2><p className="muted">令牌可读写全部团队业务资源。不要分享，泄露后立即撤销。</p><form className="inline-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const name = new FormData(form).get('name'); void act(async () => { const value = await api('/tokens', 'POST', { name }); setNewToken(value.token); form.reset(); await refresh(); }); }}><Label>令牌名称<Input name="name" required maxLength={100} placeholder="例如：我的开发工具"/></Label><Button type="submit" variant="default" disabled={busy}>创建令牌</Button></form>{newToken && <div className="token-secret"><strong>仅展示这一次，请立即保存。</strong><Input aria-label="新令牌" readOnly value={newToken}/><Button onClick={() => void copy(newToken)}>复制令牌</Button><Button variant="ghost" size="sm" onClick={() => setNewToken('')}>已保存，隐藏</Button></div>}<ul className="token-list">{tokens.map(token => <li key={token.id}><div><strong>{token.name}</strong><small>{new Date(token.created_at).toLocaleDateString('zh-CN')}</small></div><Button variant="ghost" className="text-destructive" disabled={busy} onClick={async () => { if (await confirm('撤销后，此令牌立即不能访问 MCP。继续？'))
        void act(async () => { await api('/tokens/' + token.id, 'DELETE'); setNewToken(''); await refresh(); }); }}>撤销</Button></li>)}</ul></Card><Card className="intro"><h2>3. 在客户端配置</h2><p>适用于支持自定义 Authorization 请求头的 Streamable HTTP 客户端。MCP Inspector 可直接选择 HTTP、填写地址及认证头进行测试。</p><pre>{JSON.stringify({ mcpServers: { xteam: { type: 'streamable-http', url: location.origin + '/mcp', headers: { Authorization: 'Bearer <你的个人令牌>' } } } }, null, 2)}</pre><Button onClick={() => void copy(JSON.stringify({ mcpServers: { xteam: { type: 'streamable-http', url: location.origin + '/mcp', headers: { Authorization: 'Bearer <你的个人令牌>' } } } }, null, 2))}>复制配置示例</Button><p className="footnote">不同客户端字段可能不同；本版不提供 OAuth 登录。可先调用 list_projects，再调用 get_project_context，工作结束后用 update_todo 回写说明和完成状态。</p></Card></>}
  </div></SidebarInset>
  {editor && <AppDialog name="编辑条目" title={(editor.data.id ? '编辑' : '新建') + (editor.kind === 'links' ? '链接' : editor.kind === 'todos' ? ' Todo' : labels[editor.kind])} busy={busy} close={() => setEditor(null)}><form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const fields = Object.fromEntries(form); void act(async () => { await api('/' + editor.kind + (editor.data.id ? '/' + editor.data.id : ''), editor.data.id ? 'PATCH' : 'POST', { ...editor.data, ...fields }); setEditor(null); try { await refresh(); } catch (error) { throw new Error(`已保存，但刷新失败：${(error as Error).message}。请刷新查看。`); } }); }}>{editor.kind === 'links' || editor.kind === 'todos' ? <Label>标题<Input name="title" defaultValue={editor.data.title} required maxLength={200} autoFocus/></Label> : <Label>名称<Input name="name" defaultValue={editor.data.name} required maxLength={200} autoFocus/></Label>}{editor.kind === 'links' ? <><Label>URL<Input name="url" type="url" required defaultValue={editor.data.url} maxLength={4000}/></Label><Label>类别<Choice label="类别" name="category" value={category} onChange={setCategory} options={Object.entries(categories).map(([value, label]) => ({ value, label }))}/></Label></> : <Label>{editor.kind === 'todos' ? '说明 / 结果' : '简介'}<Textarea aria-label={editor.kind === 'todos' ? '说明 / 结果' : '简介'} name="description" defaultValue={editor.data.description} rows={editor.kind === 'todos' ? 6 : 3} maxLength={50000}/></Label>}{editor.kind === 'agents' && <Label>正文<Textarea aria-label="正文" className="code-input" name="content" defaultValue={editor.data.content} rows={12} maxLength={100000}/></Label>}{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<footer className="modal-footer"><Button type="button" onClick={() => setEditor(null)}>取消</Button><Button type="submit" variant="default" disabled={busy}>{busy ? '保存中…' : '保存'}</Button></footer></form></AppDialog>}
  {detail && <AppDialog name="资源详情" title={detail.name ?? '资源详情'} wide busy={busy} close={() => setDetail(null)}><p className="prewrap muted">{detail.description}</p><pre className="resource-content">{detail.content || '暂无正文'}</pre><footer className="modal-footer"><Button variant="ghost" className="text-destructive" onClick={() => void remove(view as 'agents', detail)}>删除</Button><Button onClick={() => { setEditor({ kind: view as 'agents', data: detail }); setDetail(null); }}>编辑</Button><Button variant="default" onClick={() => void copy(detail.content ?? '')}>复制正文</Button></footer><small className="muted">仅保存文本，不执行或安装任何程序。</small></AppDialog>}
  {passwordDialog && <AppDialog name="修改密码" title="修改密码" description="保存后所有网页登录会话失效，需重新登录。" busy={busy} close={() => setPasswordDialog(false)}><form onSubmit={event => { event.preventDefault(); const fields = Object.fromEntries(new FormData(event.currentTarget)); void act(async () => { await api('/password', 'POST', fields); setPasswordDialog(false); setUser(null); setNotice('密码已更新，请重新登录'); }); }}><Label>当前密码<Input name="current" type="password" autoComplete="current-password" required/></Label><Label>新密码<Input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required/></Label><p className="footnote">至少 12 个字符。保存后所有网页登录会话失效，需重新登录。</p>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<footer className="modal-footer"><Button type="button" onClick={() => setPasswordDialog(false)}>取消</Button><Button type="submit" variant="default" disabled={busy}>保存密码</Button></footer></form></AppDialog>}
  </SidebarProvider>;
}
createRoot(document.getElementById('root')!).render(<ConfirmationProvider><App /></ConfirmationProvider>);
