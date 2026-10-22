// UI-012: отметки «написал(а)» — на сервере, по одной строке на нажатие.
// «Должники» (лист «ОТМЕТКИ ДОЛЖНИКОВ») и «Дополнительные тренировки» («ОТМЕТКИ СООБЩЕНИЙ»).
// Настоящие Wrote.js, Debtors.js, Extra.js и скрипт Debt.html; таблицы, localStorage и google.script.run — имитация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

class Sheet {
  constructor(head) { this.data = [head.slice()]; this.ops = []; this.fmt = {}; }
  getLastRow() { return this.data.length; }
  getMaxRows() { return 1000; }
  deleteRow(i) { this.ops.push('del ' + i); this.data.splice(i - 1, 1); }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    const cell = (a, b) => { const x = sh.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; };
    const grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    return {
      getDisplayValues: () => grid((a, b) => { const v = cell(a, b); return v instanceof Date ? 'дата' : String(v); }),
      getValues: () => grid(cell),
      setNumberFormat: p => { sh.ops.push('fmt ' + r + ' ' + p); for (let i = 0; i < n; i++) sh.fmt[r + i] = p; },
      setValues: v => { sh.ops.push('set ' + r); v.forEach((row, i) => { while (sh.data.length < r + i) sh.data.push([]); sh.data[r + i - 1] = row.slice(); }); },
      clearContent: () => { for (let i = 0; i < n; i++) sh.data[r + i - 1] = []; },
    };
  }
}

function env(dry = false) {
  const sheets = {};
  let locks = 0;
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, Logger: { log() {} }, CONFIG: { DRY_RUN: dry },
    LockService: { getScriptLock: () => ({ waitLock() { locks++; }, releaseLock() {} }) },
  };
  vm.createContext(ctx);
  for (const f of ['Wrote.js', 'Debtors.js', 'Extra.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const sp = fs.readFileSync(path.join(ROOT, 'SubsPay.js'), 'utf8');
  vm.runInContext(sp.slice(sp.indexOf('function nfSafe_'), sp.indexOf('\n', sp.indexOf('function nfSafe_'))), ctx);
  Object.assign(ctx, {
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    dbRead_: n => sheets[n] || null,
    dbSheet_: (n, head) => (sheets[n] = sheets[n] || new Sheet(head)),
  });
  return { ctx, sheets, locks: () => locks };
}
const D = 'ОТМЕТКИ ДОЛЖНИКОВ', X = 'ОТМЕТКИ СООБЩЕНИЙ';
const keys = (e, n) => (e.sheets[n] ? e.sheets[n].data.slice(1).filter(r => r.length).map(r => r[0] + '|' + r[1]) : []);

test('должники: поставить, повторно поставить, снять — по одной строке, под блокировкой', () => {
  const e = env();
  e.ctx.appDebtWrote('9', '10.26', 'KS-0105', true);
  e.ctx.appDebtWrote('9', '10.26', 'KS-0105', true);                    // повтор не дублирует
  e.ctx.appDebtWrote('9', '10.26', 'KS-0200', true);
  assert.deepEqual(keys(e, D), ['10.26|KS-0105', '10.26|KS-0200']);
  assert.deepEqual([...e.sheets[D].data[0]], ['Месяц', 'ID игрока', 'Отмечено']);
  assert.ok(e.sheets[D].data[1][2] instanceof Date || Object.prototype.toString.call(e.sheets[D].data[1][2]) === '[object Date]');
  e.ctx.appDebtWrote('9', '10.26', 'KS-0105', false);
  assert.deepEqual(keys(e, D), ['10.26|KS-0200']);
  assert.equal(e.locks(), 4);
});

test('должники: месяц пишется как текст — формат «@» ставится до записи строки', () => {
  const e = env();
  e.ctx.appDebtWrote('9', '11.26', 'KS-1', true);
  assert.deepEqual(e.sheets[D].ops, ['fmt 2 @', 'set 2']);
});

test('два человека отмечают разных должников — обе отметки остаются (раньше побеждал последний)', () => {
  const e = env();
  e.ctx.appDebtWrote('9', '10.26', 'KS-1', true);   // телефон тренера
  e.ctx.appDebtWrote('9', '10.26', 'KS-2', true);   // компьютер администратора, страница открыта раньше
  e.ctx.appDebtWrote('9', '10.26', 'KS-1', false);
  e.ctx.appDebtWrote('9', '10.26', 'KS-3', true);
  assert.deepEqual(keys(e, D), ['10.26|KS-2', '10.26|KS-3']);
});

test('должники: отметки месяца приходят вместе со списком (appDebtors), чужие месяцы — нет', () => {
  const e = env();
  e.ctx.appDebtWrote('9', '10.26', 'KS-1', true);
  e.ctx.appDebtWrote('9', '09.26', 'KS-2', true);
  Object.assign(e.ctx, { payMonths_: () => ['09.26', '10.26'], indDebts_: () => [], indParse_: () => [], extraDebts_: () => [], extraParse_: () => [], extraPrices_: () => ({}), monthGroups_: () => null });
  const r = JSON.parse(JSON.stringify(e.ctx.appDebtors('9', '10.26')));
  assert.deepEqual(r.wrote, ['KS-1']);
  assert.deepEqual(JSON.parse(JSON.stringify(e.ctx.appDebtors('9', '11.26'))).wrote, []);
});

test('должники: снять несуществующую отметку и прочитать без листа — без ошибок и без создания листа', () => {
  const e = env();
  e.ctx.appDebtWrote('9', '10.26', 'KS-1', false);
  assert.equal(e.sheets[D], undefined);
  assert.deepEqual([...e.ctx.debtWroteOf_('10.26')], []);
});

test('должники: неверные данные и неверный код — ничего не пишется', () => {
  const e = env();
  for (const [m, id] of [['2026-10', 'KS-1'], ['10.26', ''], ['10.26', 'a|b'], ['1.26', 'KS-1']]) assert.throws(() => e.ctx.appDebtWrote('9', m, id, true), /Неверная отметка/);
  assert.throws(() => e.ctx.appDebtWrote('1', '10.26', 'KS-1', true), /администратора/);
  assert.throws(() => e.ctx.appDebtWroteImport('1', ['10.26|KS-1']), /администратора/);
  assert.equal(e.sheets[D], undefined);
});

test('перенос из браузера: только добавляет недостающие, неверные ключи пропускает, ничего не снимает', () => {
  const e = env();
  e.ctx.appDebtWrote('9', '10.26', 'KS-1', true);
  const r = e.ctx.appDebtWroteImport('9', ['10.26|KS-1', '10.26|KS-2', '09.26|KS-3', 'мусор', '10.26|', 'ab|KS-4', '10.26|KS-2']);
  assert.equal(r.added, 2);
  assert.deepEqual(keys(e, D), ['10.26|KS-1', '10.26|KS-2', '09.26|KS-3']);
  assert.equal(e.ctx.appDebtWroteImport('9', ['10.26|KS-1']).added, 0);
});

test('пробный режим (DRY_RUN): отметки и перенос ничего не пишут', () => {
  const e = env(true);
  assert.equal(e.ctx.appDebtWrote('9', '10.26', 'KS-1', true).dryRun, true);
  assert.equal(e.ctx.appDebtWroteImport('9', ['10.26|KS-1']).dryRun, true);
  assert.equal(e.ctx.appWroteToggle('9', '11.10|1|Ana', true).dryRun, true);
  assert.deepEqual(Object.keys(e.sheets), []);
});

test('дополнительные: отметка по одной строке, игрок с «|» в ключе, список — как раньше «событие|игрок»', () => {
  const e = env();
  e.ctx.appWroteToggle('9', '11.10|3|Ana A', true);
  e.ctx.appWroteToggle('9', '12.10|1|Bob B', true);
  e.ctx.appWroteToggle('9', '11.10|3|Ana A', true);
  assert.deepEqual([...e.ctx.appWroteList('9')], ['11.10|3|Ana A', '12.10|1|Bob B']);
  assert.deepEqual([...e.sheets[X].data[1]], ['11.10', '3|Ana A']);              // как писал прежний appWroteSet
  e.ctx.appWroteToggle('9', '11.10|3|Ana A', false);
  assert.deepEqual([...e.ctx.appWroteList('9')], ['12.10|1|Bob B']);
  assert.throws(() => e.ctx.appWroteToggle('9', 'безразделителя', true), /Неверная отметка/);
  assert.equal(typeof e.ctx.appWroteSet, 'undefined');                      // полная перезапись листа убрана
});

// ---------- скрипт страницы Debt.html ----------
function page(stored) {
  const ls = Object.assign({}, stored), calls = [], loads = [];
  const src = fs.readFileSync(path.join(ROOT, 'Debt.html'), 'utf8');
  const js = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));
  const pick = name => { const s = js.indexOf(name); const e = js.indexOf('\n}', s) + 2; return js.slice(s, e); };
  const ctx = {
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    pin: '9', moved: false, done: {}, msgs: [],
    setMsg: (t, bad) => ctx.msgs.push([t, !!bad]),
    load: k => loads.push(k),
    run: (fn, args, ok, fail) => calls.push({ fn, args, ok, fail }),
  };
  vm.createContext(ctx);
  vm.runInContext(pick('function setDone') + '\n' + pick('function moveLocal'), ctx);
  const h = js.indexOf("$('list').onchange");
  ctx.$ = () => ctx.list = {};
  vm.runInContext(js.slice(h, js.indexOf('\n};', h) + 3), ctx);
  return { ctx, ls, calls, loads };
}

test('страница: отметки месяца с сервера превращаются в ключи «месяц|ID» для галочек', () => {
  const p = page();
  p.ctx.setDone({ month: '10.26', wrote: ['KS-1', 'KS-2'] });
  assert.deepEqual(JSON.parse(JSON.stringify(p.ctx.done)), { '10.26|KS-1': 1, '10.26|KS-2': 1 });
});

test('страница: старые отметки из браузера переносятся один раз, затем хранятся под debtDoneMoved', () => {
  const old = JSON.stringify({ '10.26|KS-1': 1, '09.26|KS-2': 1, '10.26|KS-3': 0 });
  const p = page({ debtDone: old });
  p.ctx.moveLocal();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].fn, 'appDebtWroteImport');
  assert.deepEqual([...p.calls[0].args[1]], ['10.26|KS-1', '09.26|KS-2']);   // снятые (0) не переносятся
  p.calls[0].ok({ ok: true, added: 2 });
  assert.deepEqual([p.ls.debtDone, p.ls.debtDoneMoved], [undefined, old]);
  assert.deepEqual(p.loads, [true]);                                         // список перечитан с новыми отметками
  p.ctx.moveLocal();
  assert.equal(p.calls.length, 1);                                           // второй раз — ничего
});

test('страница: перенос не удался или пробный режим — старые отметки остаются в браузере', () => {
  const old = JSON.stringify({ '10.26|KS-1': 1 });
  const a = page({ debtDone: old });
  a.ctx.moveLocal(); a.calls[0].fail('сеть');
  assert.equal(a.ls.debtDone, old);
  a.ctx.moveLocal();
  assert.equal(a.calls.length, 2);                                           // после ошибки — можно повторить
  const b = page({ debtDone: old });
  b.ctx.moveLocal(); b.calls[0].ok({ ok: true, dryRun: true, added: 0 });
  assert.equal(b.ls.debtDone, old);
  const c = page();
  c.ctx.moveLocal();
  assert.equal(c.calls.length, 0);                                           // нечего переносить — нет запроса
});

test('страница: галочка отправляет одну отметку; при ошибке возвращается и показывается сообщение', () => {
  const p = page();
  const box = { dataset: { k: '10.26|KS-7' }, checked: true, disabled: false };
  p.ctx.list.onchange({ target: box });
  assert.deepEqual([p.calls[0].fn, ...p.calls[0].args], ['appDebtWrote', '9', '10.26', 'KS-7', true]);
  assert.equal(box.disabled, true);
  p.calls[0].fail('Нет связи');
  assert.deepEqual([box.checked, box.disabled, p.ctx.done['10.26|KS-7']], [false, false, undefined]);
  assert.deepEqual(p.ctx.msgs, [['Нет связи', true]]);
  box.checked = true; p.ctx.list.onchange({ target: box }); p.calls[1].ok({ ok: true });
  assert.deepEqual([box.checked, box.disabled, p.ctx.done['10.26|KS-7']], [true, false, 1]);
  assert.equal(p.ls.debtDone, undefined);                                   // в браузер больше не пишется
});
