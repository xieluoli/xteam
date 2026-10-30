export const snapshot = 'a'.repeat(40);
export const suiteNames = ['apply', 'explore', 'init', 'propose', 'review'];
export function multiSkillNetwork() {
    const state = { failedBlob: '', truncated: false, count: 5, branchMoved: false, largeBundles: false, rootSkill: false };
    const calls: string[] = [];
    const fetcher = async (url: string) => {
        calls.push(url);
        const target = new URL(url), path = target.pathname;
        if (path === '/repos/example/pmspec') return Buffer.from(JSON.stringify({ private: false, default_branch: 'main' }));
        if (path.includes('/git/trees/')) {
            const ref = path.split('/').at(-1);
            if (ref !== 'main' && ref !== snapshot) throw new Error('Unknown snapshot');
            return Buffer.from(JSON.stringify({ sha: ref === 'main' && state.branchMoved ? 'b'.repeat(40) : snapshot, truncated: state.truncated, tree: [...(state.rootSkill ? [{ path: 'SKILL.md', type: 'blob', sha: 'root' }] : []), ...Array.from({ length: state.count }, (_, index) => {
                const name = suiteNames[index] ?? 'extra-' + index;
                return [{ path: 'skills/pmspec-' + name + '/SKILL.md', type: 'blob', sha: name }, ...Array.from({ length: state.largeBundles ? 7 : 1 }, (_, index) => ({ path: 'skills/pmspec-' + name + '/references/' + (index ? 'extra-' + index : 'note') + '.md', type: 'blob', sha: name + '-note' + (index ? '-' + index : '') }))];
            }).flat()] }));
        }
        if (target.hostname === 'raw.githubusercontent.com') {
            const relative = path.split('/').slice(4).join('/');
            const name = relative.split('/')[1]?.replace(/^pmspec-/, '');
            const extra = relative.match(/extra-(\d+)\.md$/)?.[1];
            const key = relative === 'SKILL.md' ? 'root' : relative.endsWith('/SKILL.md') ? name : name + '-note' + (extra ? '-' + extra : '');
            if (key === state.failedBlob) throw new Error('Fixture source unavailable');
            const text = key === 'root' ? '# Root without frontmatter' : key.includes('-note') ? state.largeBundles ? 'x'.repeat(1024 * 1024) : '# Reference ' + key : '---\nname: pmspec-' + key + '\ndescription: Team ' + key + '\n---\n# ' + key;
            return Buffer.from(text);
        }
        throw new Error('Unexpected URL');
    };
    return { fetcher, calls, state };
}
