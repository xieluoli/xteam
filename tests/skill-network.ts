export async function skillNetwork(url: string) {
    const target = new URL(url);
    if (target.hostname !== 'api.github.com') throw new Error('Unexpected network host');
    if (target.pathname.match(/^\/repos\/example\/(review|writer|mobile|single|components)$/)) return Buffer.from(JSON.stringify({ default_branch: 'main' }));
    const name = target.pathname.split('/')[3];
    if (!['review', 'writer', 'mobile', 'single', 'components'].includes(name)) throw new Error('Fixture source unavailable');
    if (target.pathname.endsWith('/git/trees/main')) return Buffer.from(JSON.stringify({ tree: [{ path: 'SKILL.md', sha: 'main', type: 'blob' }, { path: 'references/check.md', sha: 'reference', type: 'blob' }, { path: 'scripts/demo.html', sha: 'html', type: 'blob' }], truncated: false }));
    if (target.pathname.includes('/git/blobs/')) {
        const content = target.pathname.endsWith('/main') ? `---\nname: ${name}\ndescription: Team ${name}\ncustom: keep\n---\n# ${name === 'review' ? 'Review guide' : 'Writer guide'}\n\nUse **clear steps**.\n\n<script>globalThis.__skillExecuted = true</script>\n\n![remote](https://example.com/track.png)` : target.pathname.endsWith('/html') ? '<script>globalThis.__skillExecuted = true</script>' : '# Check reference\n\nA safe note.';
        return Buffer.from(JSON.stringify({ encoding: 'base64', content: Buffer.from(content).toString('base64') }));
    }
    throw new Error('Unexpected network URL: ' + url);
}
