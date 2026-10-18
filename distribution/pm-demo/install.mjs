import { access, lstat, open, mkdir, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required');
const skillNames = ['cn-commit', 'pmspec-init', 'pmspec-explore', 'pmspec-propose', 'pmspec-apply', 'pmspec-review'];

async function stat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directoryChain(path) {
  const parent = dirname(path);
  if (parent !== path) await directoryChain(parent);
  const info = await stat(path);
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error(`Directory conflict or symlink: ${path}`);
}
function destination(path) {
  if (path === 'LICENSE') return '.xteam/licenses/pm-demo/LICENSE';
  if (['agents/pm-demo.toml', 'agents/prototype-review.toml'].includes(path)) return `.codex/${path}`;
  if (skillNames.some(name => path.startsWith(`skills/${name}/`))) return `.agents/${path}`;
  throw new Error(`Unsupported bundle path: ${path}`);
}

async function install() {
  const options = { bundle: dirname(fileURLToPath(import.meta.url)) };
  const seen = new Set();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--bundle', '--workspace', '--check'].includes(flag) || seen.has(flag)) throw new Error(`Unknown or repeated option: ${flag}`);
    seen.add(flag);
    if (flag === '--check') options.check = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`);
      options[flag.slice(2)] = value;
    }
  }
  if (!options.workspace) throw new Error('Usage: node install.mjs --workspace <existing product directory> [--check]');
  const workspace = resolve(options.workspace);
  const bundle = resolve(options.bundle);
  await directoryChain(workspace);
  await access(workspace, constants.W_OK);
  await directoryChain(bundle);
  const manifestPath = join(bundle, 'manifest.json');
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink()) throw new Error('Invalid manifest');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.format !== 1 || manifest.name !== 'pm-demo' || typeof manifest.version !== 'string' || !manifest.version || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 256) throw new Error('Invalid PM manifest');
  const planned = [];
  const paths = new Set();
  let totalBytes = 0;
  for (const member of manifest.files) {
    const path = member.path;
    if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..') || paths.has(path) || !/^[a-f0-9]{64}$/.test(member.sha256)) throw new Error(`Invalid or duplicate bundle member: ${path}`);
    paths.add(path);
    const relative = destination(path);
    const source = join(bundle, path);
    await directoryChain(dirname(source));
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error(`Invalid source member: ${path}`);
    totalBytes += info.size;
    if (totalBytes > 8 * 1024 * 1024) throw new Error('Bundle exceeds 8 MiB');
    const bytes = await readFile(source);
    if (hash(bytes) !== member.sha256) throw new Error(`Integrity mismatch: ${path}`);
    const target = join(workspace, relative);
    await directoryChain(dirname(target));
    const existing = await stat(target);
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || !(await readFile(target)).equals(bytes))) throw new Error(`File conflict: ${relative}`);
    planned.push({ source, target, relative, sha256: member.sha256, exists: !!existing });
  }
  for (const path of ['LICENSE', 'agents/pm-demo.toml', 'agents/prototype-review.toml', ...skillNames.map(name => `skills/${name}/SKILL.md`)]) {
    if (!paths.has(path)) throw new Error(`Required member missing: ${path}`);
  }
  // Reject unlisted source files and extra local skill files: both would make
  // an apparently successful install differ from the reviewed snapshot.
  async function checkTree(base, prefix, allowed) {
    const info = await stat(base);
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Directory conflict: ${base}`);
    for (const entry of await readdir(base)) {
      const path = join(base, entry);
      const relative = `${prefix}/${entry}`;
      const entryInfo = await lstat(path);
      if (entryInfo.isSymbolicLink()) throw new Error(`Symlink conflict: ${path}`);
      if (entryInfo.isDirectory()) await checkTree(path, relative, allowed);
      else if (!entryInfo.isFile() || !allowed.has(relative)) throw new Error(`Unlisted file conflict: ${relative}`);
    }
  }
  for (const name of skillNames) {
    await checkTree(join(bundle, 'skills', name), `skills/${name}`, paths);
    const allowed = new Set(planned.map(file => file.relative));
    await checkTree(join(workspace, '.agents/skills', name), `.agents/skills/${name}`, allowed);
  }
  const receiptPath = join(workspace, '.xteam/installs/pm-demo.json');
  await directoryChain(dirname(receiptPath));
  const receipt = JSON.stringify({
    name: manifest.name, version: manifest.version, manifestSha256: hash(manifestBytes),
    source: manifest.source ?? null, host: 'codex', runtimeDiscovery: 'not_verified',
    files: planned.map(({ relative, sha256 }) => ({ path: relative, sha256 })),
  }, null, 2) + '\n';
  const receiptInfo = await stat(receiptPath);
  if (receiptInfo && (!receiptInfo.isFile() || receiptInfo.isSymbolicLink() || (await readFile(receiptPath, 'utf8')) !== receipt)) throw new Error('Install receipt conflict; review the installed version first');
  const newFiles = planned.filter(file => !file.exists);
  const createdFiles = [];
  const createdDirectories = [];
  async function ensureDirectory(path) {
    const info = await stat(path);
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Directory conflict: ${path}`);
      return;
    }
    await ensureDirectory(dirname(path));
    await mkdir(path);
    createdDirectories.push(path);
  }
  if (!options.check) {
    try {
      for (const file of newFiles) {
        await directoryChain(dirname(file.source));
        if ((await lstat(file.source)).isSymbolicLink() || hash(await readFile(file.source)) !== file.sha256) throw new Error(`Source changed: ${file.relative}`);
        await ensureDirectory(dirname(file.target));
        const handle = await open(file.target, 'wx');
        const identity = await handle.stat();
        const owned = { path: file.target, dev: identity.dev, ino: identity.ino, sha256: null };
        createdFiles.push(owned);
        try { await handle.writeFile(await readFile(file.source)); }
        finally { await handle.close(); }
        if (hash(await readFile(file.target)) !== file.sha256) throw new Error(`Copy verification failed: ${file.relative}`);
        owned.sha256 = file.sha256;
      }
      if (!receiptInfo) {
        await ensureDirectory(dirname(receiptPath));
        const handle = await open(receiptPath, 'wx');
        const identity = await handle.stat();
        const owned = { path: receiptPath, dev: identity.dev, ino: identity.ino, sha256: null };
        createdFiles.push(owned);
        try { await handle.writeFile(receipt); owned.sha256 = hash(receipt); }
        finally { await handle.close(); }
      }
    } catch (error) {
      const cleanupErrors = [];
      for (const file of createdFiles.reverse()) {
        try {
          const info = await stat(file.path);
          if (info?.isFile() && !info.isSymbolicLink() && info.dev === file.dev && info.ino === file.ino && (file.sha256 === null || hash(await readFile(file.path)) === file.sha256)) await unlink(file.path);
          else if (info) cleanupErrors.push(file.path);
        } catch { cleanupErrors.push(file.path); }
      }
      for (const path of createdDirectories.reverse()) {
        try { await rmdir(path); } catch { cleanupErrors.push(path); }
      }
      if (cleanupErrors.length) throw new Error(`${error.message}; manual cleanup required: ${cleanupErrors.join(', ')}`);
      throw error;
    }
  }
  console.info(JSON.stringify({ host: 'codex', workspace, version: manifest.version, mode: options.check ? 'check' : 'installed', newFiles: newFiles.length, runtimeDiscovery: 'not_verified', next: 'Open a new Codex session; verify pm-demo, prototype-review and six skills are discoverable. No agent was executed.' }, null, 2));
}

install().catch(error => { console.error(error.message); process.exitCode = 1; });
