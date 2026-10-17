// Тесты посещаемости: восстановление отметок (appRoster) и сопоставление учеников (appSave / saveAttendance).
// Запуск: node --test tests/
// Работают на имитации таблицы в памяти, к Google не обращаются. Файл .mjs clasp в Apps Script не загружает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- имитация листа ----------
class FakeSheet {
  constructor(name, rows, id) {
    this.name = name; this.id = id;
    this.data = rows.map(r => r.slice());
    this.writes = 0;
  }
  cell(r, c) { const row = this.data[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v; this.writes++;
  }
  getSheetId() { return this.id; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if (this.data[i - 1].some(v => v !== '' && v !== false)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(...this.data.map(r => r.length), 1); }
  getMaxRows() { return this.data.length; }
  insertRowsBefore(at, n) { for (let k = 0; k < n; k++) this.data.splice(at - 1, 0, []); this.writes++; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    const grid = fn => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => fn(r + i, c + j)));
    return {
      getValues: () => grid((a, b) => sh.cell(a, b)),
      getDisplayValues: () => grid((a, b) => String(sh.cell(a, b))),
      getFormulas: () => grid(() => ''),
      getValue: () => sh.cell(r, c),
      setValue: v => sh.set(r, c, v),
      setValues: vals => vals.forEach((row, i) => row.forEach((v, j) => sh.set(r + i, c + j, v))),
      clearContent: () => grid((a, b) => sh.set(a, b, '')),
      copyTo: () => {},
      setNumberFormat: () => {},
    };
  }
}

const D = 3; // столбец C — первая колонка дат

// Лист месяца 10.26 с одним блоком группы. players — ФИ в строках блока, free — пустые строки.
// cols: { 7: [true,false,...] } — день -> значения чекбоксов по строкам; день попадает в шапку.
function monthSheet(group, players, free = 2, cols = {}) {
  const rows = [['FC KICKSTART'], [''], [''], [group], ['№', 'ФИ ребёнка']];
  const days = Object.keys(cols).map(Number);
  days.forEach((day, j) => { rows[4][D - 1 + j] = 46295 + day; }); // число таблицы: 46296 = 01.10.2026
  players.concat(Array(free).fill('')).forEach((nm, i) => {
    const row = [i + 1, nm];
    for (let c = 0; c < 18; c++) row.push(false); // чекбоксы C:T, по умолчанию FALSE
    days.forEach((day, j) => { if (cols[day][i] !== undefined) row[D - 1 + j] = cols[day][i]; });
    rows.push(row);
  });
  rows.push(['ИТОГ ГРУППЫ']);
  return rows;
}

function registry(players) { // [id, ФИ, группа, статус]
  return [['РЕЕСТР'], [''], ['ID', 'ФИ', 'Группа', 'Локация', 'Статус']]
    .concat(players.map(p => [p[0], p[1], p[2], 'Красный парк', p[3] || 'Активен', '', '', '']));
}

function journal(rows = []) {
  return [['ЖУРНАЛ'], [''], ['Запись ID', 'Дата', 'ID', 'ФИ', 'Группа', 'Локация', 'Статус', 'Тренер', 'Комм', 'Источник']].concat(rows);
}

function load(opts) {
  const sheets = {
    '10.26': new FakeSheet('10.26', opts.month, 1),
    'РЕЕСТР ИГРОКОВ': new FakeSheet('РЕЕСТР ИГРОКОВ', registry(opts.players), 2),
    'ЖУРНАЛ ПОСЕЩАЕМОСТИ': new FakeSheet('ЖУРНАЛ ПОСЕЩАЕМОСТИ', journal(opts.journal), 3),
  };
  if (opts.noJournal) delete sheets['ЖУРНАЛ ПОСЕЩАЕМОСТИ'];
  const ss = { getSheetByName: n => sheets[n] || null, getSpreadsheetTimeZone: () => 'Asia/Tbilisi' };
  const ctx = {
    console,
    SpreadsheetApp: { flush() {}, CopyPasteType: { PASTE_NORMAL: 0, PASTE_FORMAT: 1 } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '' },
    Logger: { log() {} },
    attSS_: () => ss,
    sheetOf_: n => ss.getSheetByName(n),
    readRegistry_: () => ({ players: opts.players.map(p => ({ id: p[0], name: p[1], group: p[2], status: p[3] || 'Активен', loc: 'Красный парк' })) }),
    checkPin_() {}, indIsGroup_: () => false, extraIsGroup_: () => false,
  };
  vm.createContext(ctx);
  const sp = fs.readFileSync(path.join(ROOT, 'SubsPay.js'), 'utf8');             // nfSafe_ — настоящая функция из SubsPay.js
  vm.runInContext(sp.slice(sp.indexOf('function nfSafe_'), sp.indexOf('\n', sp.indexOf('function nfSafe_'))), ctx);
  for (const f of opts.files || ['Attendance.js', 'WebApp.js']) {
    const src = typeof f === 'string' ? fs.readFileSync(path.join(ROOT, f), 'utf8') : f.src;
    vm.runInContext(src, ctx, { filename: typeof f === 'string' ? f : f.name });
  }
  return { ctx, sheets };
}

const G = 'U10-A', DAY = '2026-10-07';
const KIDS = [['KS-1', 'Bagulin Misha', G], ['KS-2', 'Kotov Rodion', G], ['KS-3', 'Zubkov Stepan', G]];

function save(env, present) { // present: {id: bool}
  const roster = env.ctx.appRoster('pin', G, DAY);
  const marks = roster.map(p => ({ id: p.id, name: p.name, present: !!present[p.id] }));
  return env.ctx.appSave('pin', G, DAY, marks);
}
const marksOf = r => Object.fromEntries(r.map(p => [p.id, p.mark || '']));
const fresh = (extra = {}) => load({ month: monthSheet(G, KIDS.map(k => k[1])), players: KIDS, ...extra });
const snapshot = env => JSON.stringify(Object.values(env.sheets).map(s => s.data));

// ---------- Задача 1: восстановление отметок ----------

test('все присутствовали: отметки восстанавливаются', () => {
  const env = fresh();
  save(env, { 'KS-1': true, 'KS-2': true, 'KS-3': true });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'p', 'KS-2': 'p', 'KS-3': 'p' });
});

test('все отсутствовали: отметки восстанавливаются', () => {
  const env = fresh();
  const rep = save(env, {});
  assert.equal(rep.results.filter(r => r.result.startsWith('НЕ')).length, 0);
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': 'a', 'KS-3': 'a' });
});

test('смешанные отметки восстанавливаются', () => {
  const env = fresh();
  save(env, { 'KS-2': true });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': 'p', 'KS-3': 'a' });
});

test('пересохранение: «все были» -> «никого не было» восстанавливается и журнал обновляется, а не дублируется', () => {
  const env = fresh();
  save(env, { 'KS-1': true, 'KS-2': true, 'KS-3': true });
  save(env, {});
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': 'a', 'KS-3': 'a' });
  const j = env.sheets['ЖУРНАЛ ПОСЕЩАЕМОСТИ'].data.slice(3);
  assert.equal(j.length, 3);
  assert.ok(j.every(r => r[6] === 'Отсутствовал'));
});

test('дата без сохранённых отметок (даты нет в шапке): отметок нет', () => {
  const env = fresh();
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': '', 'KS-2': '', 'KS-3': '' });
});

test('дата вписана в шапку вручную, галочек нет, в журнале пусто: считается неотмеченной', () => {
  const env = load({ month: monthSheet(G, KIDS.map(k => k[1]), 2, { 7: [false, false, false] }), players: KIDS });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': '', 'KS-2': '', 'KS-3': '' });
});

test('журнал другой группы или другой даты не влияет', () => {
  const env = load({
    month: monthSheet(G, KIDS.map(k => k[1]), 2, { 7: [false, false, false] }), players: KIDS,
    journal: [['ATT-1', '07.10.2026', 'KS-9', 'Other', 'U10-B', '', 'Отсутствовал', '', '', 'Приложение'],
              ['ATT-2', '08.10.2026', 'KS-1', 'Bagulin Misha', G, '', 'Отсутствовал', '', '', 'Приложение']],
  });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': '', 'KS-2': '', 'KS-3': '' });
});

test('историческая отметка вручную в таблице (без журнала) восстанавливается, чтение ничего не пишет', () => {
  const env = load({ month: monthSheet(G, KIDS.map(k => k[1]), 2, { 7: [true, false, ''] }), players: KIDS });
  const before = snapshot(env);
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'p', 'KS-2': 'a', 'KS-3': 'a' });
  assert.equal(snapshot(env), before);
});

test('частично заполненный блок: ребёнок, которого нет в листе, остаётся неотмеченным', () => {
  const kids = KIDS.concat([['KS-4', 'New Kid', G]]);
  const env = load({ month: monthSheet(G, KIDS.map(k => k[1]), 2, { 7: [true, false, false] }), players: kids });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'p', 'KS-2': 'a', 'KS-3': 'a', 'KS-4': '' });
});

test('сохранение не трогает другие даты и другие строки', () => {
  const env = load({ month: monthSheet(G, KIDS.map(k => k[1]), 2, { 5: [true, true, false] }), players: KIDS });
  save(env, {});
  const sh = env.sheets['10.26'];
  assert.deepEqual([6, 7, 8].map(r => sh.cell(r, D)), [true, true, false]); // 05.10 не изменилось
  assert.deepEqual([6, 7, 8].map(r => sh.cell(r, D + 1)), [false, false, false]); // 07.10 записано
});

// ---------- Задача 2: идентификация учеников ----------

test('пробелы и регистр в ФИ: строка находится, новая строка не добавляется', () => {
  const env = load({ month: monthSheet(G, ['  bagulin   MISHA ', 'Kotov Rodion', 'Zubkov Stepan']), players: KIDS });
  const rep = save(env, { 'KS-1': true });
  assert.ok(rep.results.every(r => r.result === 'записан'));
  const sh = env.sheets['10.26'];
  assert.equal(sh.cell(6, D), true);
  assert.equal(sh.cell(9, 2), ''); // свободная строка осталась свободной
  assert.equal(marksOf(env.ctx.appRoster('pin', G, DAY))['KS-1'], 'p');
});

test('одинаковые ФИ с разными ID: отметки не смешиваются и не пишутся в одну строку', () => {
  const kids = [['KS-1', 'Vartanov Daniel', G], ['KS-2', 'Vartanov Daniel', G], ['KS-3', 'Zubkov Stepan', G]];
  const env = load({ month: monthSheet(G, ['Vartanov Daniel', 'Zubkov Stepan']), players: kids });
  const rep = env.ctx.appSave('pin', G, DAY, [
    { id: 'KS-1', name: 'Vartanov Daniel', present: true },
    { id: 'KS-2', name: 'Vartanov Daniel', present: false },
    { id: 'KS-3', name: 'Zubkov Stepan', present: true },
  ]);
  const bad = rep.results.filter(r => r.result.startsWith('НЕ'));
  assert.deepEqual([...bad.map(r => r.id)].sort(), ['KS-1', 'KS-2']);
  const sh = env.sheets['10.26'];
  assert.equal(sh.cell(6, D), false); // строка Vartanov не тронута
  assert.equal(sh.cell(8, 2), '');    // второй Vartanov не вписан в свободную строку
  assert.equal(sh.cell(7, D), true);  // Zubkov записан
  const j = env.sheets['ЖУРНАЛ ПОСЕЩАЕМОСТИ'].data.slice(3);
  assert.deepEqual(j.map(r => r[2]), ['KS-3']); // в журнал только реально записанное
  const m = marksOf(env.ctx.appRoster('pin', G, DAY));
  assert.equal(m['KS-1'], ''); assert.equal(m['KS-2'], ''); assert.equal(m['KS-3'], 'p');
});

test('две строки с одним ФИ в блоке: отметка не пишется и не подставляется', () => {
  const kids = [['KS-1', 'Vartanov Daniel', G], ['KS-3', 'Zubkov Stepan', G]];
  const env = load({ month: monthSheet(G, ['Vartanov Daniel', 'Vartanov Daniel', 'Zubkov Stepan'], 2, { 7: [true, false, true] }), players: kids });
  assert.equal(marksOf(env.ctx.appRoster('pin', G, DAY))['KS-1'], '');
  const rep = env.ctx.appSave('pin', G, DAY, [
    { id: 'KS-1', name: 'Vartanov Daniel', present: false },
    { id: 'KS-3', name: 'Zubkov Stepan', present: true },
  ]);
  assert.ok(rep.results.find(r => r.id === 'KS-1').result.startsWith('НЕ записано'));
  const sh = env.sheets['10.26'];
  assert.deepEqual([6, 7].map(r => sh.cell(r, D)), [true, false]); // обе строки Vartanov без изменений
});

test('ушедший игрок с тем же ФИ не мешает активному', () => {
  const kids = [['KS-172', 'Vartanov Daniel', G, 'Ушёл'], ['KS-173', 'Vartanov Daniel', G], ['KS-3', 'Zubkov Stepan', G]];
  const env = load({ month: monthSheet(G, ['Vartanov Daniel', 'Zubkov Stepan']), players: kids });
  const roster = env.ctx.appRoster('pin', G, DAY);
  assert.deepEqual([...roster.map(p => p.id)], ['KS-173', 'KS-3']);
  const rep = save(env, { 'KS-173': true });
  assert.ok(rep.results.every(r => !r.result.startsWith('НЕ')));
  const j = env.sheets['ЖУРНАЛ ПОСЕЩАЕМОСТИ'].data.slice(3);
  assert.equal(j.find(r => r[3] === 'Vartanov Daniel')[2], 'KS-173'); // журнал по ID активного
});

test('похожее написание (опечатка) по-прежнему не записывается, а предупреждает', () => {
  const kids = [['KS-1', 'Bagilin Misha', G], ['KS-2', 'Kotov Rodion', G]];
  const env = load({ month: monthSheet(G, ['Bagulin Misha', 'Kotov Rodion']), players: kids });
  const rep = save(env, { 'KS-1': true, 'KS-2': true });
  const r1 = rep.results.find(r => r.name === 'Bagilin Misha');
  assert.match(r1.result, /похожее имя/);
  assert.equal(env.sheets['10.26'].cell(8, 2), ''); // дубль строки не создан
});

// ---------- Рецензия 15.10: восстановление по журналу для каждого ученика ----------

const JDAY = '07.10.2026';
const jr = (id, name, status, group = G, date = JDAY) => ['ATT-x', date, id, name, group, '', status, '', '', 'Приложение'];
const allFalse = (extra = {}) => load({ month: monthSheet(G, KIDS.map(k => k[1]), 2, { 7: [false, false, false] }), players: KIDS, ...extra });

test('Р1. все отсутствовали, журнал есть по всем: восстанавливаются все', () => {
  const env = allFalse({ journal: [jr('KS-1', 'Bagulin Misha', 'Отсутствовал'), jr('KS-2', 'Kotov Rodion', 'Отсутствовал'), jr('KS-3', 'Zubkov Stepan', 'Отсутствовал')] });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': 'a', 'KS-3': 'a' });
});

test('Р2. сохранена часть, TRUE нет: восстанавливаются только ученики с записью в журнале', () => {
  const env = allFalse({ journal: [jr('KS-1', 'Bagulin Misha', 'Отсутствовал'), jr('KS-2', 'Kotov Rodion', 'Отсутствовал')] });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': 'a', 'KS-3': '' });
});

test('Р3. записи журнала другой группы или другой даты (по тем же ID) не влияют', () => {
  const env = allFalse({ journal: [jr('KS-1', 'Bagulin Misha', 'Отсутствовал', 'U10-B'), jr('KS-2', 'Kotov Rodion', 'Отсутствовал', G, '08.10.2026')] });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': '', 'KS-2': '', 'KS-3': '' });
});

test('Р4. исторические ручные отметки с хотя бы одной TRUE и без журнала: прежнее поведение', () => {
  const env = load({ month: monthSheet(G, KIDS.map(k => k[1]), 2, { 7: [false, true, false] }), players: KIDS });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': 'p', 'KS-3': 'a' });
});

test('Р5. журнала нет или он пуст: ложных отметок нет, ошибки нет', () => {
  const none = allFalse({ noJournal: true });
  assert.deepEqual(marksOf(none.ctx.appRoster('pin', G, DAY)), { 'KS-1': '', 'KS-2': '', 'KS-3': '' });
  const empty = allFalse({ journal: [] });
  assert.deepEqual(marksOf(empty.ctx.appRoster('pin', G, DAY)), { 'KS-1': '', 'KS-2': '', 'KS-3': '' });
});

test('Р6. у ученика нет своей записи: состояние не выводится из чужих (в т. ч. записи с тем же ФИ и другим ID)', () => {
  const env = allFalse({ journal: [jr('KS-1', 'Bagulin Misha', 'Отсутствовал'), jr('KS-99', 'Zubkov Stepan', 'Отсутствовал')] });
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': '', 'KS-3': '' });
});

test('журнал «Присутствовал», а в листе галочку сняли вручную: лист главнее, «не был»', () => {
  const env = allFalse({ journal: [jr('KS-1', 'Bagulin Misha', 'Присутствовал')] });
  assert.equal(marksOf(env.ctx.appRoster('pin', G, DAY))['KS-1'], 'a');
});

test('ученик в двух группах в один день: журнал ведётся по каждой группе отдельно', () => {
  const G2 = 'U10-B';
  const kids = [['KS-1', 'Bagulin Misha', G, 'Активен'], ['KS-2', 'Kotov Rodion', G], ['KS-5', 'Amodeo Nolan', G2]];
  const month = monthSheet(G, ['Bagulin Misha', 'Kotov Rodion'])
    .concat([[''], [G2], ['№', 'ФИ ребёнка']], monthSheet(G2, ['Amodeo Nolan', 'Bagulin Misha']).slice(5));
  const reg = kids.map(k => k.slice());
  const env = load({ month, players: reg });
  env.ctx.appSave('pin', G, DAY, [{ id: 'KS-1', name: 'Bagulin Misha', present: true }, { id: 'KS-2', name: 'Kotov Rodion', present: true }]);
  env.ctx.appSave('pin', G2, DAY, [{ id: 'KS-5', name: 'Amodeo Nolan', present: false }, { id: 'KS-1', name: 'Bagulin Misha', present: false }]);
  const j = env.sheets['ЖУРНАЛ ПОСЕЩАЕМОСТИ'].data.slice(3).map(r => r[2] + '|' + r[4] + '|' + r[6]).sort();
  assert.deepEqual(j, ['KS-1|U10-A|Присутствовал', 'KS-1|U10-B|Отсутствовал', 'KS-2|U10-A|Присутствовал', 'KS-5|U10-B|Отсутствовал']);
});

// ---------- Рецензия 15.10: сбой записи журнала ----------

test('журнал не записался: лист записан, ошибка прямо говорит об этом; повторное сохранение всё восстанавливает', () => {
  const env = fresh({ noJournal: true });
  assert.throws(() => save(env, {}), /записаны в лист 10\.26, но журнал посещаемости не обновлён/);
  const sh = env.sheets['10.26'];
  assert.equal(sh.cell(5, D), 46302);                                  // дата вписана в шапку
  assert.deepEqual([6, 7, 8].map(r => sh.cell(r, D)), [false, false, false]);
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': '', 'KS-2': '', 'KS-3': '' }); // без журнала не выдумываем
  env.sheets['ЖУРНАЛ ПОСЕЩАЕМОСТИ'] = new FakeSheet('ЖУРНАЛ ПОСЕЩАЕМОСТИ', journal(), 3); // лист вернули
  save(env, {});
  assert.equal(env.sheets['ЖУРНАЛ ПОСЕЩАЕМОСТИ'].data.length - 3, 3);
  assert.deepEqual(marksOf(env.ctx.appRoster('pin', G, DAY)), { 'KS-1': 'a', 'KS-2': 'a', 'KS-3': 'a' });
});
