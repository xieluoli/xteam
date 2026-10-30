import { multiSkillNetwork } from './multi-skill-network.js';
const suite = multiSkillNetwork();
export async function skillNetwork(url: string) {
    const target = new URL(url);
    if (target.pathname.startsWith('/repos/example/pmspec') || target.hostname === 'raw.githubusercontent.com' && target.pathname.startsWith('/example/pmspec/')) return suite.fetcher(url);
    if (!['api.github.com', 'raw.githubusercontent.com'].includes(target.hostname)) throw new Error('Unexpected network host');
    if (target.pathname.match(/^\/repos\/example\/(review|writer|mobile|single|components)$/)) return Buffer.from(JSON.stringify({ private: false, default_branch: 'main' }));
    const name = target.pathname.split('/')[target.hostname === 'api.github.com' ? 3 : 2];
    if (!['review', 'writer', 'mobile', 'single', 'components'].includes(name)) throw new Error('Fixture source unavailable');
    if (target.pathname.endsWith('/git/trees/main')) return Buffer.from(JSON.stringify({ sha: 'a'.repeat(40), tree: [{ path: 'SKILL.md', sha: 'main', type: 'blob' }, { path: 'references/check.md', sha: 'reference', type: 'blob' }, { path: 'scripts/demo.html', sha: 'html', type: 'blob' }], truncated: false }));
    if (target.hostname === 'raw.githubusercontent.com') {
        const content = target.pathname.endsWith('/SKILL.md') ? `---\nname: ${name}\ndescription: Team ${name}\ncustom: keep\n---\n# ${name === 'review' ? 'Review guide' : 'Writer guide'}\n\nUse **clear steps**.\n\n<script>globalThis.__skillExecuted = true</script>\n\n![remote](https://example.com/track.png)` : target.pathname.endsWith('/demo.html') ? '<script>globalThis.__skillExecuted = true</script>' : '# Check reference\n\nA safe note.';
        return Buffer.from(content);
    }
    throw new Error('Unexpected network URL: ' + url);
}
