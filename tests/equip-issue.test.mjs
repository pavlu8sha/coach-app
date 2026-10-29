// Выдача экипировки по вещам (EquipIssue.js): лист «ВЫДАЧА», итог в «ФАКТ ПОШИВА» (H «Выдано»), журнал изменений.
// Настоящие EquipIssue.js и Wrote-подобные помощники из SubsPay.js; файл экипировки — имитация в памяти.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

class Sheet {
  constructor(name, rows) { this.name = name; this.data = rows.map(r => r.slice()); this.ops = []; }
  getLastRow() { let n = this.data.length; while (n && (this.data[n - 1] || []).every(x => x === '' || x === undefined)) n--; return n; }
  getName() { return this.name; }
  setFrozenRows() {}
  deleteRow(i) { this.ops.push('del ' + i); this.data.splice(i - 1, 1); }
  cell(a, b) { const x = this.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; }
  put(a, b, v) { while (this.data.length < a) this.data.push([]); const r = this.data[a - 1]; while (r.length < b) r.push(''); r[b - 1] = v; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this, grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    const rg = {
      getValue: () => sh.cell(r, c),
      getValues: () => grid((a, b) => sh.cell(a, b)),
      getDisplayValues: () => grid((a, b) => String(sh.cell(a, b))),
      setValues: v => { sh.ops.push('set ' + r + ':' + c); v.forEach((row, i) => row.forEach((x, j) => sh.put(r + i, c + j, x))); return rg; },
      setValue: x => { sh.ops.push('set ' + r + ':' + c); sh.put(r, c, x); return rg; },
      setNumberFormat: p => { sh.ops.push('fmt ' + r + ':' + c + ' ' + p); return rg; },
      clearContent: () => { for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) sh.put(r + i, c + j, ''); return rg; },
    };
    return rg;
  }
}

const E = () => Array(15).fill('');
function env({ dry = false, fact = true } = {}) {
  // Лист сезона: строки 4+ — заказы [№, дата, ФИ, комплект, размер, надпись, номер, рассрочка, сумма, оплачено, долг, ID, локация, ORD, кол-во]
  const season = new Sheet('СЕЗОН 2026-2027', [['ЗАГОЛОВОК'], [''], ['№'],
    [1, '', 'Alpha A', 'Тренировочная форма + Игровая форма', '140', 'ALPHA', '7', '', 300, 100, 200, 'KS-1', 'Парк', 'ORD-0001', '1 + 1'],
    [2, '', 'Beta B', 'Дождевик', '128', '', '', '', 150, 150, 0, 'KS-2', 'Парк', 'ORD-0124', '1'],
    [3, '', 'Gamma C', 'Носки', '', '', '', '', 35, 0, 35, 'KS-3', 'Парк', '', '1'],
  ].concat(Array.from({ length: 250 }, E)));
  const sheets = { 'СЕЗОН 2026-2027': season };
  if (fact) sheets['ФАКТ ПОШИВА'] = new Sheet('ФАКТ ПОШИВА', [['ID заказа', 'Игрок', 'Сшито', 'Размер', 'Номер', 'Надпись', 'Нанесено', 'Выдано'],
    ['ORD-0001', 'Alpha A', 'Тренировочная форма', '140', '7', 'ALPHA', 'Не подтверждено', 'Не подтверждено']]);
  const file = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n, [])) };
  season.getParent = () => file;
  const log = [], cache = {};
  let locks = 0;
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, Logger: { log() {} }, CONFIG: { DRY_RUN: dry },
    LockService: { getScriptLock: () => ({ waitLock() { locks++; }, releaseLock() {} }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'EquipIssue.js'), 'utf8'), ctx, { filename: 'EquipIssue.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'EquipLinks.js'), 'utf8'), ctx, { filename: 'EquipLinks.js' }); // assertEquipRowIdentity_: настоящая проверка строки
  const sp = fs.readFileSync(path.join(ROOT, 'SubsPay.js'), 'utf8');
  vm.runInContext(sp.slice(sp.indexOf('function nfSafe_'), sp.indexOf('\n', sp.indexOf('function nfSafe_'))), ctx);
  Object.assign(ctx, {
    EQ_FIRST: 4, EQ_ROWS: 250, equipSheet_: () => season,
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    logChange_: (...a) => log.push(a),
    cacheGetBig_: k => (k in cache ? JSON.parse(cache[k]) : null), cachePutBig_: (k, v) => { cache[k] = JSON.stringify(v); }, cacheDropBig_: k => { delete cache[k]; },
  });
  const issued = () => (sheets['ВЫДАЧА'] ? sheets['ВЫДАЧА'].data.slice(1).filter(r => r.length && r[0]).map(r => [r[0], r[1], r[2], r[3], r[4], r[5]]) : []);
  const factOf = ord => { const f = sheets['ФАКТ ПОШИВА']; const r = f && f.data.find(x => x[0] === ord); return r ? r[7] : undefined; };
  // снимок заказа строки row, как его получила форма: №, ФИО, ID игрока, ID заказа
  const ex = row => { const r = season.data[row - 1] || []; return { no: r[0], name: r[2], id: r[11], ord: r[13] }; };
  return { ctx, sheets, season, log, issued, factOf, locks: () => locks, ex };
}
const J = x => JSON.parse(JSON.stringify(x));

test('выдать одну вещь из двух: строка в «ВЫДАЧА», в «ФАКТ ПОШИВА» — «Частично», запись в журнал', () => {
  const e = env();
  const r = e.ctx.appEquipIssue('9', 4, ['Тренировочная форма'], true, '2026-10-23', '  Павел  ', e.ex(4));
  assert.deepEqual(J(r), { ok: true, status: 'Частично', changed: 1 });
  assert.deepEqual(e.issued(), [['ORD-0001', 'Тренировочная форма', '23.10.2026', 'Павел', 'KS-1', 'Alpha A']]);
  assert.deepEqual([...e.sheets['ВЫДАЧА'].data[0]], ['ID заказа', 'Вещь', 'Дата выдачи', 'Кто выдал', 'ID игрока', 'ФИ', 'Отмечено']);
  assert.equal(e.factOf('ORD-0001'), 'Частично');
  assert.deepEqual(e.log.map(a => [a[0], a[1], a[2], a[4]]), [['KS-1', 'Alpha A', 'выдача экипировки', 'ORD-0001: Тренировочная форма, 23.10.2026, выдал(а) Павел → Частично']]);
  assert.equal(e.locks(), 1);
});

test('дата пишется как текст: формат «@» ставится до записи строки', () => {
  const e = env();
  e.ctx.appEquipIssue('9', 4, ['Игровая форма'], true, '2026-10-23', '', e.ex(4));
  const ops = e.sheets['ВЫДАЧА'].ops;
  assert.ok(ops.indexOf('fmt 2:1 @') >= 0 && ops.indexOf('fmt 2:1 @') < ops.indexOf('set 2:1'), ops.join(', '));
});

test('выдать вторую вещь — «Да»; повторная выдача той же вещи не дублирует строку и не пишет в журнал', () => {
  const e = env();
  e.ctx.appEquipIssue('9', 4, ['Тренировочная форма'], true, '2026-10-23', 'Павел', e.ex(4));
  assert.equal(e.ctx.appEquipIssue('9', 4, ['Игровая форма', 'Тренировочная форма'], true, '2026-10-24', 'Гио', e.ex(4)).status, 'Да');
  assert.deepEqual(e.issued().map(r => [r[1], r[2], r[3]]), [['Тренировочная форма', '23.10.2026', 'Павел'], ['Игровая форма', '24.10.2026', 'Гио']]);
  assert.equal(e.factOf('ORD-0001'), 'Да');
  const r = e.ctx.appEquipIssue('9', 4, ['Игровая форма'], true, '2026-10-25', 'Гио', e.ex(4));
  assert.deepEqual([r.status, r.changed, e.issued().length, e.log.length], ['Да', 0, 2, 2]);
});

test('снять выдачу: строка удаляется, статус пересчитывается до «Частично», затем «Нет»', () => {
  const e = env();
  e.ctx.appEquipIssue('9', 4, ['Тренировочная форма', 'Игровая форма'], true, '2026-10-23', 'Павел', e.ex(4));
  assert.equal(e.ctx.appEquipIssue('9', 4, ['Игровая форма'], false, '', '', e.ex(4)).status, 'Частично');
  assert.deepEqual(e.issued().map(r => r[1]), ['Тренировочная форма']);
  assert.equal(e.ctx.appEquipIssue('9', 4, ['Тренировочная форма'], false, '', '', e.ex(4)).status, 'Нет');
  assert.deepEqual([e.issued().length, e.factOf('ORD-0001')], [0, 'Нет']);
  assert.equal(e.log[e.log.length - 1][2], 'отмена выдачи экипировки');
});

test('заказа нет в «ФАКТ ПОШИВА» — добавляется строка: ID, игрок, «Не подтверждено» в «Нанесено», статус в «Выдано»', () => {
  const e = env();
  e.ctx.appEquipIssue('9', 5, ['Дождевик'], true, '2026-10-23', 'Павел', e.ex(5));
  assert.deepEqual([...e.sheets['ФАКТ ПОШИВА'].data[2]], ['ORD-0124', 'Beta B', '', '', '', '', 'Не подтверждено', 'Да']);
});

test('без листа «ФАКТ ПОШИВА» выдача всё равно записывается в «ВЫДАЧА»', () => {
  const e = env({ fact: false });
  assert.equal(e.ctx.appEquipIssue('9', 5, ['Дождевик'], true, '2026-10-23', '', e.ex(5)).status, 'Да');
  assert.equal(e.issued().length, 1);
});

test('ошибки — ничего не записывается: вещи нет в заказе, нет ID заказа, нет даты, пусто, неверная строка, неверный код', () => {
  const e = env();
  const cases = [
    [['9', 4, ['Дождевик'], true, '2026-10-23', '', e.ex(4)], /нет в заказе/],
    [['9', 6, ['Носки'], true, '2026-10-23', '', e.ex(6)], /нет ID заказа/],
    [['9', 4, ['Игровая форма'], true, '', '', e.ex(4)], /дату выдачи/],
    [['9', 4, [], true, '2026-10-23', '', e.ex(4)], /Отметьте/],
    [['9', 2, ['Игровая форма'], true, '2026-10-23', '', e.ex(2)], /Некорректная строка/],
    [['9', 40, ['Игровая форма'], true, '2026-10-23', '', e.ex(40)], /не найден/],
    [['1', 4, ['Игровая форма'], true, '2026-10-23', '', e.ex(4)], /администратора/],
  ];
  for (const [args, re] of cases) assert.throws(() => e.ctx.appEquipIssue(...args), re, String(args));
  assert.deepEqual([e.issued().length, e.factOf('ORD-0001'), e.log.length], [0, 'Не подтверждено', 0]);
});

test('пробный режим (DRY_RUN): ничего не пишется, лист «ВЫДАЧА» не создаётся', () => {
  const e = env({ dry: true });
  assert.equal(e.ctx.appEquipIssue('9', 4, ['Игровая форма'], true, '2026-10-23', '', e.ex(4)).dryRun, true);
  assert.deepEqual([e.sheets['ВЫДАЧА'], e.factOf('ORD-0001'), e.log.length], [undefined, 'Не подтверждено', 0]);
});

test('выдачи для экрана: { ORD: { вещь: {date, who} } }; без листа — пусто; после выдачи кэш обновляется', () => {
  const e = env();
  assert.deepEqual(J(e.ctx.equipIssues_()), {});
  e.ctx.appEquipIssue('9', 4, ['Тренировочная форма'], true, '2026-10-23', 'Павел', e.ex(4));
  e.ctx.appEquipIssue('9', 5, ['Дождевик'], true, '2026-10-22', '', e.ex(5));
  assert.deepEqual(J(e.ctx.equipIssues_()), {
    'ORD-0001': { 'Тренировочная форма': { date: '23.10.2026', who: 'Павел' } },
    'ORD-0124': { 'Дождевик': { date: '22.10.2026', who: '' } },
  });
});

test('сортировка листа после открытия формы: выдача и отмена выдачи отклоняются, лист «ВЫДАЧА» не меняется', () => {
  const e = env();
  e.ctx.appEquipIssue('9', 4, ['Тренировочная форма'], true, '2026-10-23', 'Павел', e.ex(4));   // штатно: снимок совпадает
  const stale = e.ex(4);                                         // форма открыта для заказа Alpha A (строка 4)
  const t = e.season.data[3]; e.season.data[3] = e.season.data[4]; e.season.data[4] = t;       // лист отсортировали: в строке 4 теперь Beta B
  const before = JSON.stringify([e.issued(), e.factOf('ORD-0001'), e.factOf('ORD-0124'), e.log.length]);
  assert.throws(() => e.ctx.appEquipIssue('9', 4, ['Дождевик'], true, '2026-10-24', 'Гио', stale), /Заказ изменился или строка сместилась/);
  assert.throws(() => e.ctx.appEquipIssue('9', 4, ['Тренировочная форма'], false, '', '', stale), /Заказ изменился или строка сместилась/);
  assert.equal(JSON.stringify([e.issued(), e.factOf('ORD-0001'), e.factOf('ORD-0124'), e.log.length]), before);
});
