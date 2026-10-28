import { request } from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { ResourceError } from './resources.js';
export type SkillFetch = (url: string) => Promise<Buffer>;
export const fileLimit = 1024 * 1024;
export const bundleLimit = 8 * fileLimit;
export type SkillFile = { path: string; content: string };
export function validFilePath(path: string) {
    if (!path || path.length > 1000 || path.includes('\\') || /[\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part === '..' || part.startsWith('.')) || path.split('/').some(part => part.toLowerCase() === 'skill.md'))
        throw new ResourceError('文件路径无效，SKILL.md 为保留主文件');
    return path;
}
function publicAddress(address: string) {
    if (isIP(address) === 4) {
        const [first, second] = address.split('.').map(Number);
        return !(first === 0 || first === 10 || first === 127 || first >= 224 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && (second === 168 || second === 0) || first === 100 && second >= 64 && second <= 127 || first === 198 && (second === 18 || second === 19));
    }
    return /^2[0-9a-f]{3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
export const fetchSkillSource: SkillFetch = url => new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.hostname !== 'api.github.com' || target.port || target.username || target.password) {
        reject(new ResourceError('不支持的抓取地址')); return;
    }
    const outgoing = request(target, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'XTEAM-Skill-Import' }, lookup: (hostname, options, callback) => {
        lookup(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) { callback(error, []); return; }
            if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) { callback(new Error('拒绝访问非公网地址'), []); return; }
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
        });
    } }, response => {
        if (response.statusCode !== 200) { response.resume(); reject(new ResourceError(`来源请求失败（${response.statusCode}），请确认公开 URL 或稍后重试`, 502)); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 16 * fileLimit) response.destroy(new ResourceError('来源响应过大', 413)); else chunks.push(chunk); });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
    });
    const timer = setTimeout(() => outgoing.destroy(new ResourceError('来源请求超时', 504)), 15000);
    outgoing.on('close', () => clearTimeout(timer));
    outgoing.on('error', reject);
    outgoing.end();
});
export async function downloadSkill(input: string, fetcher: SkillFetch = fetchSkillSource) {
    let url: URL;
    try { url = new URL(input.includes('://') ? input : 'https://' + input); } catch { throw new ResourceError('请填写有效的 GitHub 或 skills.sh URL'); }
    const host = url.hostname.replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !['github.com', 'skills.sh'].includes(host)) throw new ResourceError('仅支持 GitHub 和 skills.sh 的公开 HTTPS URL');
    const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x20]/.test(part))) throw new ResourceError('来源路径无效');
    const [owner, repo] = parts;
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new ResourceError('URL 需包含 owner/repo');
    const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const json = async (path: string) => {
        try { return JSON.parse((await fetcher(base + path)).toString('utf8')); } catch (error) { if (error instanceof ResourceError) throw error; throw new ResourceError('无法读取来源，请确认 URL 或稍后重试', 502); }
    };
    const isSkills = host === 'skills.sh';
    if (isSkills && parts.length !== 3 || !isSkills && parts.length > 2 && !['tree', 'blob'].includes(parts[2])) throw new ResourceError('请使用仓库、tree 目录或 blob SKILL.md URL');
    const ref = isSkills || parts.length === 2 ? (await json('')).default_branch : parts[3];
    if (typeof ref !== 'string' || !ref) throw new ResourceError('无法确定来源分支', 502);
    let directory = isSkills || parts.length === 2 ? '' : parts.slice(4).join('/');
    if (parts[2] === 'blob') { if (!directory.endsWith('SKILL.md')) throw new ResourceError('blob URL 必须指向 SKILL.md'); directory = directory.slice(0, -8).replace(/\/$/, ''); }
    const result = await json(`/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (result.truncated || !Array.isArray(result.tree)) throw new ResourceError('来源目录过大或不完整，请使用更小的仓库', 413);
    const tree = result.tree as { path: string; type: string; sha: string; size?: number; mode?: string }[];
    let candidates = tree.filter(entry => entry.type === 'blob' && (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')) && !entry.path.split('/').some(part => part.startsWith('.')));
    if (directory) candidates = candidates.filter(entry => entry.path === directory + '/SKILL.md');
    else if (isSkills) candidates = candidates.filter(entry => entry.path === parts[2] + '/SKILL.md' || entry.path.endsWith('/' + parts[2] + '/SKILL.md'));
    else if (candidates.some(entry => entry.path === 'SKILL.md')) candidates = candidates.filter(entry => entry.path === 'SKILL.md');
    if (candidates.length !== 1) throw new ResourceError(candidates.length ? '来源包含多个 Skill，请使用精确的目录 URL' : '来源未找到 SKILL.md');
    const main = candidates[0];
    directory = main.path.slice(0, -8);
    let total = 0;
    const files: SkillFile[] = [];
    let content = '';
    for (const entry of tree.filter(entry => entry.type === 'blob' && entry.path.startsWith(directory))) {
        const path = entry.path.slice(directory.length);
        if (path.split('/').includes('..') || path.startsWith('/') || path.includes('\\')) throw new ResourceError('来源包含越界文件路径');
        if (path !== 'SKILL.md' && (path.split('/').some(part => part.startsWith('.') || part.toLowerCase() === 'skill.md') || /^(license|licence|copying)(\.|$)/i.test(path.split('/').at(-1)!) || /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34])$/i.test(path) || entry.mode === '120000')) continue;
        if (path !== 'SKILL.md') validFilePath(path);
        if (entry.size !== undefined && entry.size > fileLimit) throw new ResourceError('单文件超过 1 MiB', 413);
        const blob = await json('/git/blobs/' + encodeURIComponent(entry.sha));
        if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new ResourceError('来源文件格式无效', 502);
        const bytes = Buffer.from(blob.content, 'base64');
        if (bytes.includes(0)) continue;
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { continue; }
        if (bytes.length > fileLimit) throw new ResourceError('单文件超过 1 MiB', 413);
        total += bytes.length;
        if (total > bundleLimit || files.length >= 256 && path !== 'SKILL.md') throw new ResourceError('Skill 超过 8 MiB 或 256 个附属文件', 413);
        if (path === 'SKILL.md') content = text; else files.push({ path, content: text });
    }
    if (!content.trim()) throw new ResourceError('SKILL.md 正文为空或不是 UTF-8 文本');
    return { content, files: files.sort((left, right) => left.path.localeCompare(right.path)), source_url: url.href.replace(/\/$/, ''), source_type: isSkills ? 'skills.sh' : 'GitHub', fallbackName: directory.split('/').filter(Boolean).at(-1) || repo };
}
