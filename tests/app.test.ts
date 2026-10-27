import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, provisionUser } from '../server/store.js';
import { createApp } from '../server/app.js';
// Missing login must not silently pass a health-only skeleton.
test('password login authenticates a provisioned member and rejects unknown users', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-test-'));
    const fixture = openDatabase(join(directory, 'test.db'));
    provisionUser(fixture, 'member@example.com', 'correct-test-password');
    fixture.close();
    const app = createApp({ database: join(directory, 'test.db'), origin: 'http://localhost' });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as {
        port: number;
    };
    try {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify({ email: 'member@example.com', password: 'correct-test-password' }) });
        assert.equal(response.status, 200, 'a provisioned member can log in');
    }
    finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
    }
});
