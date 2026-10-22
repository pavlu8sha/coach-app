import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const PRIVATE_FUNCTIONS = {
  'AdminDb.js': ['migrateFinance', 'verifyFinance', 'migrateMatchFees', 'verifyMatchFees'],
  'Attendance.js': ['attJournalCheck'],
  'MatchesImport.js': ['importMatchesPreview', 'importMatchesCommit', 'u9Champ1Preview', 'u9Champ1Apply'],
  'SelfTest.js': ['perfAtt'],
  'Perf.js': ['perfReport', 'perfPage'],
  'Audit.js': ['auditSheets'],
  'PayNamesCheck.js': ['payNamesNotInRegistry'],
  'IndReconcile.js': ['indPayReconcile'],
  'Individual.js': ['indTest', 'indWriteTest', 'indFormatAll'],
  'GamesNew.js': ['envCheck'],
  'Warmup.js': ['warmTest'],
  'Extra.js': ['extraTest', 'extraWriteTest'],
  'Camps.js': ['campsTest'],
  'Funnel.js': ['funnelTest'],
  'IndRoster.js': ['indMigrateReport', 'indMigrateApply'],
};

test('служебные и ручные функции не доступны как публичные google.script.run endpoints', () => {
  for (const [file, names] of Object.entries(PRIVATE_FUNCTIONS)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const name of names) {
      assert.match(source, new RegExp('function\\s+' + name + '_\\s*\\('), file + ': ' + name + '_ должен существовать');
      assert.doesNotMatch(source, new RegExp('function\\s+' + name + '\\s*\\('), file + ': публичный ' + name + ' не должен существовать');
    }
  }
});

// Установщики триггеров и selfTest запускаются из меню «Выполнить», поэтому остаются публичными обёртками:
// работа — в приватной функции, обёртка ничего не возвращает, установщики требуют окна обслуживания (Maint.js).
const WRAPPED = {
  'SelfTest.js': ['selfTest'],
  'Warmup.js': ['installWarmTrigger'],
  'Individual.js': ['indInstallTrigger'],
};

test('selfTest и установщики: публичная обёртка без return + приватная функция', () => {
  for (const [file, names] of Object.entries(WRAPPED)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const name of names) {
      const m = source.match(new RegExp('function\\s+' + name + '\\s*\\(\\)\\s*\\{([^}]*)\\}'));
      assert.ok(m, file + ': нет публичной обёртки ' + name);
      assert.doesNotMatch(m[1], /return/, file + ': обёртка ' + name + ' не должна возвращать результат');
      assert.match(m[1], new RegExp(name + '_\\(\\)'), file + ': обёртка ' + name + ' вызывает ' + name + '_');
      if (name !== 'selfTest') assert.match(m[1], /^\s*maintCheck_\(\);/, file + ': ' + name + ' сначала проверяет окно обслуживания');
      assert.match(source, new RegExp('function\\s+' + name + '_\\s*\\('), file + ': ' + name + '_ должен существовать');
    }
  }
});
