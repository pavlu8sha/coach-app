import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(props = {}) {
  const cache = new Map();
  const sleeps = [];
  const ctx = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperties: () => ({ ...props }) }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.get(key) || null,
        put: (key, value) => cache.set(key, value),
      }),
    },
    Utilities: { sleep: ms => sleeps.push(ms) },
    Logger: { log() {} },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'NavCode.js'), 'utf8'), ctx, { filename: 'NavCode.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Players.js'), 'utf8'), ctx, { filename: 'Players.js' });
  return { ctx, cache, sleeps };
}

test('checkAdmin_ counts invalid PIN attempts', () => {
  const e = env({ APP_ADMIN_PIN: 'admin-secret' });
  assert.throws(() => e.ctx.checkAdmin_('wrong'), /Неверный код администратора/);
  assert.equal(e.cache.get('pin_fail'), '1');
  assert.deepEqual(e.sleeps, []);
});

test('checkAdmin_ does not count a valid admin PIN', () => {
  const e = env({ APP_ADMIN_PIN: 'admin-secret' });
  assert.equal(e.ctx.checkAdmin_('admin-secret'), undefined);
  assert.equal(e.cache.has('pin_fail'), false);
});

test('checkAdmin_ slows repeated invalid PIN attempts', () => {
  const e = env({ APP_ADMIN_PIN: 'admin-secret' });
  for (let i = 0; i < 21; i++) {
    assert.throws(() => e.ctx.checkAdmin_('wrong'), /Неверный код администратора/);
  }
  assert.equal(e.cache.get('pin_fail'), '21');
  assert.deepEqual(e.sleeps, [500]);
});
