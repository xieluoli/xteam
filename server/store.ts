import Database from 'better-sqlite3';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export function passwordHash(password: string) {
    if (password.length < 12 || password.length > 256)
        throw new Error('密码需为 12–256 个字符');
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password: string, encoded: string) {
    if (password.length > 256) return false;
    const [salt, digest] = encoded.split(':');
    const actual = scryptSync(password, salt, 64);
    return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}
export function openDatabase(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const database = new Database(path);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
    database.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS links_project ON links(project_id);
    CREATE INDEX IF NOT EXISTS todos_project ON todos(project_id);
  `);
    const columns = new Set((database.prepare('PRAGMA table_info(skills)').all() as { name: string }[]).map(column => column.name));
    for (const column of ['source_url', 'source_type', 'created_at', 'created_by', 'updated_by'])
        if (!columns.has(column)) database.exec(`ALTER TABLE skills ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    if (!columns.has('labels')) database.exec("ALTER TABLE skills ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'");
    database.exec('CREATE TABLE IF NOT EXISTS skill_files (skill_id TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(skill_id,path))');
    return database;
}
export function provisionUser(database: Database.Database, email: string, password: string) {
    email = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error('邮箱格式不正确');
    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email) as {
        id: string;
    } | undefined;
    const id = existing?.id ?? randomUUID();
    database.transaction(() => {
        database.prepare('INSERT INTO users (id,email,password) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET password=excluded.password,enabled=1').run(id, email, passwordHash(password));
        database.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    })();
    return id;
}
export function disableUser(database: Database.Database, email: string) {
    database.transaction(() => {
        const user = database.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase()) as {
            id: string;
        } | undefined;
        if (!user)
            throw new Error('账号不存在');
        database.prepare('UPDATE users SET enabled=0 WHERE id=?').run(user.id);
        database.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        database.prepare('DELETE FROM tokens WHERE user_id=?').run(user.id);
    })();
}
