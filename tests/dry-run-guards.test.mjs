// Regression tests for write guards in DRY_RUN. All GAS services are mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(file, globals = {}) {
  const context = vm.createContext({
    console, Logger: { log() {} },
    CONFIG: { DRY_RUN: true },
    ...globals
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context;
}

test('indAutoTick does not persist IND_AUTO_LAST when weekly creation is skipped by DRY_RUN', () => {
  const props = new Map();
  let writes = 0;
  const context = load('Individual.js', {
    Session: { getScriptTimeZone: () => 'Asia/Tbilisi' },
    Utilities: { formatDate: (_date, _tz, pattern) => ({ u: '2', H: '10', 'yyyy-MM-dd': '2026-10-20' })[pattern] },
    settingGet_: key => ({ 'ind.autoDay': 'вт', 'ind.autoHour': 10 })[key],
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => props.get(key) || null,
      setProperty: (key, value) => { writes++; props.set(key, value); }
    }) }
  });
  context.indAutoTick();
  assert.equal(writes, 0);
  assert.equal(props.has('IND_AUTO_LAST'), false);
});

test('finance migration functions exit before any spreadsheet writes in DRY_RUN', () => {
  let spreadsheetAccess = 0;
  const context = load('AdminDb.js', {
    SpreadsheetApp: { getActive: () => { spreadsheetAccess++; throw new Error('must not access sheets in DRY_RUN'); } },
    adminSS_: () => { spreadsheetAccess++; throw new Error('must not access AdminApp in DRY_RUN'); }
  });
  assert.doesNotThrow(() => context.migrateFinance_());
  assert.doesNotThrow(() => context.migrateMatchFees_());
  assert.equal(spreadsheetAccess, 0);
});

test('importMatchesPreview does not create or clear the preview sheet in DRY_RUN', () => {
  let sheetAccess = 0;
  const context = load('MatchesImport.js', {
    adminSS_: () => { sheetAccess++; throw new Error('must not access AdminApp in DRY_RUN'); }
  });
  // Replace declarations after evaluating the source; function declarations in the source otherwise overwrite injected stubs.
  context.parseAllGames_ = () => ({ notes: [], events: [{ team: 'U9-A', type: 'Кубок', name: 'Test', rows: [{ name: 'Test Player' }] }] });
  context.readRegistry_ = () => ({ players: [{ name: 'Test Player' }] });
  assert.doesNotThrow(() => context.importMatchesPreview_());
  assert.equal(sheetAccess, 0);
});
