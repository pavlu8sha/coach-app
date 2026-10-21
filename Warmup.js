// Прогрев кэша: каждый ключ сбрасывается и тут же пересчитывается, поэтому пользователи не ждут
function warmCore_() {
  var tz = Session.getScriptTimeZone(), now = new Date();
  var pin = prop_('APP_ADMIN_PIN');
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  function mk(d) { return Utilities.formatDate(d, tz, 'MM.yy'); }
  var cur = mk(now), nxt = mk(new Date(now.getFullYear(), now.getMonth() + 1, 1)), prv = mk(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  function step(keys, fn) {
    var t0 = Date.now();
    try { keys.forEach(function (k) { cacheDropBig_(k); }); fn(); } catch (e) { Logger.log('прогрев: ' + e.message); }
    Logger.log(keys.join('+') + ': ' + (Date.now() - t0) + ' мс');
  }
  step(['reg_v1'], function () { regData_(); });
  step(['sl_v1'], function () { subLedger_(); });
  step(['pmonths'], function () { payMonths_(); });
  // Все месяцы из файла оплат (список уже обновлён выше), плюс прошлый, текущий и следующий
  var months = [];
  try { months = payMonths_() || []; } catch (e) { Logger.log('прогрев месяцев: ' + e.message); }
  [prv, cur, nxt].forEach(function (m) { if (months.indexOf(m) < 0) months.push(m); });
  months.forEach(function (m) {
    step(['pm_' + m], function () { monthGroups_(m); });
  });
  step(['cola_' + cur], function () { appAttInit(pin, today, '', false); });
  step(['md_v2', 'mf_v1'], function () { appMatchesData(pin); });
  step(['eq_v1'], function () { appEquipOrders(pin); });
  step(['cat_v1'], function () { appCatalog(pin); });
  step(['ind_v1'], function () { indParse_(true); });
  step(['extra_v1'], function () { extraParse_(true); });
}

// Запускается по расписанию; ночью ничего не делает
function warmUp() {
  var h = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  if (h < 7 || h >= 23) return;
  warmCore_();
}

// Кнопка «Обновить данные» в меню
function appRefreshData(pin) {
  checkPin_(pin);
  settingsBump_();
  indDropSheetCache_();
  extraDropSheetCache_();
  warmCore_();
  return true;
}

// Запустить ОДИН раз: включает прогрев каждые 10 минут
function installWarmTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'warmUp') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('warmUp').timeBased().everyMinutes(10).create();
  Logger.log('Прогрев включён: каждые 10 минут, с 7:00 до 23:00');
}

// Для ручного запуска из редактора: замер времени по шагам прогрева
function warmTest_() { warmCore_(); }