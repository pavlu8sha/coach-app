/** Проверка здоровья приложения. Только читает, ничего не пишет. Запуск: выберите selfTest и «Выполнить». */

function selfTest() {
  var out = [];
  function check(name, fn) {
    var t = Date.now();
    try {
      var r = fn();
      out.push('OK    ' + name + (r ? ': ' + r : '') + ' (' + (Date.now() - t) + ' мс)');
    } catch (e) {
      out.push('ОШИБКА ' + name + ': ' + e.message);
    }
  }
  var props = PropertiesService.getScriptProperties();
  ['APP_PIN', 'APP_ADMIN_PIN', 'ATT_ID', 'EQUIP_ID', 'PAY_ID', 'GAMES_ID', 'ADMIN_ID', 'IND_ID', 'EXTRA_ID', 'FUNNEL_ID'].forEach(function (k) {
    check('свойство ' + k, function () { if (!props.getProperty(k)) throw new Error('не задано'); });
  });
  var ss = SpreadsheetApp.getActive();
  [CONFIG.REGISTRY_SHEET, 'СПРАВОЧНИКИ', 'МАТЧИ', 'УЧАСТИЕ', CAT_SHEET].forEach(function (n) {
    check('лист ' + n, function () {
      var sh = ss.getSheetByName(n);
      if (!sh) throw new Error('листа нет');
      return (sh.getLastRow() - 1) + ' строк';
    });
  });
  [SUB_SHEET, PAY_SHEET, 'ЖУРНАЛ ИЗМЕНЕНИЙ'].forEach(function (n) {
    check('AdminApp: лист ' + n, function () {
      var sh = dbRead_(n);
      if (!sh) throw new Error('листа нет в AdminApp');
      return (sh.getLastRow() - 1) + ' строк';
    });
  });
  check('файл «Игры / Тренировки»', function () {
    var f = gnFile_();
    return f.getName() + (gnIsProd_() ? ' (боевой проект)' : ' (тестовый проект, свойство GN_FILE_ID)');
  });
  check('настройки', function () {
    var bad = appSettings(prop_('APP_ADMIN_PIN')).items.filter(function (x) { return x.error; });
    if (bad.length) throw new Error(bad.map(function (x) { return x.key + (x.obj ? ' (' + x.obj + ')' : '') + ': ' + x.error; }).join('; '));
    return 'лист ' + SETTINGS_SHEET + (dbRead_(SETTINGS_SHEET) ? '' : ' ещё не создан, всё по умолчанию');
  });
  check('расписание сезона', function () {
    var sc = schedLoad_();
    if (sc.bad.length) throw new Error('в листе ' + SCHED_SHEET + ' пропущены строки: ' + sc.bad.map(function (b) { return b.line + ' (' + b.error + ')'; }).join('; '));
    return sc.rows.length + ' тренировок, ' + (sc.source === 'sheet' ? 'лист ' + SCHED_SHEET : 'по умолчанию, лист ещё не создан');
  });
  check('реестр игроков', function () { return regData_().players.length + ' игроков'; });
  check('файл оплат', function () { return payMonths_().length + ' месяцев'; });
  check('файл экипировки', function () { equipSheet_(); return 'лист открыт, L3 в порядке'; });
  check('кэш', function () {
    var c = CacheService.getScriptCache();
    c.put('selftest', 'ok', 30);
    if (c.get('selftest') !== 'ok') throw new Error('кэш не работает');
  });
  check('часовой пояс', function () {
    var a = Session.getScriptTimeZone(), b = ss.getSpreadsheetTimeZone();
    if (a !== b) throw new Error('проект ' + a + ', таблица ' + b + ': сделайте одинаковыми');
    return a;
  });
  check('триггеры', function () {
    var h = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    ['warmUp', 'indWeeklyCreate'].forEach(function (n) { if (h.indexOf(n) < 0) throw new Error('нет триггера ' + n); });
    return h.length + ' триггеров';
  });
  out.push('Режим пробной записи (DRY_RUN): ' + (CONFIG.DRY_RUN ? 'ВКЛ, ничего не пишется' : 'выкл'));
  Logger.log('\n' + out.join('\n'));
}

function perfAtt() {
  var pin = PropertiesService.getScriptProperties().getProperty('APP_PIN');
  var d = Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  var out = [];
  function t(n, f) {
    var s = Date.now();
    try { var r = f(); out.push(n + ': ' + (Date.now() - s) + ' мс'); return r; }
    catch (e) { out.push(n + ': ОШИБКА ' + e.message); }
  }
  var gs = t('appGroups', function () { return appGroups(pin, d); });
  var g = gs && gs[0] && gs[0].name;
  if (g) {
    t('appRoster (' + g + ')', function () { return appRoster(pin, g, d); });
    t('appRoster повторно', function () { return appRoster(pin, g, d); });
  }
  Logger.log('\n' + out.join('\n'));
}