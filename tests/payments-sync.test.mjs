// Дописывание пропущенных активных игроков в лист месяца оплат: план без таблиц.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Достаём функцию по имени целиком (до закрывающей строки «}» на нулевом отступе).
function fnSource(src, name) {
  const s = src.indexOf('function ' + name + '(');
  assert.ok(s >= 0, 'нет функции ' + name);
  const e = src.indexOf('\n}\n', s);
  return src.slice(s, e + 3);
}

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fnSource(read('Attendance.js'), 'norm'), ctx);
  vm.runInContext(fnSource(read('MonthsCode.js'), 'planPayMonthSync_'), ctx);
  return ctx;
}

// Блоки в том виде, как их отдаёт parseMonth_: name + rows (row, name)
const groups = () => [
  { name: 'U7-A', rows: [{ row: 7, name: 'Krupin Gregoriy' }, { row: 8, name: 'Zlidnev Ilia' }, { row: 9, name: '' }] },
  { name: 'U9-A', rows: [{ row: 14, name: 'Goltsev Max' }] },
];

test('дописывает активного игрока, которого нет в листе, в блок его группы', () => {
  const ctx = load();
  const plan = ctx.planPayMonthSync_(groups(), [{ name: 'Volobueva Sofia', group: 'U7-A' }]);
  assert.equal(plan.adds.length, 1);
  assert.equal(plan.adds[0].name, 'Volobueva Sofia');
  assert.equal(plan.adds[0].group.name, 'U7-A');
  assert.equal(plan.unmatched.length, 0);
});

test('уже есть в листе (любой блок, без учёта регистра и пробелов) — не дублирует', () => {
  const ctx = load();
  const plan = ctx.planPayMonthSync_(groups(), [{ name: '  krupin   gregoriy ', group: 'U7-A' }]);
  assert.equal(plan.adds.length, 0);
});

test('игрок без блока своей группы — в unmatched, не пишется в чужой блок', () => {
  const ctx = load();
  const plan = ctx.planPayMonthSync_(groups(), [{ name: 'Новый Игрок', group: 'U11-B' }]);
  assert.equal(plan.adds.length, 0);
  assert.equal(JSON.stringify(plan.unmatched), JSON.stringify([{ name: 'Новый Игрок', group: 'U11-B' }]));
});

test('один игрок из реестра не добавляется дважды', () => {
  const ctx = load();
  const plan = ctx.planPayMonthSync_(groups(), [
    { name: 'Bayramov Renat', group: 'U9-A' }, { name: 'Bayramov Renat', group: 'U9-A' },
  ]);
  assert.equal(plan.adds.length, 1);
});

test('пустые строки блока (нет имени) не считаются присутствием игрока', () => {
  const ctx = load();
  const plan = ctx.planPayMonthSync_(groups(), [{ name: 'Simutkin Tikhon', group: 'U7-A' }]);
  assert.equal(plan.adds.length, 1);
});

test('запуск из приложения защищён PIN администратора и не зависит от окна обслуживания', () => {
  const src = read('MonthsCode.js');
  const s = src.indexOf('function appSyncPayMonth(');
  assert.ok(s >= 0, 'нет appSyncPayMonth');
  const body = src.slice(s, src.indexOf('\n}\n', s) + 3);
  assert.match(body, /checkAdmin_\(pin\)/);
  assert.doesNotMatch(body, /maintCheck_/);
});

test('дата рождения пишется как текст в колонку C', () => {
  const src = read('MonthsCode.js');
  assert.match(src, /function setBirthCell_\(sh, row, d\)[\s\S]*?nfSafe_\(rg, '@'\)/);
});
