import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { openDatabase } from '../server/store.js';
import { todoManifest, archiveTodos, restoreTodoBatch } from '../server/todo-archive.js';

const [command, file, backup] = process.argv.slice(2);
const db = openDatabase(process.env.XTEAM_DATABASE ?? 'data/xteam.db');
try {
    if (command === 'plan' && file) {
        const manifest = todoManifest(db);
        writeFileSync(file, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
        console.log(JSON.stringify({ count: manifest.count, sha256: manifest.sha256, manifest: file }));
    } else if (command === 'apply' && file && backup) {
        if (existsSync(backup)) throw new Error('请使用新的备份路径，不覆盖既有备份');
        const manifest = JSON.parse(readFileSync(file, 'utf8'));
        if (manifest.schema_version !== 1 || manifest.sha256 !== todoManifest(db).sha256) throw new Error('任务清单已变化，请先核对；未清理');
        // SQLite backup includes WAL and every resource, including future attachments.
        await db.backup(backup); chmodSync(backup, 0o600);
        const check = new Database(backup, { readonly: true, fileMustExist: true });
        try {
            if (check.pragma('integrity_check', { simple: true }) !== 'ok' || todoManifest(check).sha256 !== manifest.sha256) throw new Error('备份验证失败，未清理');
        } finally { check.close(); }
        console.log(JSON.stringify({ ...archiveTodos(db, manifest.sha256), backup }));
    } else if (command === 'restore' && file) console.log(JSON.stringify(restoreTodoBatch(db, file)));
    else throw new Error('用法：archive-todos plan <新清单.json> | apply <清单.json> <新备份.db> | restore <batch-id>');
} finally { db.close(); }
