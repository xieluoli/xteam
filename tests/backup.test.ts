import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase, provisionUser } from '../server/store.js';
test('online backup restores committed data while the source remains open', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-backup-'));
    const source = join(directory, 'source.db');
    const target = join(directory, 'backup.db');
    const database = openDatabase(source);
    try {
        provisionUser(database, 'restore@example.com', 'restore-test-password');
        execFileSync(process.execPath, ['--import', 'tsx', 'scripts/backup.ts', target], { env: { ...process.env, XTEAM_DATABASE: source } });
        const restored = openDatabase(target);
        assert.equal((restored.prepare('SELECT email FROM users').get() as {
            email: string;
        }).email, 'restore@example.com');
        assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
        restored.close();
    }
    finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
