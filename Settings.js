/**
 * Настройки приложения (SettingsService, этап 1).
 *
 * Схема (ключи, типы, значения по умолчанию, границы) — здесь, в коде.
 * Значения, которые меняет администратор, — лист «НАСТРОЙКИ» в AdminApp: Ключ | Объект | Значение | Изменено.
 * Пока лист пустой или строки нет, работает значение по умолчанию — то же, что было зашито в коде,
 * поэтому поведение приложения не меняется.
 *
 * Значения только разбираются по типу (число, текст, список). Код из значений не выполняется.
 * Секреты (коды входа) и ID файлов здесь не хранятся: они остаются в свойствах скрипта.
 */

var SETTINGS_SHEET = 'НАСТРОЙКИ';
var SETTINGS_HEAD = ['Ключ', 'Объект', 'Значение', 'Изменено'];

// group — раздел будущего экрана «Настройки»; perObject — у настройки могут быть значения по объектам (команда и т. п.).
// defs — значения по умолчанию для отдельных объектов (сильнее общего значения из листа, см. settingGet_).
// drop — кэши, которые нужно сбросить после изменения.
var SETTINGS_SCHEMA = {
  'stats.lowPct': {
    group: 'Посещаемость', label: 'Порог низкой посещаемости, %', type: 'int', def: 50, min: 0, max: 100
  },
  'matches.champFee': {
    group: 'Матчи', label: 'Взнос за чемпионат по умолчанию, ₾', type: 'money', def: 200, min: 0, max: 100000,
    perObject: 'Команда', defs: { 'U13-A': 300 }
  },
  'equip.seasonSheet': {
    group: 'Экипировка', label: 'Лист заказов текущего сезона', type: 'sheet', def: 'СЕЗОН 2026-2027', file: 'EQUIP_ID',
    drop: ['eq_v1', 'eq_hdr_ok']
  },
  'funnel.activeSheets': {
    group: 'Новые игроки', label: 'Активные листы воронки (через запятую)', type: 'list', def: ['Осень 2026'],
    legacyProp: 'FUNNEL_ACTIVE'
  }
};

// ---------- Чтение ----------

var _settingsRun = null;   // значения листа на время одного запуска: { v: значения, d: повторы, n: названия объектов }
var _settingsWarned = {};  // одно предупреждение о неверном значении на ключ за запуск

function settingsVer_() { return PropertiesService.getScriptProperties().getProperty('SET_VER') || '0'; }

// Объект (команда и т. п.) сравнивается без учёта регистра и лишних пробелов: «u13-a» = «U13-A».
function settingObj_(s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

// Строки листа: { 'ключ|объект': 'значение' }. Если строка с тем же ключом и объектом повторяется,
// действует первая (её же правит сохранение), повтор показывается как ошибка.
// Кэш привязан к номеру версии: после сохранения версия меняется, и старый кэш больше не читается.
// Если AdminApp недоступен, работают значения по умолчанию (раздел не должен ломаться из-за настроек).
function settingsLoad_() {
  if (_settingsRun) return _settingsRun;
  var key = 'set_' + settingsVer_(), cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) { try { _settingsRun = JSON.parse(hit); return _settingsRun; } catch (e) {} }
  var res = { v: {}, d: {}, n: {} }, sh = null;
  try { sh = dbRead_(SETTINGS_SHEET); } catch (e) { console.warn('Настройки недоступны, работают значения по умолчанию: ' + e.message); }
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var k = String(r[0]).trim(), v = String(r[2]).trim(), o = settingObj_(r[1]), mk = k + '|' + o;
      if (!k || v === '') return;  // пустое значение = «как по умолчанию»
      if (res.v.hasOwnProperty(mk)) { res.d[mk] = 1; return; }
      res.v[mk] = v;
      if (o) res.n[mk] = String(r[1]).replace(/\s+/g, ' ').trim();
    });
  }
  try { cache.put(key, JSON.stringify(res), 600); } catch (e) {}
  _settingsRun = res;
  return res;
}
function settingsRaw_() { return settingsLoad_().v; }

// Разбор значения по типу. Возвращает { ok, value } или { ok: false, error }.
function settingParse_(sch, raw) {
  var s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (sch.type === 'int' || sch.type === 'money') {
    var t = s.replace(/\s|₾|%/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: 'нужно число' };
    var n = Number(t);
    if (sch.type === 'int' && n !== Math.floor(n)) return { ok: false, error: 'нужно целое число' };
    if (sch.type === 'money') n = Math.round(n * 100) / 100;
    if (sch.min !== undefined && n < sch.min) return { ok: false, error: 'не меньше ' + sch.min };
    if (sch.max !== undefined && n > sch.max) return { ok: false, error: 'не больше ' + sch.max };
    return { ok: true, value: n };
  }
  if (sch.type === 'text' || sch.type === 'sheet') {
    if (!s) return { ok: false, error: 'пустое значение' };
    if (s.length > 100) return { ok: false, error: 'не длиннее 100 символов' };
    return { ok: true, value: s };
  }
  if (sch.type === 'list') {
    var list = s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!list.length) return { ok: false, error: 'пустой список' };
    if (list.some(function (x) { return x.length > 100; })) return { ok: false, error: 'элемент длиннее 100 символов' };
    return { ok: true, value: list };
  }
  return { ok: false, error: 'неизвестный тип' };
}

function settingSchema_(key) {
  var sch = SETTINGS_SCHEMA[key];
  if (!sch) throw new Error('Неизвестная настройка: ' + key);
  return sch;
}

/**
 * Значение настройки. Порядок: лист (ключ + объект) → умолчание кода для объекта → лист (ключ) →
 * старое свойство скрипта (если было) → умолчание кода. Неверное значение в листе пропускается
 * (берётся следующее по порядку) и пишется предупреждение в журнал выполнения.
 */
function settingGet_(key, obj) {
  return settingResolve_(key, obj).value;
}

function settingResolve_(key, obj) {
  var sch = settingSchema_(key), meta = settingsLoad_(), raw = meta.v, o = settingObj_(obj), errors = [];
  function fromSheet(k) {
    if (meta.d[k]) errors.push(k + ': строка повторяется в листе, действует первая');
    if (!raw.hasOwnProperty(k)) return null;
    var p = settingParse_(sch, raw[k]);
    if (p.ok) return p;
    errors.push(k + ': «' + raw[k] + '» — ' + p.error);
    if (!_settingsWarned[k]) { _settingsWarned[k] = 1; console.warn('Настройка ' + k + ' пропущена: ' + p.error); }
    return null;
  }
  var r;
  if (o && sch.perObject) {
    r = fromSheet(key + '|' + o);
    if (r) return { value: r.value, source: 'sheet', errors: errors };
    var dk = settingDefKey_(sch, o);
    if (dk !== null) return { value: sch.defs[dk], source: 'default', errors: errors };
  }
  r = fromSheet(key + '|');
  if (r) return { value: r.value, source: 'sheet', errors: errors };
  if (sch.legacyProp) {
    var lp = PropertiesService.getScriptProperties().getProperty(sch.legacyProp);
    var pl = lp ? settingParse_(sch, lp) : null;
    if (pl && pl.ok) return { value: pl.value, source: 'property', errors: errors };
  }
  return { value: sch.def, source: 'default', errors: errors };
}

// Ключ умолчания кода для объекта (без учёта регистра) или null.
function settingDefKey_(sch, o) {
  var keys = Object.keys(sch.defs || {});
  for (var i = 0; i < keys.length; i++) if (settingObj_(keys[i]) === o) return keys[i];
  return null;
}

// Сброс кэша настроек: новая версия → следующее чтение идёт в лист. Нужен и после ручной правки листа
// (вызывается из «Обновить данные»).
function settingsBump_() {
  // уникальная версия: два сохранения в одну миллисекунду не должны получить один и тот же кэш
  PropertiesService.getScriptProperties().setProperty('SET_VER', Date.now() + '-' + Math.floor(Math.random() * 1e9));
  _settingsRun = null;
}

// ---------- Для экрана «Настройки» (только администратор) ----------

function appSettings(pin) {
  checkAdmin_(pin);
  var meta = settingsLoad_(), out = [];
  Object.keys(SETTINGS_SCHEMA).forEach(function (key) {
    var sch = SETTINGS_SCHEMA[key];
    var objs = [''], seen = { '': 1 };
    function add(name) { var n = settingObj_(name); if (!seen[n]) { seen[n] = 1; objs.push(name); } }
    if (sch.perObject) {
      Object.keys(sch.defs || {}).forEach(add);
      Object.keys(meta.n).forEach(function (k) { if (k.slice(0, k.indexOf('|')) === key) add(meta.n[k]); });
    }
    objs.forEach(function (o) {
      var r = settingResolve_(key, o), dk = o ? settingDefKey_(sch, settingObj_(o)) : null;
      out.push({ key: key, obj: o, group: sch.group, label: sch.label, type: sch.type, perObject: sch.perObject || '',
        value: r.value, source: r.source, def: dk !== null ? sch.defs[dk] : sch.def,
        min: sch.min, max: sch.max, error: r.errors.join('; ') });
    });
  });
  return { items: out, dryRun: CONFIG.DRY_RUN };
}

// value === '' — вернуть значение по умолчанию (строка листа остаётся, значение очищается).
function appSettingsSave(pin, key, obj, value) {
  checkAdmin_(pin);
  var sch = settingSchema_(key), o = String(obj || '').replace(/\s+/g, ' ').trim();
  if (o && !sch.perObject) throw new Error('У этой настройки нет значений по объектам');
  if (o.length > 60) throw new Error('Слишком длинное название объекта');
  var reset = String(value === null || value === undefined ? '' : value).trim() === '';
  var p = reset ? null : settingParse_(sch, value);
  if (p && !p.ok) throw new Error(sch.label + ': ' + p.error);
  if (p && sch.type === 'sheet') {
    var ss = SpreadsheetApp.openById(prop_(sch.file));
    if (!ss.getSheetByName(p.value)) throw new Error('В файле нет листа «' + p.value + '»');
  }
  var text = reset ? '' : (sch.type === 'list' ? p.value.join(', ') : String(p.value));
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var was = settingResolve_(key, o).value;
    var sh = dbSheet_(SETTINGS_SHEET, SETTINGS_HEAD), row = 0;
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r, i) {
        if (!row && String(r[0]).trim() === key && settingObj_(r[1]) === settingObj_(o)) row = i + 2;
      });
    }
    if (!row) {
      if (reset) return { ok: true, dryRun: false, unchanged: true };
      row = sh.getLastRow() + 1;
    }
    sh.getRange(row, 3).setNumberFormat('@');  // как текст: таблица не превратит «10.26» в дату и т. п.
    sh.getRange(row, 1, 1, 4).setValues([[key, o, text, new Date()]]);
    settingsBump_();
    (sch.drop || []).forEach(function (k) { try { cacheDropBig_(k); CacheService.getScriptCache().remove(k); } catch (e) {} });
    var now = settingResolve_(key, o).value;
    logChange_('', '', 'настройка: ' + sch.label + (o ? ' (' + o + ')' : ''), settingText_(was), settingText_(now));
    return { ok: true, dryRun: false, value: now };
  } finally {
    lock.releaseLock();
  }
}

function settingText_(v) { return Array.isArray(v) ? v.join(', ') : String(v); }

// Для формы матчей: взнос по умолчанию и по командам (вместо копии 200/300 на клиенте).
// Ключи byTeam — названия команд в нижнем регистре без лишних пробелов (клиент сравнивает так же).
function champFeeDefaults_() {
  var byTeam = {}, sch = SETTINGS_SCHEMA['matches.champFee'], raw = settingsRaw_(), P = 'matches.champFee|';
  Object.keys(sch.defs || {}).forEach(function (t) { byTeam[settingObj_(t)] = settingGet_('matches.champFee', t); });
  Object.keys(raw).forEach(function (k) {
    if (k.indexOf(P) === 0 && k.length > P.length) byTeam[k.slice(P.length)] = settingGet_('matches.champFee', k.slice(P.length));
  });
  return { def: settingGet_('matches.champFee'), byTeam: byTeam };
}
