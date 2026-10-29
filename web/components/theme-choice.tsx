import { useState } from 'react';
import { Choice } from './app-ui';

export function ThemeChoice() {
    const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'japan-blues');
    return <div className="theme-choice"><span>主题</span><Choice label="界面主题" value={theme} onChange={next => {
        document.documentElement.dataset.theme = next;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'cyberpunk' ? '#bc13fe' : '#90a1b9');
        try { localStorage.setItem('xteam-theme', next); } catch {}
        setTheme(next);
    }} options={[{ value: 'japan-blues', label: 'Japan Blues' }, { value: 'cyberpunk', label: 'cyberpunk' }]}/></div>;
}
