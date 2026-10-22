import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'MigrationExport.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('function csvCell_'), src.indexOf('function migrationExport')), ctx);

test('CSV: кавычки, запятые, переносы строк', () => {
  assert.equal(ctx.csvCell_('a,b'), '"a,b"');
  assert.equal(ctx.csvCell_('say "hi"'), '"say ""hi"""');
  assert.equal(ctx.csvCell_('x\ny'), '"x\ny"');
  assert.equal(ctx.csvCell_(null), '');
});

test('CSV: строки и столбцы сохраняются', () => {
  assert.equal(ctx.csvText_([['ФИ', 'Оплата'], ['Иванов, А', '165']]), 'ФИ,Оплата\n"Иванов, А",165');
});

test('воронка не выгружается; имена файлов без запрещённых символов', () => {
  assert.ok(src.includes('isFunnelSheet_'));
  assert.equal(ctx.exportFileName_('ОПЛАТЫ 11/26'), 'ОПЛАТЫ 11_26.csv');
});

test('выгрузка защищена окном обслуживания', () => {
  const body = src.slice(src.indexOf('function migrationExport'));
  assert.match(body, /maintCheck_\(\)/);
});
