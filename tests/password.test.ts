import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordHash, passwordMatches } from '../server/store.js';
test('password verification rejects an over-limit value even when its prefix matches', () => {
  const password = 'x'.repeat(256);
  const encoded = passwordHash(password);
  assert.equal(passwordMatches(password + 'suffix', encoded), false);
});
