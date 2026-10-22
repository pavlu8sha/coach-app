// attSS_ — таблица посещаемости (ATT_ID). Должна открываться через общий clubSource_ (Sources.js).
// Регрессия #12: в Players.js было два определения attSS_; в Apps Script действует последнее,
// и оно открывало таблицу напрямую, мимо clubSource_. Настоящие Sources.js и Players.js, SpreadsheetApp — имитация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(props) {
  const opened = [], logs = [];
  const ctx = {
    console: { warn() {}, error() {}, log() {} },
    CONFIG: { DRY_RUN: false, REGISTRY_SHEET: 'РЕЕСТР' },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }) }) },   // настоящая prop_ из Players.js
    Logger: { log: s => logs.push(String(s)) },
    SpreadsheetApp: { openById: id => { opened.push(id); return { id, getSheetByName: n => ({ file: id, name: n }) }; } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  // При двух определениях в Apps Script действует последнее по порядку файлов; после исправления определение одно
  for (const f of ['Sources.js', 'Players.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return { ctx, opened, logs };
}

test('attSS_ открывает таблицу посещаемости через clubSource_ и один раз за запуск', () => {
  const e = env({ ATT_ID: 'att-file' });
  const a = e.ctx.attSS_();
  const b = e.ctx.attSS_();
  assert.equal(a.id, 'att-file');
  assert.equal(a, b);
  assert.equal(a, e.ctx.clubSource_('ATT_ID', 'нет'));               // тот же объект, что в общем кэше источников
  assert.deepEqual(e.opened, ['att-file']);
  assert.deepEqual(e.logs.filter(s => s.startsWith('открытие ')).map(s => s.split(':')[0]), ['открытие ATT_ID']);
});

test('attSS_ и другой источник с тем же ID делят один открытый файл', () => {
  const e = env({ ATT_ID: 'same', ADMIN_ID: 'same' });
  assert.equal(e.ctx.attSS_(), e.ctx.clubSource_('ADMIN_ID', 'нет'));
  assert.deepEqual(e.opened, ['same']);
});

test('без ATT_ID — прежняя ошибка, файл не открывается', () => {
  const e = env({});
  assert.throws(() => e.ctx.attSS_(), /Не задано свойство ATT_ID \(ID таблицы посещаемости\)/);
  assert.deepEqual(e.opened, []);
});

test('выбор таблицы не изменился: листы AdminApp — из ADMIN_ID, остальные — из посещаемости', () => {
  const e = env({ ATT_ID: 'att-file' });
  e.ctx.adminSS_ = () => ({ getSheetByName: n => ({ file: 'admin', name: n }) });
  assert.equal(e.ctx.sheetOf_('ОПЛАТЫ').file, 'admin');
  assert.equal(e.ctx.sheetOf_('10.26').file, 'att-file');
});

test('в проекте ровно одно определение attSS_ и нет переменной _attSS', () => {
  const all = fs.readdirSync(ROOT).filter(f => /\.(js|gs)$/.test(f)).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.equal((all.match(/function\s+attSS_\s*\(/g) || []).length, 1);
  assert.doesNotMatch(all, /\b_attSS\b/);
});
