import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, lazy, Suspense, type FormEvent } from 'react';
import './theme.css';
import './style.css';
import './themes.css';
import { ThemeChoice } from './components/theme-choice';
import { Button as ShadcnButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { FieldLabel as Label } from './components/app-ui';
import { Checkbox } from './components/ui/checkbox';
import { Card } from './components/ui/card';
import { Alert, AlertDescription } from './components/ui/alert';
import { SidebarProvider, SidebarInset, SidebarTrigger } from './components/ui/sidebar';
import { AppSidebar } from './components/app-sidebar';
import { AppDialog, Choice, ConfirmationProvider, useConfirmation } from './components/app-ui';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './components/ui/dropdown-menu';
import { FolderKanban, Bot, Search, ArrowUpRight, Layers } from 'lucide-react';
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
type Feedback = { message: string; failed?: boolean; fallback?: string };
const labels = { projects: '项目', agents: 'Agent 模板', skills: 'Skill 库', mcp: 'MCP 接入' };
const categories: Record<string, string> = { github: 'GitHub', gitee: 'Gitee', dingtalk: '钉钉', feishu: '飞书', other: '其他' };
let csrf = '';
async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('xteam-session-expired'));
    if (!response.ok)
        throw Object.assign(new Error(value.error ?? value.reason ?? '请求失败'), { data: value });
    return value;
}
function ActionFeedback({ value, testId, fallbackLabel }: { value?: Feedback; testId: string; fallbackLabel: string }) {
    if (!value) return null;
    return <div className="action-feedback" data-testid={testId} role={value.failed ? 'alert' : 'status'} aria-live="polite"><span>{value.message}</span>{value.fallback && <Textarea aria-label={fallbackLabel} readOnly value={value.fallback} rows={3} onFocus={event => event.currentTarget.select()}/>}</div>;
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
    const [sort, setSort] = useState('updated');
    const [lastRefreshed, setLastRefreshed] = useState('');
    const contextRead = useRef({ projectId: null as string | null, version: 0 });
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
    const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
    const [refreshing, setRefreshing] = useState(false);
    const [pendingTodoIds, setPendingTodoIds] = useState<string[]>([]);
    const [tokenPending, setTokenPending] = useState('');
    const focusNextPage = useRef(false);
    const newTokenRef = useRef<HTMLInputElement>(null);
    useEffect(() => { setTodoFilter('all'); setLastRefreshed(''); }, [projectId]);
    useEffect(() => { const expire = () => { setUser(null); setContext(null); setItems([]); setTokens([]); setEditor(null); setDetail(null); setNewToken(''); csrf = ''; }; window.addEventListener('xteam-session-expired', expire); return () => window.removeEventListener('xteam-session-expired', expire); }, []);
    useEffect(() => { api('/me').then(value => { csrf = value.csrf; setUser(value.user); }).catch(() => { }).finally(() => setBooting(false)); }, []);
    useEffect(() => {
        let active = true;
        const readVersion = ++contextRead.current.version;
        contextRead.current.projectId = user && view === 'projects' ? projectId : null;
        if (!user || view === 'skills')
            return;
        setLoading(true);
        setError('');
        const load = view === 'mcp' ? api('/tokens') : view === 'projects' && projectId ? api(`/projects/${projectId}/context`) : api(`/${view}?q=${encodeURIComponent(query)}`);
        load.then(value => { if (!active || readVersion !== contextRead.current.version)
            return; if (view === 'mcp')
            setTokens(value);
        else if (view === 'projects' && projectId)
            { setContext(value); setLastRefreshed(new Date().toLocaleTimeString('zh-CN', { hour12: false })); }
        else
            setItems(value); }).catch(error => { if (active && readVersion === contextRead.current.version)
            setError(error.message); }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    }, [user, view, projectId, query, refreshVersion]);
    useEffect(() => { const sync = () => { focusNextPage.current = true; if (location.hash.startsWith('#skill')) { setView('skills'); setProjectId(null); } else if (location.hash.startsWith('#project/')) { setView('projects'); setProjectId(location.hash.slice(9)); } else if (['#projects', '#agents', '#mcp'].includes(location.hash)) { setView(location.hash.slice(1) as View); setProjectId(null); } }; window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
    useEffect(() => { if (!focusNextPage.current || loading) return; const timer = window.setTimeout(() => { document.querySelector<HTMLElement>('#main-content h1')?.focus(); focusNextPage.current = false; }, 0); return () => window.clearTimeout(timer); }, [view, projectId, loading]);
    async function refresh() {
        if (view === 'mcp')
            setTokens(await api('/tokens'));
        else if (view === 'projects' && projectId) {
            if (contextRead.current.projectId !== projectId) return;
            const readVersion = ++contextRead.current.version;
            const value = await api(`/projects/${projectId}/context`);
            if (readVersion === contextRead.current.version) {
                setContext(value);
                setLastRefreshed(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
            }
        }
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
    function navigate(next: View) { focusNextPage.current = true; setView(next); setQuery(''); setProjectId(null); setContext(null); setDetail(null); setNewToken(''); setFeedback({}); location.hash = next; }
    function openProject(id: string) { focusNextPage.current = true; setContext(null); setProjectId(id); setFeedback({}); location.hash = 'project/' + id; }
    function openEditor(value: Editor) { setError(''); setEditor(value); }
    function closeEditor() { setError(''); setEditor(null); }
    async function remove(kind: Editor['kind'], entry: Entry) {
        const resource = kind === 'projects' ? '项目' : kind === 'links' ? '链接' : kind === 'todos' ? 'Todo' : 'Agent 模板';
        if (!await confirm({ title: `删除${resource}「${entry.name ?? entry.title}」？`, message: kind === 'projects' ? '永久删除此项目及其全部链接和 Todo？团队模板与 Skill 不受影响。' : '永久删除此条目？删除后无法恢复。', action: `删除${resource}`, destructive: true }))
            return;
        await act(async () => { await api(`/${kind}/${entry.id}`, 'DELETE'); if (kind === 'projects')
            navigate('projects');
        else {
            setDetail(null);
            await refresh();
        } });
    }
    async function copy(key: string, value: string, success = '已复制') { setNotice(''); setError(''); setFeedback(current => { const next = { ...current }; delete next[key]; return next; }); try {
        await navigator.clipboard.writeText(value);
        setFeedback(current => ({ ...current, [key]: { message: success } }));
    }
    catch {
        setFeedback(current => ({ ...current, [key]: { message: '复制失败，请使用下方文本手动复制。', failed: true, fallback: value } }));
    } }
    async function refreshProject() { setRefreshing(true); setFeedback(current => ({ ...current, refresh: { message: '正在刷新…' } })); try { await refresh(); setFeedback(current => ({ ...current, refresh: { message: `已刷新 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}` } })); } catch (error) { setFeedback(current => ({ ...current, refresh: { message: `刷新失败：${(error as Error).message}。已保留当前内容。`, failed: true } })); } finally { setRefreshing(false); } }
    async function toggleTodo(todo: Entry, completed: boolean) { if (pendingTodoIds.includes(todo.id)) return; setPendingTodoIds(ids => [...ids, todo.id]); setFeedback(current => ({ ...current, ['todo:' + todo.id]: { message: '保存中…' } })); try { await api('/todos/' + todo.id, 'PATCH', { completed }); await refresh(); setFeedback(current => ({ ...current, ['todo:' + todo.id]: { message: '状态已保存' } })); } catch (error) { setFeedback(current => ({ ...current, ['todo:' + todo.id]: { message: `保存失败：${(error as Error).message}`, failed: true } })); } finally { setPendingTodoIds(ids => ids.filter(id => id !== todo.id)); } }
    async function createToken(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const name = new FormData(form).get('name'); setTokenPending('create'); try { const value = await api('/tokens', 'POST', { name }); setNewToken(value.token); form.reset(); await refresh(); window.setTimeout(() => newTokenRef.current?.focus(), 0); } catch (error) { setFeedback(current => ({ ...current, tokenCreate: { message: (error as Error).message, failed: true } })); } finally { setTokenPending(''); } }
    async function revokeToken(token: { id: string; name: string }) { if (!await confirm({ title: `撤销令牌「${token.name}」？`, message: '撤销后，此令牌立即不能访问 MCP。继续？', action: '撤销令牌', destructive: true })) return; setTokenPending(token.id); try { await api('/tokens/' + token.id, 'DELETE'); setNewToken(''); await refresh(); setFeedback(current => ({ ...current, tokenList: { message: `已撤销 ${token.name}` } })); } catch (error) { setFeedback(current => ({ ...current, tokenList: { message: (error as Error).message, failed: true } })); } finally { setTokenPending(''); } }
    if (booting)
        return <main className="boot">正在打开团队空间…</main>;
    if (!user)
        return <main className="login"><section className="login-story"><a className="brand" href="/"><Layers className="size-6"/>xteam</a><div><p className="eyebrow">A SMALL SPACE FOR BIG IDEAS</p><h1>团队上下文，<br />放在一起。</h1><p>项目、指令与行动清单。<br />留在一个简单、共享的空间里。</p></div><small>为人和 AI 准备的团队资源空间</small></section><section className="login-panel"><ThemeChoice/><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { const value = await api('/login', 'POST', Object.fromEntries(form)); csrf = value.csrf; setUser(value.user); }); }}><p className="eyebrow">WELCOME BACK</p><h2>登录 XTEAM</h2><p className="muted">使用管理员为你开通的团队账号。</p><Label>邮箱<Input name="email" type="email" autoComplete="username" required autoFocus/></Label><Label>密码<Input name="password" type="password" autoComplete="current-password" required maxLength={256}/></Label>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button type="submit" variant="default" disabled={busy}>{busy ? '登录中…' : '登录'}</Button><p className="footnote">仅限已开通账号 · 忘记密码请联系管理员</p></form></section></main>;
    const currentProject = context?.project;
    const sortedItems = [...items].sort((first, second) => sort === 'name'
        ? (first.name ?? '').localeCompare(second.name ?? '', 'zh-CN')
        : (second.updated_at ?? '').localeCompare(first.updated_at ?? '') || (first.name ?? '').localeCompare(second.name ?? '', 'zh-CN'));
    const visibleTodos = context?.todos.filter(todo => todoFilter === 'all' || todo.completed === (todoFilter === 'completed')) ?? [];
    const contextText = context ? [
        `# ${context.project.name}`,
        `项目 ID：${context.project.id}`,
        '## 项目简介', context.project.description || '未填写',
        '## 关联链接', context.links.length ? context.links.map(link => `- ${link.title}：${link.url}`).join('\n') : '暂无链接',
        '## Todo', context.todos.length ? context.todos.map(todo => `- [${todo.completed ? 'x' : ' '}] ${todo.title}${todo.description ? '\n' + todo.description.split('\n').map(line => '  ' + line).join('\n') : ''}`).join('\n') : '暂无 Todo',
    ].join('\n\n') : '';
    return <SidebarProvider><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a><AppSidebar view={view} email={user.email} navigate={navigate} password={() => setPasswordDialog(true)} logout={() => void act(async () => { await api('/logout', 'POST'); setUser(null); setNewToken(''); csrf = ''; })}/><SidebarInset className="min-w-0 bg-card"><header className="topbar"><SidebarTrigger aria-label="切换侧边栏"/><nav aria-label="当前位置" className="breadcrumb"><span>团队空间</span><span className="slash">/</span><a aria-label={'返回' + labels[view] + '列表'} href={'#' + view} onClick={event => { event.preventDefault(); navigate(view); }}>{labels[view]}</a>{projectId && <><span className="slash">/</span><span aria-current="page">{currentProject?.id === projectId ? currentProject.name : '项目详情'}</span></>}</nav><ThemeChoice/></header><div className="content" id="main-content" tabIndex={-1}>{error && <Alert variant="destructive"><AlertDescription>{error}<Button variant="ghost" size="sm" onClick={() => setError('')}>关闭提示</Button>{!projectId && <Button disabled={loading} onClick={() => setRefreshVersion(version => version + 1)}>重试</Button>}</AlertDescription></Alert>}{notice && !(view === 'projects' && projectId) && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
  {view === 'skills' && <Suspense fallback={<p>正在打开 Skill 库…</p>}><Skills api={api}/></Suspense> }
  {view !== 'mcp' && view !== 'skills' && !projectId && <>
    <div className="page-heading"><div><h1 tabIndex={-1}>{labels[view]}</h1><p className="muted">{view === 'projects' ? '把项目背景、资料和 Todo 放在一起。' : '可复制、可通过 MCP 读取的团队指令模板。'}</p></div><Button variant="default" onClick={() => openEditor({ kind: view, data: {} })}>{view === 'projects' ? '新建项目' : '新建 Agent 模板'}</Button></div>
    <div className="list-toolbar"><Label className="search"><Search className="size-4" aria-hidden="true"/><Input className="pl-9" aria-label="按名称查找" placeholder="按名称查找…" value={query} onChange={event => setQuery(event.target.value)}/></Label><div className="actions">{view === 'projects' && (items.length > 0 || query) && <Choice label="项目排序" value={sort} onChange={setSort} options={[{ value: 'updated', label: '项目信息更新时间' }, { value: 'name', label: '名称 A–Z' }]}/>}<span className="muted">{items.length} 个{view === 'agents' ? ' Agent 模板' : '项目'}</span></div></div>
    {view === 'projects' && items.length > 0 && <p className="footnote">项目信息时间仅反映名称和简介的修改，不包含 Todo 或链接变更。</p>}
    {loading ? <div className="loading-state" role="status"><p>正在读取…</p><div className="loading-line"/><div className="loading-line"/></div> : items.length ? <div className="resource-directory">{sortedItems.map(item => <Card className="resource-card resource-row" key={item.id}>
      <span className="resource-icon">{view === 'projects' ? <FolderKanban/> : <Bot/>}</span><div className="resource-summary"><Button variant="ghost" className="card-name" onClick={() => view === 'projects' ? openProject(item.id) : setDetail(item)}>{item.name}</Button><p className="card-description">{item.description || '暂无简介'}</p></div>
      <time className="resource-time" dateTime={item.updated_at}>{item.updated_at ? new Date(item.updated_at).toLocaleString('zh-CN', { hour12: false }) : ''}</time><div className="actions"><Button variant="ghost" size="sm" aria-label={view === 'agents' ? `编辑 Agent 模板 ${item.name}` : `编辑项目 ${item.name}`} onClick={() => openEditor({ kind: view, data: item })}>编辑{view === 'agents' ? ' Agent 模板' : '项目'}</Button><Button aria-label={view === 'agents' ? `打开 Agent 模板 ${item.name}` : `打开项目 ${item.name}`} onClick={() => view === 'projects' ? openProject(item.id) : setDetail(item)}>打开{view === 'agents' ? ' Agent 模板' : '项目'}<ArrowUpRight aria-hidden="true"/></Button></div>
    </Card>)}</div> : <Card className="empty"><FolderKanban aria-hidden="true"/><h2>{query ? `没有匹配的${view === 'agents' ? ' Agent 模板' : '项目'}` : '还没有' + labels[view]}</h2><p>{query ? '试试其他名称，或清除搜索。' : view === 'projects' ? '新建项目，把背景、资料与 Todo 留在一起。' : '新建 Agent 模板，保存可复用的团队指令。'}</p>{query && <Button onClick={() => setQuery('')}>清除搜索</Button>}</Card>}
  </>}
  {view === 'projects' && projectId && <>
    <Button variant="ghost" className="back" onClick={() => navigate('projects')}>← 所有项目</Button>
    {loading && currentProject?.id !== projectId ? <div className="loading-state" role="status"><p>正在读取项目…</p><div className="loading-line"/></div> : !currentProject || currentProject.id !== projectId ? <section><p>未能读取项目。</p><Button disabled={busy} onClick={() => setRefreshVersion(version => version + 1)}>重试</Button></section> : <>
      <section className="project-overview">
        <div className="page-heading"><h1 tabIndex={-1}>{currentProject.name}</h1><div className="actions"><Button variant="default" onClick={() => void copy('context', contextText, '项目上下文已复制')}>复制项目上下文</Button><Button disabled={busy || loading || refreshing} onClick={() => void refreshProject()}>{refreshing ? '刷新中…' : '刷新项目'}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="更多项目操作">更多</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => openEditor({ kind: 'projects', data: currentProject })}>编辑项目</DropdownMenuItem><DropdownMenuItem onSelect={() => void remove('projects', currentProject)}>删除项目</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
        <p className="prewrap project-description">{currentProject.description || '添加简介，为团队和外部 AI 提供项目背景。'}</p><div className="project-meta"><span>项目信息更新于 {currentProject.updated_at ? new Date(currentProject.updated_at).toLocaleString('zh-CN', { hour12: false }) : '未知'}</span><span data-testid="last-refreshed">上次刷新：{lastRefreshed || '尚未读取'}</span></div>
        <p className="footnote">复制内容包括项目简介、全部关联链接和全部 Todo（含已完成任务及结果）。</p><ActionFeedback value={feedback.context} testId="context-feedback" fallbackLabel="项目上下文手动复制"/><ActionFeedback value={feedback.refresh} testId="refresh-feedback" fallbackLabel="刷新结果"/>
      </section>
      <div className="project-grid">
        <section className="todo-panel" aria-label="Todo"><div className="section-title"><h2>Todo <small>{context.todos.filter(todo => todo.completed).length}/{context.todos.length} 已完成</small></h2><Button onClick={() => openEditor({ kind: 'todos', data: { project_id: projectId, completed: false } })}>添加 Todo</Button></div>
          <div className="todo-toolbar"><Choice label="Todo 完成状态" value={todoFilter} onChange={setTodoFilter} options={[{ value: 'all', label: '全部' }, { value: 'incomplete', label: '未完成' }, { value: 'completed', label: '已完成' }]}/></div>
          {visibleTodos.length ? <ul className="todo-list">{visibleTodos.map(todo => <li key={todo.id} className={todo.completed ? 'completed' : ''}><label className="todo-check"><Checkbox aria-label={todo.title} checked={todo.completed} disabled={pendingTodoIds.includes(todo.id)} onCheckedChange={checked => void toggleTodo(todo, checked === true)}/></label><div className="todo-body"><strong>{todo.title}</strong>{todo.description && <p className="prewrap">{todo.description}</p>}<div className="actions"><small className="muted">{todo.completed ? '已完成' : '未完成'}</small><Button variant="ghost" size="sm" onClick={() => openEditor({ kind: 'todos', data: todo })}>编辑 / 记录结果</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove('todos', todo)}>删除</Button></div><ActionFeedback value={feedback['todo:' + todo.id]} testId={`todo-feedback-${todo.id}`} fallbackLabel="Todo 状态"/></div></li>)}</ul> : <p className="muted inset">{todoFilter === 'incomplete' ? '没有未完成的 Todo。' : todoFilter === 'completed' ? '没有已完成的 Todo。' : '添加下一步行动，完成后把结果留在这里。'}</p>}
        </section>
        <aside className="project-resources" aria-label="项目资料"><section><div className="section-title"><h2>关联链接 <small>{context.links.length}</small></h2><Button onClick={() => { setCategory('other'); openEditor({ kind: 'links', data: { project_id: projectId } }); }}>添加链接</Button></div>{context.links.length ? <ul className="link-list">{context.links.map(link => <li key={link.id}><div className="link-summary"><a href={link.url} target="_blank" rel="noopener noreferrer">{link.title} ↗</a><small>{categories[link.category!]}</small><code>{link.url}</code><ActionFeedback value={feedback['link:' + link.id]} testId={`link-feedback-${link.id}`} fallbackLabel={`${link.title} 链接手动复制`}/></div><div className="actions"><Button variant="ghost" size="sm" aria-label={`复制链接 ${link.title}`} onClick={() => void copy('link:' + link.id, link.url!, '链接已复制')}>复制 URL</Button><Button variant="ghost" size="sm" onClick={() => { setCategory(link.category ?? 'other'); openEditor({ kind: 'links', data: link }); }}>编辑</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove('links', link)}>删除</Button></div></li>)}</ul> : <p className="muted inset">还没有链接，添加文档或代码仓库入口。</p>}<p className="footnote">仅保存地址；私有文档仍需原平台访问权限。</p></section><section className="project-identity"><h2>项目 ID</h2><p className="prewrap code-input">{currentProject.id}</p><Button variant="ghost" size="sm" onClick={() => void copy('projectId', currentProject.id, '项目 ID 已复制')}>复制 ID</Button><ActionFeedback value={feedback.projectId} testId="project-id-feedback" fallbackLabel="项目 ID 手动复制"/></section></aside>
      </div>
    </>}
  </>}
  {view === 'mcp' && <><div className="page-heading"><div><p className="eyebrow">CONNECT YOUR TOOLS</p><h1 tabIndex={-1}>MCP 接入</h1><p className="muted">让外部 AI 读取团队上下文，并把工作结果带回来。</p></div></div><Card className="intro"><h2>1. 连接地址</h2><code>{location.origin}/mcp</code><Button onClick={() => void copy('mcpAddress', location.origin + '/mcp', '连接地址已复制')}>复制地址</Button><ActionFeedback value={feedback.mcpAddress} testId="mcp-address-feedback" fallbackLabel="MCP 连接地址手动复制"/><p className="muted">Streamable HTTP · 使用个人令牌作为 Bearer 认证</p></Card><Card className="panel token-panel"><h2>2. 创建个人令牌</h2><p className="muted">令牌可读写全部团队业务资源。不要分享，泄露后立即撤销。</p><form className="inline-form" onSubmit={event => void createToken(event)}><Label>令牌名称<Input name="name" required maxLength={100} placeholder="例如：我的开发工具"/></Label><Button type="submit" variant="default" disabled={tokenPending === 'create'}>{tokenPending === 'create' ? '创建中…' : '创建令牌'}</Button></form><ActionFeedback value={feedback.tokenCreate} testId="token-create-feedback" fallbackLabel="令牌创建结果"/>{newToken && <div className="token-secret" aria-live="polite"><strong>仅展示这一次，请立即保存。</strong><Input ref={newTokenRef} aria-label="新令牌" readOnly value={newToken}/><Button onClick={() => void copy('mcpToken', newToken, '令牌已复制')}>复制令牌</Button><ActionFeedback value={feedback.mcpToken} testId="mcp-token-feedback" fallbackLabel="个人令牌手动复制"/><Button variant="ghost" size="sm" onClick={() => setNewToken('')}>已保存，隐藏</Button></div>}{tokens.length ? <ul className="token-list">{tokens.map(token => <li key={token.id}><div><strong>{token.name}</strong><small>创建于 {new Date(token.created_at).toLocaleString('zh-CN', { hour12: false })}</small><small>撤销后使用此令牌的客户端会立即断开。</small></div><Button variant="ghost" className="text-destructive" disabled={tokenPending === token.id} onClick={() => void revokeToken(token)}>{tokenPending === token.id ? '撤销中…' : '撤销'}</Button></li>)}</ul> : <p className="muted token-empty">尚未创建个人令牌。</p>}<ActionFeedback value={feedback.tokenList} testId="token-list-feedback" fallbackLabel="令牌操作结果"/></Card><Card className="intro mcp-config"><h2>3. 在客户端配置</h2><p>适用于支持自定义 Authorization 请求头的 Streamable HTTP 客户端。MCP Inspector 可直接选择 HTTP、填写地址及认证头进行测试。</p><pre>{JSON.stringify({ mcpServers: { xteam: { type: 'streamable-http', url: location.origin + '/mcp', headers: { Authorization: 'Bearer <你的个人令牌>' } } } }, null, 2)}</pre><Button onClick={() => void copy('mcpConfig', JSON.stringify({ mcpServers: { xteam: { type: 'streamable-http', url: location.origin + '/mcp', headers: { Authorization: 'Bearer <你的个人令牌>' } } } }, null, 2), '配置示例已复制')}>复制配置示例</Button><ActionFeedback value={feedback.mcpConfig} testId="mcp-config-feedback" fallbackLabel="MCP 配置示例手动复制"/><p className="footnote">不同客户端字段可能不同；本版不提供 OAuth 登录。可先调用 list_projects，再调用 get_project_context，工作结束后用 update_todo 回写说明和完成状态。</p></Card></>}
  </div></SidebarInset>
  {editor && <AppDialog name="编辑条目" title={(editor.data.id ? '编辑' : '新建') + (editor.kind === 'links' ? '链接' : editor.kind === 'todos' ? ' Todo' : labels[editor.kind])} description={editor.kind === 'projects' ? `${editor.data.id ? '更新' : '创建'}项目背景，供团队与外部 Agent 接续工作。` : editor.kind === 'todos' ? `${editor.data.completed ? '记录完成结果' : '说明下一步行动'}，内容会进入项目上下文。` : editor.kind === 'links' ? '保存项目相关文档或代码入口，不会抓取链接正文。' : '保存可复制、可通过 MCP 读取的团队指令正文。'} busy={busy} close={closeEditor}><form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const fields = Object.fromEntries(form); void act(async () => { await api('/' + editor.kind + (editor.data.id ? '/' + editor.data.id : ''), editor.data.id ? 'PATCH' : 'POST', { ...editor.data, ...fields }); closeEditor(); try { await refresh(); } catch (error) { throw new Error(`已保存，但刷新失败：${(error as Error).message}。请刷新查看。`); } }); }}>{editor.kind === 'links' || editor.kind === 'todos' ? <Label>标题<Input name="title" defaultValue={editor.data.title} required maxLength={200} autoFocus/></Label> : <Label>名称<Input name="name" defaultValue={editor.data.name} required maxLength={200} autoFocus/></Label>}{editor.kind === 'links' ? <><Label>URL<Input name="url" type="url" required defaultValue={editor.data.url} maxLength={4000}/></Label><Label>类别<Choice label="类别" name="category" value={category} onChange={setCategory} options={Object.entries(categories).map(([value, label]) => ({ value, label }))}/></Label></> : <Label>{editor.kind === 'todos' ? editor.data.completed ? '完成结果' : '行动说明' : '简介'}<Textarea aria-label={editor.kind === 'todos' ? editor.data.completed ? '完成结果' : '行动说明' : '简介'} name="description" defaultValue={editor.data.description} rows={editor.kind === 'todos' ? 6 : 3} maxLength={50000}/></Label>}{editor.kind === 'agents' && <Label>正文<Textarea aria-label="正文" className="code-input" name="content" defaultValue={editor.data.content} rows={12} maxLength={100000}/></Label>}{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<footer className="modal-footer"><Button type="button" disabled={busy} onClick={closeEditor}>取消</Button><Button type="submit" variant="default" disabled={busy}>{busy ? '保存中…' : '保存'}</Button></footer></form></AppDialog>}
  {detail && <AppDialog name="Agent 模板详情" title={detail.name ?? 'Agent 模板详情'} description="查看并复制团队指令；内容只作为纯文本保存，不会执行。" wide busy={busy} close={() => { setDetail(null); setFeedback(current => { const next = { ...current }; delete next.agent; return next; }); }}><p className="prewrap muted">{detail.description}</p><pre className="resource-content">{detail.content || '暂无正文'}</pre><ActionFeedback value={feedback.agent} testId="agent-copy-feedback" fallbackLabel="Agent 正文手动复制"/><footer className="modal-footer"><Button variant="ghost" className="text-destructive" onClick={() => void remove(view as 'agents', detail)}>删除 Agent 模板</Button><Button onClick={() => { openEditor({ kind: view as 'agents', data: detail }); setDetail(null); }}>编辑 Agent 模板</Button><Button variant="default" disabled={!detail.content} onClick={() => void copy('agent', detail.content ?? '', 'Agent 正文已复制')}>复制 Agent 正文</Button></footer><small className="muted">仅保存文本，不执行或安装任何程序。</small></AppDialog>}
  {passwordDialog && <AppDialog name="修改密码" title="修改密码" description="保存后所有网页登录会话失效，需重新登录。" busy={busy} close={() => setPasswordDialog(false)}><form onSubmit={event => { event.preventDefault(); const fields = Object.fromEntries(new FormData(event.currentTarget)); void act(async () => { await api('/password', 'POST', fields); setPasswordDialog(false); setUser(null); setNotice('密码已更新，请重新登录'); }); }}><Label>当前密码<Input name="current" type="password" autoComplete="current-password" required/></Label><Label>新密码<Input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required/></Label><p className="footnote">至少 12 个字符。保存后所有网页登录会话失效，需重新登录。</p>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<footer className="modal-footer"><Button type="button" disabled={busy} onClick={() => setPasswordDialog(false)}>取消</Button><Button type="submit" variant="default" disabled={busy}>保存密码</Button></footer></form></AppDialog>}
  </SidebarProvider>;
}
createRoot(document.getElementById('root')!).render(<ConfirmationProvider><App /></ConfirmationProvider>);
