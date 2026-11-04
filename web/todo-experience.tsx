import { useEffect, useState, type FormEvent } from 'react';
import { readExperiences, type Experience } from '../shared/todo-experience';
import { AppDialog, FieldLabel, useConfirmation } from './components/app-ui';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
type Todo = { id: string; project_id?: string; description?: string; updated_at?: string; completed?: boolean };
type Props = { todo: Todo; api: (path: string, method?: string, body?: unknown) => Promise<any>; onSaved: (todo: Todo) => void; onDirty: (dirty: boolean) => void };
export function TodoExperience({ todo, api, onSaved, onDirty }: Props) {
    const confirm = useConfirmation();
    const [action, setAction] = useState<'' | 'submit' | 'confirm' | 'revise'>('');
    const [draft, setDraft] = useState({ experience: '', applicability: '', verification: '', note: '' });
    const [version, setVersion] = useState(todo.updated_at);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [conflict, setConflict] = useState(false);
    const [latest, setLatest] = useState<Todo | null>(null);
    let records: Experience[] = [], invalid = '';
    try { records = readExperiences(todo.description || '', todo.project_id || '', todo.id); } catch (error) { invalid = (error as Error).message; }
    const current = records.at(-1);
    useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
    function open(next: 'submit' | 'confirm' | 'revise') {
        setAction(next); setDraft({ experience: current?.experience || '', applicability: current?.applicability || '', verification: current?.verification || '', note: '' });
        setVersion(todo.updated_at); setError(''); setConflict(false); setLatest(null); setDirty(false);
    }
    async function close() {
        if (busy || dirty && !await confirm({ title: '放弃未保存的修改？', message: '关闭后将丢失当前经验草稿。', action: '放弃修改' })) return;
        setAction(''); setDirty(false);
    }
    async function save(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError('');
        try { const saved = await api(`/projects/${todo.project_id}/todos/${todo.id}/experience`, 'POST', { action, ...(action === 'confirm' ? {} : { experience: draft.experience, applicability: draft.applicability, verification: draft.verification }), ...(action === 'submit' ? {} : { note: draft.note }), expected_updated_at: version }); onSaved(saved); setDirty(false); setAction(''); }
        catch (error) { setError((error as Error).message); setConflict((error as { status?: number }).status === 409); }
        finally { setBusy(false); }
    }
    async function readLatest() {
        setBusy(true);
        try { const value = await api(`/projects/${todo.project_id}/todos/${todo.id}/experience`); setLatest(value.todo); }
        catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    const title = action === 'submit' ? '提交经验' : action === 'confirm' ? '确认经验' : '修订经验';
    return <section aria-label="任务经验" className="grid min-w-0 gap-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2>任务经验</h2>{current && <span data-testid="experience-status">{current.status}</span>}</div>
        {invalid ? <p role="alert">{invalid}</p> : current ? <><div className="prewrap">{current.experience}</div><details><summary>{records.length} 条记录</summary>{records.map((record, index) => <div key={index} className="prewrap py-2"><p>{record.status} · {record.at}</p><p>{record.experience}</p><p>适用条件：{record.applicability}</p><p>验证结果：{record.verification}</p><p>{record.note}</p></div>)}</details><div className="flex flex-wrap gap-2">{current.status === '待确认' && <Button variant="outline" onClick={() => open('confirm')}>确认经验</Button>}<Button variant="outline" onClick={() => open('revise')}>修订经验</Button></div><p className="muted">已有经验，新增结论请修订</p></> : <><p>尚未提交经验</p><div><Button variant="outline" onClick={() => open('submit')}>提交经验</Button></div></>}
        {action && <AppDialog title={title} busy={busy} close={() => void close()} description="保留在来源任务的文本中；确认和修订均追加历史记录。"><form onSubmit={save} onChange={() => setDirty(true)}>
            {action !== 'confirm' ? (['experience', 'applicability', 'verification'] as const).map((field, index) => <FieldLabel key={field}>{['经验', '适用条件', '验证结果'][index]}<Textarea aria-label={['经验', '适用条件', '验证结果'][index]} value={draft[field]} required maxLength={10000} rows={4} onChange={event => setDraft(value => ({ ...value, [field]: event.target.value }))}/></FieldLabel>) : <pre className="resource-content">{draft.experience}</pre>}
            {action !== 'submit' && <FieldLabel>{action === 'confirm' ? '确认说明' : '修订说明'}<Textarea aria-label={action === 'confirm' ? '确认说明' : '修订说明'} value={draft.note} required maxLength={5000} rows={3} onChange={event => setDraft(value => ({ ...value, note: event.target.value }))}/></FieldLabel>}
            {error && <p role="alert">{error}</p>}{conflict && <section aria-label="合并最新经验"><Button type="button" variant="outline" disabled={busy} onClick={() => void readLatest()}>读取最新版本</Button>{latest && <><pre className="resource-content">{latest.description}</pre><Button type="button" variant="outline" onClick={() => { setVersion(latest.updated_at); setConflict(false); setError(''); }}>已核对并合并，使用最新版本</Button></>}</section>}
            <footer className="modal-footer"><Button type="button" variant="outline" disabled={busy} onClick={() => void close()}>取消</Button><Button disabled={busy} type="submit">{busy ? '保存中…' : action === 'submit' ? '提交待确认' : action === 'confirm' ? '确认并保留记录' : '保存修订，重新待确认'}</Button></footer>
        </form></AppDialog>}
    </section>;
}
