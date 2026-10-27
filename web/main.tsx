import { createRoot } from 'react-dom/client';
import { useEffect, useState, type FormEvent } from 'react';
import './style.css';
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
    kind: Exclude<View, 'mcp'> | 'links' | 'todos';
    data: Partial<Entry>;
};
const labels = { projects: '项目', agents: 'Agent 模板', skills: 'Skill 库', mcp: 'MCP 接入' };
const categories: Record<string, string> = { github: 'GitHub', gitee: 'Gitee', dingtalk: '钉钉', feishu: '飞书', other: '其他' };
let csrf = '';
async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok)
        throw new Error(value.error ?? '请求失败');
    return value;
}
function App() {
    const [user, setUser] = useState<{
        email: string;
    } | null>(null);
    const [booting, setBooting] = useState(true);
    const [error, setError] = useState('');
    const [view, setView] = useState<View>('projects');
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
    const [tokens, setTokens] = useState<{
        id: string;
        name: string;
        created_at: string;
    }[]>([]);
    const [newToken, setNewToken] = useState('');
    const [passwordDialog, setPasswordDialog] = useState(false);
    const [notice, setNotice] = useState('');
    useEffect(() => { api('/me').then(value => { csrf = value.csrf; setUser(value.user); }).catch(() => { }).finally(() => setBooting(false)); }, []);
    useEffect(() => {
        let active = true;
        if (!user)
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
    }, [user, view, projectId, query]);
    useEffect(() => {
        if (!editor && !detail && !passwordDialog)
            return;
        const previous = document.activeElement as HTMLElement | null;
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select,a[href]') ?? []);
        focusable()[0]?.focus();
        function handleKey(event: KeyboardEvent) {
            if (event.key === 'Escape' && !busy) {
                setEditor(null);
                setDetail(null);
                setPasswordDialog(false);
            }
            if (event.key === 'Tab') {
                const elements = focusable();
                const first = elements[0];
                const last = elements.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        }
        document.addEventListener('keydown', handleKey);
        return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
    }, [editor, detail, passwordDialog, busy]);
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
        if (!confirm(kind === 'projects' ? '永久删除此项目及其全部链接和 Todo？团队模板与 Skill 不受影响。' : '永久删除此条目？'))
            return;
        await act(async () => { await api(`/${kind}/${entry.id}`, 'DELETE'); if (kind === 'projects')
            navigate('projects');
        else {
            setDetail(null);
            await refresh();
        } });
    }
    async function copy(value: string) { try {
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
        return <main className="login"><section className="login-story"><a className="brand" href="/">xteam<span>·</span></a><div><p className="eyebrow">A SMALL SPACE FOR BIG IDEAS</p><h1>团队上下文，<br />放在一起。</h1><p>项目、指令与行动清单。<br />留在一个简单、共享的空间里。</p></div><small>为人和 AI 准备的团队资源空间</small></section><section className="login-panel"><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { const value = await api('/login', 'POST', Object.fromEntries(form)); csrf = value.csrf; setUser(value.user); }); }}><p className="eyebrow">WELCOME BACK</p><h2>登录 XTEAM</h2><p className="muted">使用管理员为你开通的团队账号。</p><label>邮箱<input name="email" type="email" autoComplete="username" required autoFocus/></label><label>密码<input name="password" type="password" autoComplete="current-password" required maxLength={256}/></label>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button><p className="footnote">仅限已开通账号 · 忘记密码请联系管理员</p></form></section></main>;
    const currentProject = context?.project;
    return <div className="workspace"><aside className="sidebar"><a className="brand" href="#projects" onClick={() => navigate('projects')}>xteam<span>·</span></a><div className="space-label"><span className="space-icon">X</span><div><strong>团队空间</strong><small>SHARED WORKSPACE</small></div></div><nav aria-label="主导航">{(Object.keys(labels) as View[]).map((key, index) => <a key={key} href={'#' + key} className={view === key ? 'active' : ''} onClick={event => { event.preventDefault(); navigate(key); }}><span aria-hidden="true">{['▧', '◇', '▤', '↗'][index]}</span>{labels[key]}</a>)}</nav><div className="sidebar-bottom"><small title={user.email}>{user.email}</small><div><button className="text" onClick={() => setPasswordDialog(true)}>修改密码</button><button className="text" onClick={() => void act(async () => { await api('/logout', 'POST'); setUser(null); setNewToken(''); csrf = ''; })}>退出登录</button></div></div></aside><main className="main"><header className="topbar"><span>团队空间 <span className="slash">/</span> {labels[view]}{projectId && ' / 项目详情'}</span><span className="shared-dot">团队共享</span></header><div className="content">{error && <div className="error" role="alert">{error}<button className="text" onClick={() => setError('')}>关闭提示</button></div>}{notice && <p role="status" className="notice">{notice}</p>}
  {view !== 'mcp' && !projectId && <><div className="page-heading"><div><p className="eyebrow">{view === 'projects' ? 'KEEP THE CONTEXT' : 'REUSABLE KNOWLEDGE'}</p><h1>{labels[view]}</h1><p className="muted">{view === 'projects' ? '把背景、资料和下一步行动放在一起。' : view === 'agents' ? '可复制、可通过 MCP 读取的团队指令模板。' : '沉淀团队方法，让外部 AI 按需读取。'}</p></div><button className="primary" onClick={() => setEditor({ kind: view, data: {} })}>{view === 'projects' ? '新建项目' : '新建'}</button></div><div className="list-toolbar"><label className="search"><span aria-hidden="true">⌕</span><input aria-label="按名称查找" placeholder="按名称查找…" value={query} onChange={event => setQuery(event.target.value)}/></label><span className="muted">{items.length} 个条目</span></div>{loading ? <p className="muted">正在读取…</p> : items.length ? <div className="cards">{items.map(item => <article className="card" key={item.id}><div className="card-top"><span className="resource-icon">{view === 'projects' ? '▧' : view === 'agents' ? '◇' : '▤'}</span><button className="text" onClick={() => setEditor({ kind: view, data: item })}>编辑</button></div><button className="card-name" onClick={() => view === 'projects' ? openProject(item.id) : setDetail(item)}>{item.name}</button><p className="card-description">{item.description || '暂无简介'}</p><footer><small>{new Date(item.updated_at!).toLocaleDateString('zh-CN')}</small><span aria-hidden="true">↗</span></footer></article>)}</div> : <section className="empty"><span className="empty-icon">＋</span><h2>{query ? '没有找到匹配内容' : `创建第一${view === 'projects' ? '个项目' : '份资源'}`}</h2><p>{query ? '换一个名称试试。' : '从一个简单的条目开始，团队成员都能继续维护。'}</p>{!query && <button onClick={() => setEditor({ kind: view, data: {} })}>开始创建</button>}</section>}</>}
  {view === 'projects' && projectId && <>{loading || !currentProject ? <p>正在读取项目…</p> : <><button className="text back" onClick={() => navigate('projects')}>← 所有项目</button><div className="page-heading"><div><p className="eyebrow">PROJECT CONTEXT</p><h1>{currentProject.name}</h1></div><div className="actions"><button onClick={() => setEditor({ kind: 'projects', data: currentProject })}>编辑项目</button><button className="danger-text" onClick={() => void remove('projects', currentProject)}>删除项目</button></div></div><section className="intro"><h2>项目简介</h2><p className="prewrap">{currentProject.description || '添加简介，为团队和外部 AI 提供项目背景。'}</p><small className="muted">项目 ID：{currentProject.id}</small><button className="text" onClick={() => void copy(currentProject.id)}>复制 ID</button></section><div className="project-grid"><section className="panel"><div className="section-title"><h2>关联链接 <small>{context.links.length}</small></h2><button onClick={() => setEditor({ kind: 'links', data: { project_id: projectId } })}>添加链接</button></div>{context.links.length ? <ul className="link-list">{context.links.map(link => <li key={link.id}><div><span className="tag">{categories[link.category!]}</span><a href={link.url} target="_blank" rel="noopener noreferrer">{link.title} ↗</a><small>{link.url}</small></div><div className="actions"><button className="text" onClick={() => setEditor({ kind: 'links', data: link })}>编辑</button><button className="text danger-text" onClick={() => void remove('links', link)}>删除</button></div></li>)}</ul> : <p className="muted inset">还没有链接，添加文档或代码仓库入口。</p>}<p className="footnote inset">仅保存地址；私有文档仍需原平台访问权限。</p></section><section className="panel"><div className="section-title"><h2>Todo <small>{context.todos.filter(todo => todo.completed).length}/{context.todos.length}</small></h2><button onClick={() => setEditor({ kind: 'todos', data: { project_id: projectId, completed: false } })}>添加 Todo</button></div>{context.todos.length ? <ul className="todo-list">{context.todos.map(todo => <li key={todo.id} className={todo.completed ? 'completed' : ''}><input type="checkbox" aria-label={todo.title} checked={todo.completed} disabled={busy} onChange={event => void act(async () => { await api('/todos/' + todo.id, 'PATCH', { completed: event.target.checked }); await refresh(); })}/><div className="todo-body"><strong>{todo.title}</strong>{todo.description && <p className="prewrap">{todo.description}</p>}<div className="actions"><button className="text" onClick={() => setEditor({ kind: 'todos', data: todo })}>编辑 / 记录结果</button><button className="text danger-text" onClick={() => void remove('todos', todo)}>删除</button></div></div></li>)}</ul> : <p className="muted inset">添加下一步行动，完成后把结果留在这里。</p>}</section></div></>}</>}
  {view === 'mcp' && <><div className="page-heading"><div><p className="eyebrow">CONNECT YOUR TOOLS</p><h1>MCP 接入</h1><p className="muted">让外部 AI 读取团队上下文，并把工作结果带回来。</p></div></div><section className="intro"><h2>1. 连接地址</h2><code>{location.origin}/mcp</code><button onClick={() => void copy(location.origin + '/mcp')}>复制地址</button><p className="muted">Streamable HTTP · 使用个人令牌作为 Bearer 认证</p></section><section className="panel token-panel"><h2>2. 创建个人令牌</h2><p className="muted">令牌可读写全部团队业务资源。不要分享，泄露后立即撤销。</p><form className="inline-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const name = new FormData(form).get('name'); void act(async () => { const value = await api('/tokens', 'POST', { name }); setNewToken(value.token); form.reset(); await refresh(); }); }}><label>令牌名称<input name="name" required maxLength={100} placeholder="例如：我的开发工具"/></label><button className="primary" disabled={busy}>创建令牌</button></form>{newToken && <div className="token-secret"><strong>仅展示这一次，请立即保存。</strong><input aria-label="新令牌" readOnly value={newToken}/><button onClick={() => void copy(newToken)}>复制令牌</button><button className="text" onClick={() => setNewToken('')}>已保存，隐藏</button></div>}<ul className="token-list">{tokens.map(token => <li key={token.id}><div><strong>{token.name}</strong><small>{new Date(token.created_at).toLocaleDateString('zh-CN')}</small></div><button className="danger-text" disabled={busy} onClick={() => { if (confirm('撤销后，此令牌立即不能访问 MCP。继续？'))
        void act(async () => { await api('/tokens/' + token.id, 'DELETE'); setNewToken(''); await refresh(); }); }}>撤销</button></li>)}</ul></section><section className="intro"><h2>3. 在客户端配置</h2><p>适用于支持自定义 Authorization 请求头的 Streamable HTTP 客户端。MCP Inspector 可直接选择 HTTP、填写地址及认证头进行测试。</p><pre>{JSON.stringify({ mcpServers: { xteam: { type: 'streamable-http', url: location.origin + '/mcp', headers: { Authorization: 'Bearer <你的个人令牌>' } } } }, null, 2)}</pre><button onClick={() => void copy(JSON.stringify({ mcpServers: { xteam: { type: 'streamable-http', url: location.origin + '/mcp', headers: { Authorization: 'Bearer <你的个人令牌>' } } } }, null, 2))}>复制配置示例</button><p className="footnote">不同客户端字段可能不同；本版不提供 OAuth 登录。可先调用 list_projects，再调用 get_project_context，工作结束后用 update_todo 回写说明和完成状态。</p></section></>}
  </div></main>
  {editor && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="编辑条目" className="modal"><div className="modal-heading"><h2>{editor.data.id ? '编辑' : '新建'}{editor.kind === 'links' ? '链接' : editor.kind === 'todos' ? ' Todo' : labels[editor.kind]}</h2><button className="text" onClick={() => setEditor(null)}>取消</button></div><form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const fields = Object.fromEntries(form); void act(async () => { await api('/' + editor.kind + (editor.data.id ? '/' + editor.data.id : ''), editor.data.id ? 'PATCH' : 'POST', { ...editor.data, ...fields }); await refresh(); setEditor(null); }); }}>{editor.kind === 'links' || editor.kind === 'todos' ? <label>标题<input name="title" defaultValue={editor.data.title} required maxLength={200} autoFocus/></label> : <label>名称<input name="name" defaultValue={editor.data.name} required maxLength={200} autoFocus/></label>}{editor.kind === 'links' ? <><label>URL<input name="url" type="url" required defaultValue={editor.data.url} maxLength={4000}/></label><label>类别<select name="category" defaultValue={editor.data.category ?? 'other'}>{Object.entries(categories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></> : <label>{editor.kind === 'todos' ? '说明 / 结果' : '简介'}<textarea name="description" defaultValue={editor.data.description} rows={editor.kind === 'todos' ? 6 : 3} maxLength={50000}/></label>}{(editor.kind === 'agents' || editor.kind === 'skills') && <label>正文<textarea className="code-input" name="content" defaultValue={editor.data.content} rows={12} maxLength={100000}/></label>}{error && <p className="error" role="alert">{error}</p>}<footer className="modal-footer"><button type="button" onClick={() => setEditor(null)}>取消</button><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></footer></form></section></div>}
  {detail && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="资源详情" className="modal wide"><div className="modal-heading"><h2>{detail.name}</h2><button onClick={() => setDetail(null)}>关闭</button></div><p className="prewrap muted">{detail.description}</p><pre className="resource-content">{detail.content || '暂无正文'}</pre><footer className="modal-footer"><button className="danger-text" onClick={() => void remove(view as 'agents' | 'skills', detail)}>删除</button><button onClick={() => { setEditor({ kind: view as 'agents' | 'skills', data: detail }); setDetail(null); }}>编辑</button><button className="primary" onClick={() => void copy(detail.content ?? '')}>复制正文</button></footer><small className="muted">仅保存文本，不执行或安装任何程序。</small></section></div>}
  {passwordDialog && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="修改密码" className="modal"><h2>修改密码</h2><form onSubmit={event => { event.preventDefault(); const fields = Object.fromEntries(new FormData(event.currentTarget)); void act(async () => { await api('/password', 'POST', fields); setPasswordDialog(false); setUser(null); setNotice('密码已更新，请重新登录'); }); }}><label>当前密码<input name="current" type="password" autoComplete="current-password" required/></label><label>新密码<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required/></label><p className="footnote">至少 12 个字符。保存后所有网页登录会话失效，需重新登录。</p>{error && <p className="error" role="alert">{error}</p>}<footer className="modal-footer"><button type="button" onClick={() => setPasswordDialog(false)}>取消</button><button className="primary" disabled={busy}>保存密码</button></footer></form></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
