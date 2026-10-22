// Тесты настроек (Settings.js) на имитации AdminApp, кэша и свойств скрипта. Запуск: node --test tests/*.mjs
// Суммы в фикстурах намеренно не совпадают с реальными взносами клуба: тесты проверяют механизм, а не бизнес-значения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

class Sheet {
  constructor(rows) { this.data = rows.map(r => r.slice()); }
  getLastRow() { return this.data.length; }
  cell(r, c) { const x = this.data[r - 1]; return x && x[c - 1] !== undefined ? x[c - 1] : ''; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    return {
      getDisplayValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => String(sh.cell(r + i, c + j)))),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => {
        while (sh.data.length < r + i) sh.data.push([]);
        const rr = sh.data[r + i - 1]; while (rr.length < c + j) rr.push(''); rr[c + j - 1] = x;
      })),
      setNumberFormat() {},
    };
  }
}

function env(opts = {}) {
  const admin = { sheet: opts.rows ? new Sheet([['Ключ', 'Объект', 'Значение', 'Изменено']].concat(opts.rows)) : null };
  const props = Object.assign({ APP_ADMIN_PIN: '9', EQUIP_ID: 'eq' }, opts.props || {});
  const cache = {}, log = [];
  const ctx = {
    console: { warn() {}, error() {}, log() {} },
    CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => (opts.equipSheets || ['СЕЗОН 2026-2027']).includes(n) ? {} : null }) },
    dbRead_: n => { if (opts.adminDown) throw new Error('нет доступа к AdminApp'); return n === 'НАСТРОЙКИ' ? admin.sheet : null; },
    dbSheet_: (n, head) => { if (!admin.sheet) admin.sheet = new Sheet([head]); return admin.sheet; },
    checkAdmin_: pin => { if (String(pin) !== props.APP_ADMIN_PIN) throw new Error('Неверный код администратора'); },
    prop_: k => props[k],
    cacheDropBig_() {},
    logChange_: (...a) => log.push(a),
    matchesData_: () => ({ events: (opts.teams || ['U9', 'U10-A', 'U13-A']).map(t => ({ team: t })) }),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Settings.js'), 'utf8'), ctx, { filename: 'Settings.js' });
  // новый «запуск» скрипта: память запуска сбрасывается, кэш и свойства остаются
  const newRun = () => vm.runInContext('_settingsRun = null; _settingsWarned = {};', ctx);
  return { ctx, admin, props, cache, log, newRun };
}
const arr = v => (Array.isArray(v) ? [...v] : v);


const F = 'matches.champFee';

test('технические настройки без листа: значения по умолчанию из схемы', () => {
  for (const e of [env(), env({ rows: [] })]) {
    const g = e.ctx.settingGet_;
    assert.equal(g('stats.lowPct'), 50);
    assert.equal(g('equip.seasonSheet'), 'СЕЗОН 2026-2027');
    assert.deepEqual(arr(g('funnel.activeSheets')), ['Осень 2026']);
  }
});

test('взнос: настройки нет — суммы нет ни у одной команды (ни общей, ни U13-A), ошибка видна админу', () => {
  const e = env();
  for (const t of [undefined, 'U10-A', 'U13-A', 'Новая команда']) assert.equal(e.ctx.settingGet_(F, t), null);
  const gen = e.ctx.appSettings('9').items.find(x => x.key === F && !x.obj);
  assert.equal(gen.source, 'missing');
  assert.match(gen.error, /не задано/);
  const d = e.ctx.champFeeDefaults_();
  assert.equal(d.def, null);
  assert.match(d.error, /не задано/);
});

test('взнос: общее значение действует для всех, в том числе для U13-A и новой команды без исключения', () => {
  const e = env({ rows: [[F, '', '250']] });
  for (const t of [undefined, 'U10-A', 'U13-A', 'U15-Z']) assert.equal(e.ctx.settingGet_(F, t), 250);
  assert.equal(e.ctx.settingResolve_(F, 'U15-Z').source, 'sheet');
});

test('взнос: индивидуальное значение команды переопределяет общее', () => {
  const e = env({ rows: [[F, '', '250'], [F, 'U13-A', '375']] });
  assert.equal(e.ctx.settingGet_(F, 'U13-A'), 375);
  assert.equal(e.ctx.settingResolve_(F, 'U13-A').source, 'object');
  assert.equal(e.ctx.settingGet_(F, 'U10-A'), 250);
});

test('взнос: индивидуальное значение без общего — только у этой команды, остальные «не задано»', () => {
  const e = env({ rows: [[F, 'U13-A', '375']] });
  assert.equal(e.ctx.settingGet_(F, 'U13-A'), 375);
  assert.equal(e.ctx.settingGet_(F, 'U10-A'), null);
});

test('взнос: очистка индивидуального значения возвращает команду к общему', () => {
  const e = env({ rows: [[F, '', '250'], [F, 'U13-A', '375']] });
  const r = e.ctx.appSettingsSave('9', F, 'U13-A', '');
  assert.equal(r.value, 250);
  assert.equal(r.source, 'sheet');
  e.newRun();
  assert.equal(e.ctx.settingGet_(F, 'U13-A'), 250);
  assert.deepEqual([...e.ctx.appSettings('9').items.filter(x => x.key === F).map(x => x.obj)], ['']); // исключение исчезло с экрана
  assert.match(e.log.at(-1)[4], /очищено/);
});

test('взнос: неверное общее значение не заменяется ничем — null и ошибка; неверное значение команды — тоже null, не общее', () => {
  const e = env({ rows: [[F, '', 'abc'], [F, 'U9', '410'], [F, 'U13-A', '-5']] });
  assert.equal(e.ctx.settingGet_(F, 'U10-A'), null);
  assert.equal(e.ctx.settingResolve_(F, 'U10-A').source, 'invalid');
  assert.equal(e.ctx.settingGet_(F, 'U9'), 410);                        // своё верное значение работает
  const e2 = env({ rows: [[F, '', '250'], [F, 'U13-A', '-5']] });
  assert.equal(e2.ctx.settingGet_(F, 'U13-A'), null);                  // не подставляется общее 250
  const it = e2.ctx.appSettings('9').items.find(x => x.key === F && x.obj === 'U13-A');
  assert.equal(it.source, 'invalid'); assert.equal(it.raw, '-5'); assert.match(it.error, /не меньше 0/);
  assert.equal(e2.ctx.champFeeDefaults_().byTeam['u13-a'], null);
});

test('неверное значение технической настройки: пропускается, работает значение по умолчанию, ошибка видна', () => {
  const e = env({ rows: [['stats.lowPct', '', 'полтинник']] });
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 50);
  assert.match(e.ctx.appSettings('9').items.find(x => x.key === 'stats.lowPct').error, /нужно число/);
});

test('из значения ничего не выполняется: код и формулы остаются текстом', () => {
  const e = env({ rows: [['funnel.activeSheets', '', 'Осень 2026, ");throw 1;(", =IMPORTRANGE("x")']] });
  assert.deepEqual(arr(e.ctx.settingGet_('funnel.activeSheets')), ['Осень 2026', '");throw 1;("', '=IMPORTRANGE("x")']);
});

test('воронка: старое свойство FUNNEL_ACTIVE работает, пока нет настройки; настройка из листа сильнее', () => {
  assert.deepEqual(arr(env({ props: { FUNNEL_ACTIVE: 'Весна 2027, Осень 2026' } }).ctx.settingGet_('funnel.activeSheets')), ['Весна 2027', 'Осень 2026']);
  const e = env({ props: { FUNNEL_ACTIVE: 'Весна 2027' }, rows: [['funnel.activeSheets', '', 'Зима 2027']] });
  assert.deepEqual(arr(e.ctx.settingGet_('funnel.activeSheets')), ['Зима 2027']);
});

test('сохранение: только админ, проверка на сервере, лист сезона заблокирован', () => {
  const e = env();
  assert.throws(() => e.ctx.appSettingsSave('1', F, '', 250), /Неверный код администратора/);
  assert.throws(() => e.ctx.appSettings('1'), /Неверный код администратора/);
  assert.throws(() => e.ctx.appSettingsSave('9', F, '', -1), /не меньше 0/);
  assert.throws(() => e.ctx.appSettingsSave('9', F, 'U9', 'много'), /нужно число/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'stats.lowPct', '', 150), /не больше 100/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'stats.lowPct', 'U9', 60), /нет значений по объектам/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'equip.seasonSheet', '', 'СЕЗОН 2026-2027'), /Переключение сезона пока отключено/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'nope', '', 1), /Неизвестная настройка/);
  assert.equal(e.admin.sheet, null);                                    // ничего не записано
  assert.equal(e.ctx.appSettings('9').keys['equip.seasonSheet'].locked.length > 0, true);
});

test('сохранение: строка в листе, журнал изменений (было → стало), новое значение сразу и в следующем запуске', () => {
  const e = env();
  assert.equal(e.ctx.settingGet_(F, 'U10-A'), null);                   // закэшировано «не задано»
  assert.equal(e.ctx.appSettingsSave('9', F, '', '250').value, 250);
  assert.equal(e.ctx.settingGet_(F, 'U10-A'), 250);                    // тот же запуск
  e.ctx.appSettingsSave('9', F, 'U13-A', 375);
  e.ctx.appSettingsSave('9', 'stats.lowPct', '', '60');
  e.ctx.appSettingsSave('9', F, '', '260');                            // та же строка
  e.newRun();
  assert.equal(e.ctx.settingGet_(F, 'U10-A'), 260);
  assert.equal(e.ctx.settingGet_(F, 'U13-A'), 375);
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 60);
  assert.deepEqual(e.admin.sheet.data.slice(1).map(x => x.slice(0, 3)), [[F, '', '260'], [F, 'U13-A', '375'], ['stats.lowPct', '', '60']]);
  assert.deepEqual(e.log.map(a => [a[2], a[3], a[4]]), [
    ['настройка: Взнос за чемпионат, ₾', 'не задано', '250'],
    ['настройка: Взнос за чемпионат, ₾ (U13-A)', '250', '375'],
    ['настройка: Порог низкой посещаемости, %', '50', '60'],
    ['настройка: Взнос за чемпионат, ₾', '250', '260'],
  ]);
});

test('очистка общего взноса: значение «не задано», команды без своего значения — без суммы', () => {
  const e = env({ rows: [[F, '', '250'], [F, 'U13-A', '375']] });
  const r = e.ctx.appSettingsSave('9', F, '', '');
  assert.equal(r.value, null);
  e.newRun();
  assert.equal(e.ctx.settingGet_(F, 'U10-A'), null);
  assert.equal(e.ctx.settingGet_(F, 'U13-A'), 375);
});

test('ручная правка листа видна после «Обновить данные» (settingsBump_)', () => {
  const e = env({ rows: [[F, '', '250']] });
  assert.equal(e.ctx.settingGet_(F), 250);
  e.admin.sheet.data[1][2] = '270';
  e.newRun();
  assert.equal(e.ctx.settingGet_(F), 250);                              // кэш ещё жив
  e.ctx.settingsBump_();
  assert.equal(e.ctx.settingGet_(F), 270);
});

test('экран: список команд для выбора берётся из событий матчей, ключи описаны', () => {
  const e = env({ teams: ['U13-A', 'U9', 'U9', ' U10-A '] });
  const k = e.ctx.appSettings('9').keys[F];
  assert.deepEqual([...k.choices], ['U10-A', 'U13-A', 'U9']);
  assert.equal(k.required, true); assert.equal(k.hasDefault, false); assert.equal(k.perObject, 'Команда');
});

test('подсказка взноса для формы матчей: общее и значения команд', () => {
  const e = env({ rows: [[F, '', '250'], [F, 'U9', '410']] });
  const d = e.ctx.champFeeDefaults_();
  assert.equal(d.def, 250);
  assert.deepEqual({ ...d.byTeam }, { 'u9': 410 });
  assert.equal(d.error, '');
});

test('строка повторяется: действует первая, её же правит сохранение; повтор виден как ошибка', () => {
  const e = env({ rows: [['stats.lowPct', '', '60'], ['stats.lowPct', '', '70']] });
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 60);
  assert.match(e.ctx.appSettings('9').items.find(x => x.key === 'stats.lowPct').error, /повторяется/);
  e.ctx.appSettingsSave('9', 'stats.lowPct', '', 65);
  e.newRun();
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 65);
});

test('команда без учёта регистра и пробелов: «u13-a » = «U13-A»; сохранение правит ту же строку', () => {
  const e = env({ rows: [[F, 'u13-a ', '375']] });
  assert.equal(e.ctx.settingGet_(F, 'U13-A'), 375);
  e.ctx.appSettingsSave('9', F, 'U13-A', 380);
  e.newRun();
  assert.equal(e.ctx.settingGet_(F, 'u13-a'), 380);
  assert.equal(e.admin.sheet.data.length, 2);
  assert.deepEqual([...e.ctx.appSettings('9').items.filter(x => x.key === F).map(x => x.obj)], ['', 'U13-A']);
});

test('AdminApp недоступен: технические настройки по умолчанию, взнос «не задано», разделы не падают', () => {
  const e = env({ adminDown: true });
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 50);
  assert.equal(e.ctx.settingGet_('equip.seasonSheet'), 'СЕЗОН 2026-2027');
  assert.equal(e.ctx.settingGet_(F, 'U13-A'), null);
});
