import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(props = {}) {
  const opened = [];
  const files = new Map();
  const ctx = {
    prop_: key => props[key] || null,
    SpreadsheetApp: {
      openById: id => {
        opened.push(id);
        if (!files.has(id)) files.set(id, { id });
        return files.get(id);
      },
    },
    Logger: { log() {} },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Sources.js'), 'utf8'), ctx, { filename: 'Sources.js' });
  return { ctx, opened, files };
}

test('clubSource_ открывает один файл один раз за выполнение', () => {
  const e = env({ ADMIN_ID: 'file-1', CAMP_ID: 'file-1' });
  const a = e.ctx.clubSource_('ADMIN_ID', 'нет ADMIN_ID');
  const b = e.ctx.clubSource_('ADMIN_ID', 'нет ADMIN_ID');
  const c = e.ctx.clubSource_('CAMP_ID', 'нет CAMP_ID');
  assert.equal(a, b);
  assert.equal(a, c);
  assert.deepEqual(e.opened, ['file-1']);
});

test('clubSource_ открывает разные ID отдельно', () => {
  const e = env({ ADMIN_ID: 'file-1', EQUIP_ID: 'file-2' });
  const a = e.ctx.clubSource_('ADMIN_ID', 'нет ADMIN_ID');
  const b = e.ctx.clubSource_('EQUIP_ID', 'нет EQUIP_ID');
  assert.notEqual(a, b);
  assert.deepEqual(e.opened, ['file-1', 'file-2']);
});

test('clubSource_ сообщает об отсутствующем ID до открытия файла', () => {
  const e = env();
  assert.throws(() => e.ctx.clubSource_('ADMIN_ID', 'не задан ADMIN_ID'), /не задан ADMIN_ID/);
  assert.deepEqual(e.opened, []);
});

test('clubSource_ не принимает унаследованные ключи кэша за открытый файл', () => {
  const e = env({ ADMIN_ID: 'toString' });
  const a = e.ctx.clubSource_('ADMIN_ID', 'нет ADMIN_ID');
  assert.equal(a.id, 'toString');
  assert.deepEqual(e.opened, ['toString']);
});
