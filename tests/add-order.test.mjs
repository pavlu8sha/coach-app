// Сохранение нового заказа экипировки (appAddOrder): что и куда записывается, сколько раз читается реестр,
// и строка замера в журнале выполнения — без ФИ, ID и сумм.
// Настоящие EquipView.js, EquipLinks.js, EquipLocation.js; таблицы — имитация в памяти.
// Колонка M (13) здесь не проверяется: в ней сейчас пересекаются «Локация» и «Кол-во» (отдельная задача).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

class Sheet {
  constructor(rows, parent) { this.data = rows.map(r => r.slice()); this.parent = parent; this.reads = 0; this.formulas = {}; this.formatCopies = []; this.rules = []; }
  insertRowsBefore(at, n) {
    for (let i = 0; i < n; i++) this.data.splice(at - 1, 0, Array(15).fill(''));
    const f = {};
    for (const [k, v] of Object.entries(this.formulas)) { const [a, b] = k.split(':').map(Number); f[(a >= at ? a + n : a) + ':' + b] = v; }
    this.formulas = f;
    // «Умная таблица» Google протягивает в новые строки формулы соседней строки (здесь — строки итогов): H, I, J, K
    // H — '=IF(C…;"";1)' (значение пустое), I:K — сдвинутые SUM итогов (#REF!), как в боевом листе 22.10
    if (this.smart) for (let r = at; r < at + n; r++) {
      this.put(r, 8, ''); this.formulas[r + ':8'] = '=IF(C' + r + '="";"";1)';
      for (const c of [9, 10, 11]) { this.put(r, c, '#REF!'); this.formulas[r + ':' + c] = '=SUM(#REF!)'; }
    }
  }
  getLastColumn() { return 15; }
  getConditionalFormatRules() { return this.rules; }
  setConditionalFormatRules(r) { this.rules = r; }
  getLastRow() { let n = this.data.length; while (n && this.data[n - 1].every(x => x === '' || x === undefined)) n--; return n; }
  getParent() { return this.parent; }
  cell(a, b) { const x = this.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; }
  put(a, b, v) { while (this.data.length < a) this.data.push([]); const r = this.data[a - 1]; while (r.length < b) r.push(''); r[b - 1] = v; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    const grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    const rg = {
      getValues: () => { sh.reads++; return grid((a, b) => sh.cell(a, b)); },
      getDisplayValues: () => { sh.reads++; return grid((a, b) => String(sh.cell(a, b))); },
      getValue: () => { sh.reads++; return sh.cell(r, c); },
      setValues: v => { v.forEach((row, i) => row.forEach((x, j) => sh.put(r + i, c + j, x))); return rg; },
      setValue: x => { sh.put(r, c, x); return rg; },
      clearContent: () => { for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { sh.put(r + i, c + j, ''); delete sh.formulas[(r + i) + ':' + (c + j)]; } return rg; },
      getNumberFormats: () => grid(() => ''), setNumberFormats: () => rg, setNumberFormat: () => rg,
      setHorizontalAlignment: () => rg, setFontWeight: () => rg,
      getFormula: () => sh.formulas[r + ':' + c] || '',
      getFormulas: () => grid((a, b) => sh.formulas[a + ':' + b] || ''),
      setFormulas: v => { v.forEach((row, i) => row.forEach((x, j) => { sh.formulas[(r + i) + ':' + (c + j)] = x; })); return rg; },
      getRow: () => r, getColumn: () => c, getNumRows: () => n, getNumColumns: () => m, getLastRow: () => r + n - 1,
      setFormula: f => { sh.formulas[r + ':' + c] = f; return rg; },
      copyTo: (dst, how) => { if (how === 'm') sh.formatCopies.push([r, dst.getRow(), dst.getNumRows()]); else dst.setFormula('=copy'); return rg; },
    };
    return rg;
  }
}

const EMPTY = () => Array(14).fill('');
// Заказ: [№, дата, ФИ, комплект, размер, надпись, номер, рассрочка, сумма, оплачено, долг, ID, M, № ORD]
function eqSheet() {
  const rows = [['ЭКИПИРОВКА'], [''], ['№', 'Дата', 'ФИ', 'Комплект', 'Размер', 'Надпись', 'Номер', 'Рассрочка', 'Сумма', 'Оплачено', 'Долг', 'ID игрока', 'Локация', '№ заказа']];
  rows.push([1, 46000, 'Alpha A', 'Игровая форма', '140', '', '7', '', 200, 200, 0, 'KS-1', 'Парк', 'ORD-0001']);
  rows.push([2, 46001, 'Beta B', 'Дождевик', '128', '', '', '', 150, 0, 150, 'KS-2', 'Парк', 'ORD-0002']);
  rows.push([3, '', '', '', '', '', '', '', '', '', '', '', '', 'ORD-0007']);   // свободная строка с заранее прописанным номером
  rows.push([4, '', '', '', '', '', '', '', '', '', '', '', '', 'ORD-0003']);   // пустая строка с тем же номером, что получит новый заказ
  for (let i = rows.length; i < 3 + 250; i++) rows.push(EMPTY());
  const file = { getSheetByName: n => (n === 'ФАКТ ПОШИВА' ? null : null) };
  const sh = new Sheet(rows, file);
  sh.formulas['5:11'] = '=MAX(I5-J5,0)';
  return sh;
}

function env() {
  const eq = eqSheet();
  const ps = new Sheet([['Время', 'Дата', 'ID', 'ФИ', 'За что', 'Строка заказа', 'Сумма', 'Комментарий', 'Способ']]);
  const logs = [], changes = [];
  let regReads = 0;
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, Logger: { log: s => logs.push(String(s)) },
    CONFIG: { DRY_RUN: false },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { CopyPasteType: { PASTE_FORMULA: 'f', PASTE_FORMAT: 'm' } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Equip.js', 'EquipView.js', 'EquipLinks.js', 'EquipLocation.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const att = fs.readFileSync(path.join(ROOT, 'Attendance.js'), 'utf8'), s = att.indexOf('function serialOf');
  vm.runInContext(att.slice(s, att.indexOf('\n}\n', s) + 2), ctx);
  const sp = fs.readFileSync(path.join(ROOT, 'SubsPay.js'), 'utf8');
  vm.runInContext(sp.slice(sp.indexOf('function nfSafe_'), sp.indexOf('\n', sp.indexOf('function nfSafe_'))), ctx);
  Object.assign(ctx, {
    PAY_SHEET: 'ОПЛАТЫ', PAY_HEAD: [], PAY_METHODS: ['Наличные', 'Перевод'],
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    equipSheet_: () => eq,
    catalog_: () => [{ name: 'Игровая форма', price: 200, active: true }, { name: 'Дождевик', price: 150, active: true }],
    readRegistry_: () => { regReads++; return { players: [
      { id: 'KS-1', name: 'Alpha A', loc: 'Парк' }, { id: 'KS-2', name: 'Beta B', loc: 'Парк' }, { id: 'KS-3', name: 'Gamma C', loc: 'Сабуртало' }] }; },
    dbRead_: n => (n === 'ОПЛАТЫ' ? ps : null), dbSheet_: n => (n === 'ОПЛАТЫ' ? ps : null),
    logChange_: (...a) => changes.push(a), today_: () => '2026-10-22',
    settingGet_: () => null,
  });
  return { ctx, eq, ps, logs, changes, regReads: () => regReads };
}

test('новый заказ: строка, № ORD, долг, платёж «при заказе», журнал изменений — как раньше', () => {
  const e = env();
  const r = e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Игровая форма', sum: 200, paid: 50, method: 'Наличные', size: '152', num: '9', date: '2026-10-22' });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true, dryRun: false, row: 6 });
  const row = e.eq.data[5];
  assert.deepEqual(row.slice(0, 12), [3, e.ctx.serialOf('2026-10-22'), 'Gamma C', 'Игровая форма', '152', '', '9', '', 200, 50, '', 'KS-3']);
  assert.equal(row[13], 'ORD-0003');                                // первый свободный номер после ORD-0001, ORD-0002
  assert.equal(e.eq.data[6][13], '');                               // тот же номер снят с пустой строки ниже
  assert.equal(e.eq.formulas['6:11'], '=copy');                     // формула долга скопирована из строки выше
  assert.deepEqual(e.ps.data[1].slice(1), ['2026-10-22', 'KS-3', 'Gamma C', 'Экипировка: Игровая форма', 3, 50, 'при заказе', 'Наличные']);
  assert.deepEqual(e.changes, [['KS-3', 'Gamma C', 'новый заказ экипировки', '', 'Игровая форма, 200 ₾, строка 6']]);
});

test('реестр игроков читается один раз за сохранение заказа', () => {
  const e = env();
  e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  assert.equal(e.regReads(), 1);
});

test('журнал выполнения: одна строка замера по шагам, без ФИ, ID, сумм и номеров', () => {
  const e = env();
  e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Игровая форма', sum: 200, paid: 50, method: 'Наличные', size: '152', num: '9' });
  const lines = e.logs.filter(s => s.startsWith('заказ экипировки:'));
  assert.equal(lines.length, 1, e.logs.join('\n'));
  assert.match(lines[0], /^заказ экипировки: каталог \d+ мс, [^]*итого \d+ мс$/);
  for (const step of ['реестр', 'лист заказов', 'проверка повтора', 'номер ORD', 'запись строки', 'локации', 'оплата', 'журнал', 'итого']) assert.match(lines[0], new RegExp(step + ' \\d+ мс'));
  assert.doesNotMatch(lines[0], /Gamma|KS-|200|ORD-|Игровая|Наличные/);
});

test('ошибка проверки — ничего не записано, замер не пишется', () => {
  const e = env();
  const before = JSON.stringify(e.eq.data);
  assert.throws(() => e.ctx.appAddOrder('9', { id: 'KS-404', kit: 'Игровая форма', sum: 200 }), /Игрок не найден/);
  assert.equal(JSON.stringify(e.eq.data), before);
  assert.equal(e.ps.data.length, 1);
});

test('колонки N и C читаются один раз для номера ORD и снятия дубля', () => {
  const e = env();
  const orig = e.eq.getRange.bind(e.eq);
  let nReads = 0;
  e.eq.getRange = (r, c, n, m) => { const rg = orig(r, c, n, m); if (r === 1 && (c === 14 || c === 3)) { const g = rg.getValues; rg.getValues = () => { nReads++; return g(); }; } return rg; };
  e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  assert.equal(nReads, 1);
  assert.equal(e.eq.data[5][13], 'ORD-0003');
});

// Свободных строк нет: строки 4–6 — заказы, строка 7 — итоги; в журнале оплат есть платёж по удалённому заказу №5
function fullEnv() {
  const e = env();
  const rows = e.eq.data.slice(0, 5);
  rows.push([3, 46002, 'Delta D', 'Дождевик', '128', '', '', '', 150, 0, 150, 'KS-2', 'Парк', 'ORD-0004']);
  rows.push(['', '', '', '', '', '', '', '', 500, 200, 300, '', '', '']);            // итоги
  rows.push(['', '', 'примечание под итогами']);
  while (rows.length < 3 + 250) rows.push(EMPTY());
  e.eq.data = rows;
  e.eq.formulas = { '5:11': '=MAX(I5-J5,0)', '6:11': '=MAX(I6-J6,0)', '7:9': '=SUM(I4:I6)', '7:10': '=SUM(J4:J6)', '7:11': '=SUM(K4:K6)' };
  const rule = ranges => ({ getRanges: () => ranges, copy: () => { const b = { r: null, setRanges: x => { b.r = x; return b; }, build: () => rule(b.r) }; return b; } });
  e.eq.rules = [rule([e.eq.getRange(4, 1, 3, 12)]), rule([e.eq.getRange(1, 1, 2, 2)])];
  e.ps.data.push([new Date(0), '2026-10-01', 'KS-9', 'Gone', 'Экипировка: Носки', 5, 15, '', 'Наличные']);
  return e;
}

test('нет свободных строк: вставляется пачка из 10 пронумерованных строк, заказ — в первую', () => {
  const e = fullEnv();
  const r = e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  assert.equal(r.row, 7);
  assert.deepEqual(e.eq.data.slice(6, 16).map(x => x[0]), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);   // номера после №5 из журнала оплат
  assert.deepEqual(e.eq.data[6].slice(1, 4), [e.ctx.serialOf('2026-10-22'), 'Gamma C', 'Дождевик']);
  assert.ok(e.eq.data.slice(7, 16).every(x => x.slice(1, 12).every(v => v === '')));                 // остальные 9 — пустые, свободные
  assert.deepEqual([e.eq.data[16][8], e.eq.data[17][2]], [500, 'примечание под итогами']);             // итоги и строка под ними сдвинулись
  assert.deepEqual([e.eq.formulas['17:9'], e.eq.formulas['17:10'], e.eq.formulas['17:11']], ['=SUM(I4:I16)', '=SUM(J4:J16)', '=SUM(K4:K16)']);
  assert.deepEqual(e.eq.formatCopies, [[6, 7, 10]]);                                                 // оформление строки выше — на все 10
  const rr = e.eq.rules.map(x => x.getRanges().map(g => [g.getRow(), g.getNumRows()]));
  assert.deepEqual(rr, [[[4, 13]], [[1, 2]]]);                                                       // правило цвета заказов продлено на 10
  // следующий заказ — в свободную строку пачки, без новой вставки
  e.ctx.appAddOrder('9', { id: 'KS-1', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  assert.deepEqual([e.eq.data[7][2], e.eq.data.slice(6, 17).map(x => x[0]).length, e.eq.formatCopies.length], ['Alpha A', 11, 1]);
});

test('пачка не выводит строку итогов за просматриваемые строки', () => {
  const e = fullEnv();
  const ord = e.eq.data.slice(3, 6);
  const rows = e.eq.data.slice(0, 3);
  for (let i = 0; i < 245; i++) rows.push(ord[i % 3].map((v, j) => (j === 0 ? i + 1 : v)));      // строки 4..248 заняты
  rows.push(['', '', '', '', '', '', '', '', 1, 1, 0, '', '', '']);                                // итоги в строке 249
  while (rows.length < 3 + 260) rows.push(EMPTY());
  e.eq.data = rows;
  e.eq.formulas = { '248:11': '=x', '249:9': '=SUM(I4:I248)', '249:10': '=SUM(J4:J248)', '249:11': '=SUM(K4:K248)' };
  e.eq.rules = [];
  const r = e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  assert.equal(r.row, 249);
  assert.equal(e.eq.data[252][8], 1);                                    // итоги в строке 253 — последней просматриваемой
  assert.equal(e.eq.formulas['253:9'], '=SUM(I4:I252)');
});

test('«умная таблица» протягивает формулы итогов во вставленные строки — новые строки очищаются, свободны и пусты', () => {
  const e = fullEnv();
  e.eq.smart = true;
  const r = e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  assert.equal(r.row, 7);
  for (let row = 8; row <= 16; row++) {
    assert.deepEqual(e.eq.data[row - 1].slice(1, 15).filter(v => v !== ''), [], 'строка ' + row);
    for (const c of [8, 9, 10, 11]) assert.equal(e.eq.formulas[row + ':' + c], undefined, 'формула ' + row + ':' + c);
  }
  assert.deepEqual(e.eq.data.slice(6, 16).map(x => x[0]), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);   // № на месте
  assert.equal(e.eq.formulas['17:9'], '=SUM(I4:I16)');                                              // итоги — правильные
  assert.equal(e.eq.data[6][2], 'Gamma C');
  // следующий заказ ложится в первую свободную строку пачки, без новой вставки и без ошибки «итоги изменены»
  const r2 = e.ctx.appAddOrder('9', { id: 'KS-1', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  assert.equal(r2.row, 8);
  assert.equal(e.eq.formatCopies.length, 1);
});

test('протянутые формулы в свободных строках (как в боевом листе 22.10) — новый заказ не пишется, таблица не меняется', () => {
  const e = fullEnv();
  e.eq.smart = true;
  e.ctx.appAddOrder('9', { id: 'KS-3', kit: 'Дождевик', sum: 150, paid: 0, size: '128' });
  for (let row = 8; row <= 16; row++) for (const c of [9, 10, 11]) { e.eq.put(row, c, '#REF!'); e.eq.formulas[row + ':' + c] = '=SUM(#REF!)'; }  // состояние до исправления
  const before = JSON.stringify([e.eq.data, e.eq.formulas]);
  assert.throws(() => e.ctx.appAddOrder('9', { id: 'KS-1', kit: 'Дождевик', sum: 150, paid: 0, size: '128' }), /итогов/);
  assert.equal(JSON.stringify([e.eq.data, e.eq.formulas]), before);
});
