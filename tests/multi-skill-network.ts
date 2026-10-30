export const snapshot = 'a'.repeat(40);
export const suiteNames = ['apply', 'explore', 'init', 'propose', 'review'];
export function multiSkillNetwork() {
    const state = { failedBlob: '', truncated: false, count: 5, branchMoved: false, largeBundles: false, rootSkill: false };
    const calls: string[] = [];
    const fetcher = async (url: string) => {
        calls.push(url);
        const path = new URL(url).pathname;
        if (path === '/repos/example/pmspec') return Buffer.from(JSON.stringify({ default_branch: 'main' }));
        if (path.includes('/git/trees/')) {
            const ref = path.split('/').at(-1);
            if (ref !== 'main' && ref !== snapshot) throw new Error('Unknown snapshot');
            return Buffer.from(JSON.stringify({ sha: ref === 'main' && state.branchMoved ? 'b'.repeat(40) : snapshot, truncated: state.truncated, tree: [...(state.rootSkill ? [{ path: 'SKILL.md', type: 'blob', sha: 'root' }] : []), ...Array.from({ length: state.count }, (_, index) => {
                const name = suiteNames[index] ?? 'extra-' + index;
                return [{ path: 'skills/pmspec-' + name + '/SKILL.md', type: 'blob', sha: name }, ...Array.from({ length: state.largeBundles ? 7 : 1 }, (_, index) => ({ path: 'skills/pmspec-' + name + '/references/' + (index ? 'extra-' + index : 'note') + '.md', type: 'blob', sha: name + '-note' + (index ? '-' + index : '') }))];
            }).flat()] }));
        }
        if (path.includes('/git/blobs/')) {
            const key = path.split('/').at(-1)!;
            if (key === state.failedBlob) throw new Error('Fixture source unavailable');
            const text = key === 'root' ? '# Root without frontmatter' : key.includes('-note') ? state.largeBundles ? 'x'.repeat(1024 * 1024) : '# Reference ' + key : '---\nname: pmspec-' + key + '\ndescription: Team ' + key + '\n---\n# ' + key;
            return Buffer.from(JSON.stringify({ encoding: 'base64', content: Buffer.from(text).toString('base64') }));
        }
        throw new Error('Unexpected URL');
    };
    return { fetcher, calls, state };
}
