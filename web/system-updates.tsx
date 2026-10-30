import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { useConfirmation } from './components/app-ui';

type UpdateState = { phase: string; message: string; requestId?: string; available?: boolean; release?: { id: number; tag: string; sha: string } };
type UpdateView = { enabled: boolean; canUpgrade: boolean; currentVersion: string; state: UpdateState };
export function SystemUpdates({ visible, currentVersion, checkSignal, onVersion, api }: { visible: boolean; currentVersion: string; checkSignal: number; onVersion: (version: string) => void; api: (path: string, method?: string, body?: unknown) => Promise<any> }) {
    const confirm = useConfirmation();
    const [model, setModel] = useState<UpdateView | null>(null);
    const [error, setError] = useState('');
    const [working, setWorking] = useState(false);
    const pending = useRef(false), alive = useRef(true);
    const running = ['checking', 'upgrading'].includes(model?.state.phase ?? '');
    function accept(value: UpdateView) { if (!alive.current) return; setModel(value); onVersion(value.currentVersion); }
    async function read() { const value = await api('/updates') as UpdateView; accept(value); return value; }
    async function check() {
        if (pending.current) return;
        pending.current = true; setWorking(true); setError('');
        try {
            const value = await read();
            if (!value.canUpgrade || !value.enabled || ['checking', 'upgrading'].includes(value.state.phase)) return;
            const state = await api('/updates/check', 'POST', {});
            accept({ ...value, state });
        } catch (error) { if (alive.current) setError((error as Error).message); }
        finally { pending.current = false; if (alive.current) setWorking(false); }
    }
    async function refresh() { setError(''); try { await read(); } catch (error) { if (alive.current) setError((error as Error).message); } }
    async function upgrade() {
        const release = model?.state.release;
        if (pending.current || !release || !model?.state.available || !model.canUpgrade) return;
        pending.current = true; setWorking(true); setError('');
        try {
            if (!await confirm({ title: '升级到 ' + release.tag + '？', message: '目标提交 ' + release.sha.slice(0, 12) + '。升级会短暂中断服务，请先保存正在编辑的内容。', action: '确认升级' })) return;
            const state = await api('/updates/upgrade', 'POST', { releaseId: release.id, sha: release.sha });
            accept({ ...model, state });
        } catch (error) { if (alive.current) setError((error as Error).message); }
        finally { pending.current = false; if (alive.current) setWorking(false); }
    }
    useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
    useEffect(() => { if (checkSignal) void check(); }, [checkSignal]);
    useEffect(() => {
        if (!running) return;
        let active = true, unavailableSince = 0;
        let timer = 0;
        async function poll() {
            try { const value = await api('/updates') as UpdateView; if (!active) return; accept(value); setError(''); unavailableSince = 0; }
            catch { if (!active) return; unavailableSince ||= Date.now(); setError('服务连接正在恢复…'); if (Date.now() - unavailableSince > 120000) { setError('暂时无法读取升级结果，请刷新状态；不要重复发起升级。'); return; } }
            if (active) timer = window.setTimeout(poll, 2000);
        }
        timer = window.setTimeout(poll, 1000);
        return () => { active = false; window.clearTimeout(timer); };
    }, [model?.state.phase]);
    if (!visible) return null;
    const version = model?.currentVersion || currentVersion;
    return <section className="settings-page system-updates" aria-labelledby="system-updates-title"><h2 id="system-updates-title">系统更新</h2><div className="setting-row"><span>当前版本</span><code data-testid="current-version" title={version}>{version ? version === 'development' ? '开发版' : version.slice(0, 12) : '读取中…'}</code></div>{model?.state.release && <div className="setting-row"><span>最新 Release</span><div className="release-version"><strong>{model.state.release.tag}</strong><code title={model.state.release.sha}>{model.state.release.sha.slice(0, 12)}</code></div></div>}<p role="status" aria-live="polite">{model?.state.message ?? '正在读取版本…'}</p>{model?.enabled && !model.canUpgrade && <p className="muted">仅部署管理员可检查和升级</p>}{error && <p role="alert">{error}</p>}<div className="update-actions">{model?.enabled && model.canUpgrade && <Button type="button" variant="outline" disabled={working || running} onClick={() => void check()}>{model.state.phase === 'checking' ? '检查中…' : '检查更新'}</Button>}{model?.canUpgrade && model.state.available && model.state.release && <Button type="button" disabled={working || running} onClick={() => void upgrade()}>升级到 {model.state.release.tag}</Button>}<Button type="button" variant="ghost" disabled={working} onClick={() => void refresh()}>刷新状态</Button></div></section>;
}
