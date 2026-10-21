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
  'SelfTest.js': ['selfTest', 'perfAtt'],
  'Perf.js': ['perfReport', 'perfPage'],
  'Audit.js': ['auditSheets'],
  'PayNamesCheck.js': ['payNamesNotInRegistry'],
  'IndReconcile.js': ['indPayReconcile'],
  'Individual.js': ['indTest', 'indWriteTest', 'indFormatAll', 'indInstallTrigger'],
  'GamesNew.js': ['envCheck'],
  'Warmup.js': ['installWarmTrigger', 'warmTest'],
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
