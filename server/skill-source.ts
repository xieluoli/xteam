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
// Bounded process cache: mutable refs live for 30 seconds; SHA content for 15 minutes.
const sourceResponses = new Map<string, { body: Buffer; expires: number }>();
const sourceRequests = new Map<string, Promise<Buffer>>();
export const fetchSkillSource: SkillFetch = async url => {
    const target = new URL(url);
    const raw = target.hostname === 'raw.githubusercontent.com';
    if (target.protocol !== 'https:' || !['api.github.com', 'raw.githubusercontent.com'].includes(target.hostname) || target.port || target.username || target.password || target.hash || raw && (target.search || !/^\/[\w.-]+\/[\w.-]+\/[a-f0-9]{40}\/.+/.test(target.pathname))) throw new ResourceError('不支持的抓取地址');
    const key = target.href, cached = sourceResponses.get(key);
    if (cached && cached.expires > Date.now()) return cached.body;
    if (sourceRequests.has(key)) return sourceRequests.get(key)!;
    if (sourceRequests.size >= 128) throw new ResourceError('来源请求繁忙，请稍后重试', 429);
    const headers: Record<string, string> = { Accept: raw ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'XTEAM-Skill-Import' };
    const token = process.env.XTEAM_GITHUB_TOKEN?.trim();
    if (!raw && token) headers.Authorization = 'Bearer ' + token;
    const pending = new Promise<Buffer>((resolve, reject) => {
        const outgoing = request(target, { headers, lookup: (hostname, options, callback) => {
            lookup(hostname, { ...options, all: true }, (error, addresses) => {
                if (error) { callback(error, []); return; }
                if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) { callback(new Error('拒绝访问非公网地址'), []); return; }
                if (options.all) callback(null, addresses);
                else callback(null, addresses[0].address, addresses[0].family);
            });
        } }, response => {
            if (response.statusCode !== 200) {
                response.resume();
                if (response.statusCode === 429 || response.statusCode === 403 && (response.headers['x-ratelimit-remaining'] === '0' || response.headers['retry-after'] !== undefined)) {
                    const retry = Number(response.headers['retry-after']), reset = Number(response.headers['x-ratelimit-reset']);
                    const time = retry > 0 && Number.isFinite(retry) ? Date.now() + retry * 1000 : reset > 0 && Number.isFinite(reset) ? reset * 1000 : 0;
                    const recovery = time && Number.isFinite(new Date(time).getTime()) ? `，请在 ${new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）后重试` : '，请稍后重试';
                    reject(new ResourceError('GitHub 来源请求已限流' + recovery, 429));
                } else reject(new ResourceError(`来源请求失败（${response.statusCode}），请确认公开 URL 或稍后重试`, 502));
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > (raw ? fileLimit : 16 * fileLimit)) response.destroy(new ResourceError('来源响应过大', 413)); else chunks.push(chunk); });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        const timer = setTimeout(() => outgoing.destroy(new ResourceError('来源请求超时', 504)), 15000);
        outgoing.on('close', () => clearTimeout(timer));
        outgoing.on('error', reject);
        outgoing.end();
    });
    sourceRequests.set(key, pending);
    try {
        const body = await pending;
        for (const [address, entry] of sourceResponses) if (entry.expires <= Date.now()) sourceResponses.delete(address);
        const immutable = raw || /\/git\/trees\/[a-f0-9]{40}$/.test(target.pathname);
        sourceResponses.set(key, { body, expires: Date.now() + (immutable ? 900_000 : 30_000) });
        while (sourceResponses.size > 128 || [...sourceResponses.values()].reduce((size, entry) => size + entry.body.length, 0) > 32 * fileLimit) sourceResponses.delete(sourceResponses.keys().next().value!);
        return body;
    } finally { sourceRequests.delete(key); }
};
async function readSource(input: string, fetcher: SkillFetch, snapshot?: string) {
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
    const repository = await json('');
    if (repository.private !== false) throw new ResourceError('仅支持公开 GitHub 仓库');
    const ref = isSkills || parts.length === 2 ? repository.default_branch : parts[3];
    if (typeof ref !== 'string' || !ref) throw new ResourceError('无法确定来源分支', 502);
    let directory = isSkills || parts.length === 2 ? '' : parts.slice(4).join('/');
    if (parts[2] === 'blob') { if (!directory.endsWith('SKILL.md')) throw new ResourceError('blob URL 必须指向 SKILL.md'); directory = directory.slice(0, -8).replace(/\/$/, ''); }
    if (snapshot !== undefined && !/^[a-f0-9]{40}$/.test(snapshot)) throw new ResourceError('来源快照无效');
    const result = await json(`/git/trees/${encodeURIComponent(snapshot ?? ref)}?recursive=1`);
    if (result.truncated || !Array.isArray(result.tree)) throw new ResourceError('来源目录过大或不完整，请使用更小的仓库', 413);
    if (!/^[a-f0-9]{40}$/.test(result.sha ?? '')) throw new ResourceError('无法确定来源快照', 502);
    const tree = result.tree as { path: string; type: string; sha: string; size?: number; mode?: string }[];
    const all = tree.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')) && !entry.path.split('/').some(part => part.startsWith('.')));
    let candidates = all;
    if (parts[2] === 'blob') candidates = candidates.filter(entry => entry.path === (directory ? directory + '/' : '') + 'SKILL.md');
    else if (directory) candidates = candidates.filter(entry => entry.path.startsWith(directory + '/'));
    else if (isSkills) candidates = candidates.filter(entry => entry.path === parts[2] + '/SKILL.md' || entry.path.endsWith('/' + parts[2] + '/SKILL.md'));
    const text = async (entry: typeof tree[number]) => {
        if (entry.size !== undefined && entry.size > fileLimit) throw new ResourceError('单文件超过 1 MiB', 413);
        if (entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '..' || part === '.')) throw new ResourceError('来源包含越界文件路径');
        const bytes = await fetcher(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${result.sha}/${entry.path.split('/').map(encodeURIComponent).join('/')}`);
        if (bytes.length > fileLimit) throw new ResourceError('单文件超过 1 MiB', 413);
        if (bytes.includes(0)) return null;
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
    };
    return { url, owner, repo, ref, directory, isSkills, tree, all, candidates, sha: result.sha as string, text };
}
export async function discoverSkillSource(input: string, fetcher: SkillFetch = fetchSkillSource) {
    const source = await readSource(input, fetcher);
    if (!/^[a-f0-9]{40}$/.test(source.sha ?? '')) throw new ResourceError('无法确定来源快照', 502);
    if (!source.candidates.length) throw new ResourceError('来源未找到 SKILL.md');
    if (source.candidates.length > 20) throw new ResourceError('来源超过 20 个 Skill，请使用更小的目录', 413);
    const candidates = [];
    for (const entry of source.candidates) {
        const content = await source.text(entry);
        if (!content?.trim()) throw new ResourceError('SKILL.md 正文为空或不是 UTF-8 文本');
        const path = entry.path.slice(0, -8).replace(/\/$/, '');
        candidates.push({ path, content, fallbackName: path.split('/').at(-1) || source.repo });
    }
    return { sha: source.sha, ref: source.ref, candidates };
}
export async function downloadSkill(input: string, fetcher: SkillFetch = fetchSkillSource, selection?: { sha: string; path: string }) {
    const source = await readSource(input, fetcher, selection?.sha);
    const { url, repo, ref, isSkills, tree } = source;
    let candidates = source.candidates;
    if (selection) {
        if (selection.path && (selection.path.startsWith('/') || selection.path.includes('\\') || selection.path.split('/').some(part => !part || part.startsWith('.') || /[\x00-\x20]/.test(part)))) throw new ResourceError('选择路径无效');
        if (source.sha !== selection.sha) throw new ResourceError('来源快照不匹配，请重新读取候选');
        candidates = candidates.filter(entry => entry.path === (selection.path ? selection.path + '/' : '') + 'SKILL.md');
        if (!candidates.length) throw new ResourceError('选择的目录不在本次来源范围内');
    } else if (source.directory) candidates = candidates.filter(entry => entry.path === source.directory + '/SKILL.md');
    else if (!isSkills && candidates.some(entry => entry.path === 'SKILL.md')) candidates = candidates.filter(entry => entry.path === 'SKILL.md');
    if (candidates.length !== 1) throw new ResourceError(candidates.length ? '来源包含多个 Skill，请使用精确的目录 URL' : '来源未找到 SKILL.md');
    const main = candidates[0];
    const directory = main.path.slice(0, -8);
    let total = 0;
    const files: SkillFile[] = [];
    let content = '';
    for (const entry of tree.filter(entry => entry.type === 'blob' && entry.path.startsWith(directory))) {
        if (source.all.some(other => other.path !== main.path && other.path.startsWith(directory) && entry.path.startsWith(other.path.slice(0, -8)))) continue;
        const path = entry.path.slice(directory.length);
        if (path.split('/').includes('..') || path.startsWith('/') || path.includes('\\')) throw new ResourceError('来源包含越界文件路径');
        if (path !== 'SKILL.md' && (path.split('/').some(part => part.startsWith('.') || part.toLowerCase() === 'skill.md') || /^(license|licence|copying)(\.|$)/i.test(path.split('/').at(-1)!) || /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34])$/i.test(path) || entry.mode === '120000')) continue;
        if (path !== 'SKILL.md') validFilePath(path);
        const text = await source.text(entry);
        if (text === null) continue;
        total += Buffer.byteLength(text);
        if (total > bundleLimit || files.length >= 256 && path !== 'SKILL.md') throw new ResourceError('Skill 超过 8 MiB 或 256 个附属文件', 413);
        if (path === 'SKILL.md') content = text; else files.push({ path, content: text });
    }
    if (!content.trim()) throw new ResourceError('SKILL.md 正文为空或不是 UTF-8 文本');
    const sourceUrl = selection && !isSkills ? `https://github.com/${source.owner}/${repo}/tree/${encodeURIComponent(ref)}${directory ? '/' + directory.replace(/\/$/, '') : ''}` : url.href.replace(/\/$/, '');
    return { content, files: files.sort((left, right) => left.path.localeCompare(right.path)), source_url: sourceUrl, source_type: isSkills ? 'skills.sh' : 'GitHub', fallbackName: directory.split('/').filter(Boolean).at(-1) || repo };
}
