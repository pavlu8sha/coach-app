// clubSource_ (Sources.js): открытие файлов клуба — один открытый экземпляр на ID за запуск, тексты ошибок сохранены.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(props) {
  let opens = 0;
  const opened = {};
  const ctx = {
    console: { warn() {}, error() {}, log() {} },
    Logger: { log() {} },
    prop_: k => props[k],
    SpreadsheetApp: { openById: id => (opened[id] = opened[id] || { id }) && (opens++, opened[id]) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Sources.js'), 'utf8'), ctx, { filename: 'Sources.js' });
  return { ctx, count: () => opens };
}

test('clubSource_: один открытый файл на ID за запуск', () => {
  const e = env({ ATT_ID: 'A1' });
  const a = e.ctx.clubSource_('ATT_ID', 'нет ID');
  const b = e.ctx.clubSource_('ATT_ID', 'нет ID');
  assert.equal(a, b);
  assert.equal(e.count(), 1);
});

test('clubSource_: два свойства с одним ID открывают один файл', () => {
  const e = env({ ATT_ID: 'X', GAMES_ID: 'X' });
  const a = e.ctx.clubSource_('ATT_ID', 'м1');
  const b = e.ctx.clubSource_('GAMES_ID', 'м2');
  assert.equal(a, b);
  assert.equal(e.count(), 1);
});

test('clubSource_: разные ID — разные файлы', () => {
  const e = env({ ATT_ID: 'A', PAY_ID: 'B' });
  assert.notEqual(e.ctx.clubSource_('ATT_ID', 'м1'), e.ctx.clubSource_('PAY_ID', 'м2'));
  assert.equal(e.count(), 2);
});

test('clubSource_: без свойства — ошибка с переданным текстом, файл не открывается', () => {
  const e = env({});
  assert.throws(() => e.ctx.clubSource_('ATT_ID', 'Не задано свойство ATT_ID'), /Не задано свойство ATT_ID/);
  assert.equal(e.count(), 0);
});
