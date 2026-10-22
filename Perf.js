// Замер скорости серверных запросов. Ничего не пишет, только читает.
function perfReport_() {
  var pin = prop_('APP_ADMIN_PIN');
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var pid = '';
  try { pid = regData_().players[0].id; } catch (e) {}
  var KEYS = ['reg_v1', 'sl_v1', 'md_v2', 'mf_v1', 'eq_v1', 'cat_v1', 'camp_v1', 'ind_v1'];
  var tests = [
    ['Отметки (appAttInit)',          function () { return appAttInit(pin, today, '', false); }],
    ['Игроки (appAdminInit)',         function () { return appAdminInit(pin); }],
    ['Приём оплат: лента за сегодня', function () { return appTodayPayments(pin); }],
    ['Карточка игрока: абонемент',    function () { return appPlayerSubs(pin, pid); }],
    ['Должники',                      function () { return appDebtors(pin, ''); }],
    ['Экипировка',                    function () { return appEquipOrders(pin); }],
    ['Матчи',                         function () { return appMatchesData(pin); }],
    ['Индивидуальные',                function () { return appIndData(pin); }],
    ['Индивидуальные: список игроков', function () { return appIndPlayers(pin); }]
  ];
  var out = [];
  tests.forEach(function (t) {
    KEYS.forEach(function (k) { try { cacheDropBig_(k); } catch (e) {} });
    var r = [t[0]];
    for (var i = 0; i < 2; i++) {
      var s = Date.now();
      try { t[1](); r.push(Date.now() - s); }
      catch (e) { r.push('ошибка: ' + e.message); break; }
    }
    out.push(r);
  });
  out.forEach(function (r) {
    Logger.log(r[0] + ' | холодный: ' + r[1] + ' мс | тёплый: ' + (r[2] === undefined ? '-' : r[2]) + ' мс');
  });
}

// Замер сборки страниц (doGet) — сколько сервер собирает каждую страницу
function perfPage_() {
  ['', 'admin', 'stats', 'equip', 'pay', 'cash', 'debt', 'games', 'camp', 'ind'].forEach(function (p) {
    var s = Date.now();
    try { doGet({ parameter: { page: p } }); Logger.log((p || 'att') + ': ' + (Date.now() - s) + ' мс'); }
    catch (e) { Logger.log((p || 'att') + ': ошибка ' + e.message); }
  });
}