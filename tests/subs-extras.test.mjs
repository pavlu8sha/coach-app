// Доп. программы (другая группа) идут в счёт основного абонемента: своего долга нет, переплата допускается.
// Настоящие SubsCode.js, SubsList.js, Debtors.js, Prices.js; таблицы — заглушки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Ana — U9-A + доп. weekends; Bob — только U9-A; Cid — U9-A + «Индивидуальные / Вратарские»
const PLAYERS = [
  { id: 'KS-1', name: 'Ana', group: 'U9-A', extras: ['weekends'], status: 'Активен' },
  { id: 'KS-2', name: 'Bob', group: 'U9-A', extras: [], status: 'Активен' },
  { id: 'KS-3', name: 'Cid', group: 'U9-A', extras: ['Индивидуальные / Вратарские'], status: 'Активен' },
];

function env(mg) {
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Settings.js', 'Prices.js', 'SubsCode.js', 'SubsList.js', 'Debtors.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  Object.assign(ctx, {
    norm, checkAdmin_() {}, dbRead_: () => null,
    monthGroups_: () => mg, payMonths_: () => ['10.26'], subLedger_: () => ({}),
    regData_: () => ({ players: PLAYERS }), indDebts_: () => [], indParse_: () => [], extraDebts_: () => [], extraParse_: () => [], extraPrices_: () => ({}),
  });
  return ctx;
}
const MG = (ana, anaW, bob, cidInd) => [
  { name: 'U9-A', rows: [{ name: 'Ana', paid: ana }, { name: 'Bob', paid: bob }, { name: 'Cid', paid: 165 }] },
  { name: 'weekends', rows: [{ name: 'Ana', paid: anaW }] },
  { name: 'Индивидуальные / Вратарские', rows: [{ name: 'Cid', paid: cidInd }] },
];

test('внесённое в блок доп. программы засчитывается в основной абонемент', () => {
  const c = env(MG(100, 65, 165, 0));
  assert.equal(c.effPaid_(MG(100, 65, 165, 0), 'U9-A', 'Ana', PLAYERS[0]), 165);
  const d = c.appDebtors('9', '10.26');
  assert.equal(d.count, 0);                                    // Ana оплатила 100 + 65 = 165
});

test('доп. программа не даёт отдельного долга; основной долг — с учётом её оплат', () => {
  const d = env(MG(0, 50, 165, 0)).appDebtors('9', '10.26');
  assert.equal(d.count, 1);
  const it = d.groups[0].items[0];
  assert.deepEqual([d.groups[0].name, it.name, it.paid, it.debt], ['U9-A', 'Ana', 50, 115]);
});

test('переплата допускается: оплачено больше тарифа — статус «оплачено», долга нет', () => {
  const c = env(MG(165, 130, 165, 0));
  assert.equal(c.effPaid_(MG(165, 130, 165, 0), 'U9-A', 'Ana', PLAYERS[0]), 295);
  assert.equal(c.appDebtors('9', '10.26').count, 0);
  const pm = c.appPayMonth('9', '10.26');
  const ana = pm.groups[0].rows.find(r => r.name === 'Ana'), w = pm.groups[1].rows[0];
  assert.deepEqual([ana.st, ana.paid], ['paid', 295]);
  assert.deepEqual([w.st, w.debt, w.extra], ['paid', 0, 'U9-A']);   // строка доп. программы: «в счёт U9-A»
});

test('индивидуальные — отдельно: оплата в их блоке не идёт в абонемент', () => {
  const c = env(MG(165, 0, 165, 50));
  assert.equal(c.effPaid_(MG(165, 0, 165, 50), 'U9-A', 'Cid', PLAYERS[2]), 165);
});

test('плашки в списке игроков: статус по основному абонементу, доп. программа не портит его', () => {
  const s = env(MG(100, 65, 0, 0)).appPaySummary('9', '10.26');
  assert.equal(s.map['KS-1'], 'paid');
  assert.equal(s.map['KS-2'], 'none');
});
