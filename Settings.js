/**
 * Настройки приложения (SettingsService, этап 1).
 *
 * Схема (ключи, типы, границы, а для технических настроек — значения по умолчанию) — здесь, в коде.
 * Значения, которые меняет администратор, — лист «НАСТРОЙКИ» в AdminApp: Ключ | Объект | Значение | Изменено.
 * Экран — страница «Настройки» (SettingsPage.html, ?page=settings), только для администратора.
 *
 * Денежные настройки (required) не имеют суммы в коде: если значения нет или оно неверное,
 * settingGet_ возвращает null, а не «старую» сумму, и экран/SelfTest показывают ошибку.
 *
 * Значения только разбираются по типу (число, текст, список). Код из значений не выполняется.
 * Секреты (коды входа) и ID файлов здесь не хранятся: они остаются в свойствах скрипта.
 */

var SETTINGS_SHEET = 'НАСТРОЙКИ';
var SETTINGS_HEAD = ['Ключ', 'Объект', 'Значение', 'Изменено'];

// group — раздел экрана «Настройки»; perObject — у настройки могут быть значения по объектам (команда и т. п.);
// required — суммы в коде нет, отсутствие значения — ошибка; strict — неверное значение не заменяется следующим
// по порядку, а даёт null; choices — откуда экран берёт список объектов; locked — менять нельзя (причина);
// drop — кэши, которые нужно сбросить после изменения.
var SETTINGS_SCHEMA = {
  'stats.lowPct': {
    group: 'Посещаемость', label: 'Порог низкой посещаемости, %', type: 'int', def: 50, min: 0, max: 100
  },
  'matches.champFee': {
    group: 'Матчи', label: 'Взнос за чемпионат, ₾', type: 'money', min: 0, max: 100000,
    perObject: 'Команда', objectsTitle: 'Свои значения команд', required: true, strict: true, choices: 'matchTeams',
    missingHint: 'чемпионаты создаются без взноса, пока его нет'
  },
  'equip.seasonSheet': {
    group: 'Экипировка', label: 'Лист заказов текущего сезона', type: 'sheet', def: 'СЕЗОН 2026-2027', file: 'EQUIP_ID',
    drop: ['eq_v1', 'eq_hdr_ok'],
    locked: 'Переключение сезона пока отключено: журнал «ОПЛАТЫ» хранит только номер строки заказа без сезона, ' +
      'старые платежи могут перепутаться с заказами нового листа.'
  },
  'ind.capIndividual': {
    group: 'Индивидуальные и дополнительные', label: 'Мест на индивидуальном занятии', type: 'int', def: 6, min: 1, max: 50
  },
  'ind.capGoalkeepers': {
    group: 'Индивидуальные и дополнительные', label: 'Мест на вратарском занятии', type: 'int', def: 7, min: 1, max: 50
  },
  'extra.cap': {
    group: 'Индивидуальные и дополнительные', label: 'Мест на дополнительной тренировке (0 — без ограничения)', type: 'int',
    def: 0, min: 0, max: 200
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
 * Значение настройки. Порядок: лист (ключ + объект) → лист (общее значение) → старое свойство скрипта (если было) →
 * значение по умолчанию из схемы (только у технических настроек). Нет ничего — null (source 'missing').
 * Неверное значение: у strict-настроек — null (source 'invalid'), у остальных пропускается с предупреждением.
 */
function settingGet_(key, obj) {
  return settingResolve_(key, obj).value;
}

function settingResolve_(key, obj) {
  var sch = settingSchema_(key), meta = settingsLoad_(), raw = meta.v, o = settingObj_(obj), errors = [];
  function look(k) {
    if (meta.d[k]) errors.push('строка повторяется в листе, действует первая');
    if (!raw.hasOwnProperty(k)) return { st: 'none' };
    var p = settingParse_(sch, raw[k]);
    if (p.ok) return { st: 'ok', value: p.value };
    errors.push((k.slice(k.indexOf('|') + 1) ? 'значение для «' + (meta.n[k] || o) + '»' : 'общее значение') + ' «' + raw[k] + '» — ' + p.error);
    if (!_settingsWarned[k]) { _settingsWarned[k] = 1; console.warn('Настройка ' + k + ' неверна: ' + p.error); }
    return { st: 'bad' };
  }
  function done(value, source) { return { value: value, source: source, errors: errors }; }
  var r;
  if (o && sch.perObject) {
    r = look(key + '|' + o);
    if (r.st === 'ok') return done(r.value, 'object');
    if (r.st === 'bad' && sch.strict) return done(null, 'invalid');
  }
  r = look(key + '|');
  if (r.st === 'ok') return done(r.value, 'sheet');
  if (r.st === 'bad' && sch.strict) return done(null, 'invalid');
  if (sch.legacyProp) {
    var lp = PropertiesService.getScriptProperties().getProperty(sch.legacyProp);
    var pl = lp ? settingParse_(sch, lp) : null;
    if (pl && pl.ok) return done(pl.value, 'property');
  }
  if (sch.hasOwnProperty('def')) return done(sch.def, 'default');
  if (sch.required) errors.push('не задано' + (sch.missingHint ? ': ' + sch.missingHint : ''));
  return done(null, 'missing');
}

// Сброс кэша настроек: новая версия → следующее чтение идёт в лист. Нужен и после ручной правки листа
// (вызывается из «Обновить данные»).
function settingsBump_() {
  // уникальная версия: два сохранения в одну миллисекунду не должны получить один и тот же кэш
  PropertiesService.getScriptProperties().setProperty('SET_VER', Date.now() + '-' + Math.floor(Math.random() * 1e9));
  _settingsRun = null;
}

// ---------- Для экрана «Настройки» (только администратор) ----------

// Список объектов для выбора на экране (команды из событий матчей). Ошибка чтения — пустой список.
function settingChoices_(sch) {
  if (sch.choices !== 'matchTeams') return [];
  try {
    var seen = {}, out = [];
    matchesData_().events.forEach(function (e) {
      var t = String(e.team || '').replace(/\s+/g, ' ').trim(), k = settingObj_(t);
      if (t && !seen[k]) { seen[k] = 1; out.push(t); }
    });
    return out.sort();
  } catch (e) { return []; }
}

// items — по строке на значение: общее (obj '') и по объектам, которые есть в листе.
// keys — описание настроек для экрана (подпись, тип, границы, обязательность, блокировка, список объектов).
function appSettings(pin) {
  checkAdmin_(pin);
  var meta = settingsLoad_(), out = [], keys = {};
  Object.keys(SETTINGS_SCHEMA).forEach(function (key) {
    var sch = SETTINGS_SCHEMA[key];
    keys[key] = { label: sch.label, group: sch.group, type: sch.type, min: sch.min, max: sch.max, perObject: sch.perObject || '',
      objectsTitle: sch.objectsTitle || '', required: !!sch.required, locked: sch.locked || '', hasDefault: sch.hasOwnProperty('def'),
      def: sch.hasOwnProperty('def') ? settingText_(sch.def) : '', choices: sch.perObject ? settingChoices_(sch) : [] };
    var objs = [''], seen = { '': 1 };
    if (sch.perObject) {
      Object.keys(meta.n).forEach(function (k) {
        var n = settingObj_(meta.n[k]);
        if (k.slice(0, k.indexOf('|')) === key && !seen[n]) { seen[n] = 1; objs.push(meta.n[k]); }
      });
    }
    objs.forEach(function (o) {
      var r = settingResolve_(key, o), mk = key + '|' + settingObj_(o);
      out.push({ key: key, obj: o, value: r.value === null ? null : settingText_(r.value), source: r.source,
        raw: meta.v.hasOwnProperty(mk) ? meta.v[mk] : '', error: r.errors.join('; ') });
    });
  });
  return { items: out, keys: keys, dryRun: CONFIG.DRY_RUN };
}

// value === '' — очистить значение: у объекта — вернуться к общему, у общего — к значению по умолчанию
// (у денежных настроек его нет: значение станет «не задано»). Строка листа остаётся, значение очищается.
function appSettingsSave(pin, key, obj, value) {
  checkAdmin_(pin);
  var sch = settingSchema_(key), o = String(obj || '').replace(/\s+/g, ' ').trim();
  if (sch.locked) throw new Error(sch.locked);
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
    var after = settingResolve_(key, o);
    logChange_('', '', 'настройка: ' + sch.label + (o ? ' (' + o + ')' : ''), settingText_(was), settingText_(after.value) + (reset ? ' (очищено)' : ''));
    return { ok: true, dryRun: false, value: after.value, source: after.source };
  } finally {
    lock.releaseLock();
  }
}

function settingText_(v) { return v === null || v === undefined ? 'не задано' : (Array.isArray(v) ? v.join(', ') : String(v)); }

// Для формы матчей: общий взнос и значения команд из настроек (сумм в коде нет).
// Ключи byTeam — названия команд в нижнем регистре без лишних пробелов (клиент сравнивает так же).
// null — значение не задано или неверное: форма показывает «не настроен», событие создаётся без взноса.
function champFeeDefaults_() {
  var K = 'matches.champFee', P = K + '|', meta = settingsLoad_(), gen = settingResolve_(K), byTeam = {};
  Object.keys(meta.n).forEach(function (k) {
    if (k.indexOf(P) === 0) byTeam[k.slice(P.length)] = settingResolve_(K, meta.n[k]).value;
  });
  return { def: gen.value, byTeam: byTeam, error: gen.errors.join('; ') };
}
