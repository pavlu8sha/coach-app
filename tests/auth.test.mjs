// Auth-примитивы NavCode.js (appWho, appCtx, requireRole, checkPin_, checkAny_, checkAdmin_) — настоящие.
// Заглушки: только сервисы GAS и prop_; коды APP_PIN='1', APP_ADMIN_PIN='9'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(over = {}) {
  const P = Object.assign({ APP_PIN: '1', APP_ADMIN_PIN: '9' }, over);
  const ctx = {
    console: { warn() {}, error() {}, log() {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    Utilities: { sleep() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'NavCode.js'), 'utf8'), ctx, { filename: 'NavCode.js' });
  ctx.prop_ = k => P[k];
  return ctx;
}

test('appCtx: роль по кодам тренера и администратора', () => {
  const e = env();
  const t = e.appCtx('1');
  assert.equal(t.role, 'trainer');
  assert.equal(t.admin, false);
  const a = e.appCtx('9');
  assert.equal(a.role, 'admin');
  assert.equal(a.admin, true);
});

test('appCtx: пустой и неверный код — «Неверный код доступа»', () => {
  const e = env();
  assert.throws(() => e.appCtx(''), /Неверный код доступа/);
  assert.throws(() => e.appCtx('0'), /Неверный код доступа/);
});

test('requireRole: админ-действие закрыто тренеру и пустому контексту', () => {
  const e = env();
  e.requireRole(e.appCtx('9'), ['admin']);
  e.requireRole(e.appCtx('1'), ['admin', 'trainer']);
  assert.throws(() => e.requireRole(e.appCtx('1'), ['admin']), /Недостаточно прав/);
  assert.throws(() => e.requireRole(null, ['admin']), /Недостаточно прав/);
  assert.throws(() => e.requireRole(e.appCtx('9'), []), /Недостаточно прав/);
});

test('checkPin_ и checkAny_: подходят оба кода, чужой — ошибка', () => {
  const e = env();
  for (const fn of ['checkPin_', 'checkAny_']) {
    e[fn]('1');
    e[fn]('9');
    assert.throws(() => e[fn](''), /Неверный код доступа/);
    assert.throws(() => e[fn]('0'), /Неверный код доступа/);
  }
});

test('checkAdmin_: только код администратора', () => {
  const e = env();
  e.checkAdmin_('9');
  assert.throws(() => e.checkAdmin_('1'), /Неверный код администратора/);
  assert.throws(() => e.checkAdmin_(''), /Неверный код администратора/);
});

test('checkAdmin_: без заданного свойства APP_ADMIN_PIN вход закрыт всем', () => {
  const e = env({ APP_ADMIN_PIN: null });
  assert.throws(() => e.checkAdmin_('9'), /Неверный код администратора/);
});
