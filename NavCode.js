/** Единое меню, вход и сборка страниц. */

function appWho(pin) {
  if (!pin) return '';
  var admin = prop_('APP_ADMIN_PIN'), trainer = prop_('APP_PIN');
  if (admin && String(pin) === String(admin)) return 'admin';
  if (trainer && String(pin) === String(trainer)) return 'trainer';
  failDelay_();
  return '';
}

// Замедление перебора кода: после 20 неудач за 10 минут каждая следующая проверка занимает дольше.
function failDelay_() {
  try {
    var c = CacheService.getScriptCache(), n = Number(c.get('pin_fail')) || 0;
    c.put('pin_fail', String(n + 1), 600);
    if (n >= 20) Utilities.sleep(Math.min(5000, (n - 19) * 500));
  } catch (e) {}
}

// Для отметки посещаемости подходит и код тренера, и код администратора.
function checkPin_(pin) {
  if (!appWho(pin)) throw new Error('Неверный код доступа');
}

// Страницы: адрес ?page=ключ → [HTML-файл, заголовок, пункт меню, который подсвечивается (если не сам ключ)]
var PAGES_ = {
  admin: ['Admin', 'Игроки'], stats: ['Stats', 'Статистика'], equip: ['Kit', 'Экипировка'],
  pay: ['Pay', 'Оплаты'], cash: ['Cash', 'Приём оплат', 'pay'], debt: ['Debt', 'Должники', 'pay'],
  games: ['Games', 'Матчи'], camp: ['Camp', 'Сборы'], ind: ['Ind', 'Индивидуальные'],
  extra: ['ExtraPage', 'Дополнительные', 'ind'], funnel: ['FunnelPage', 'Новые игроки'],
  accounting: ['AccountPage', 'Посещаемость тренеров'], settings: ['Settings', 'Настройки']
};
// Дополнительные HTML-вставки (скрипты), подключаемые к странице
var PAGE_EXTRAS_ = {
  admin: ['AdminTabs', 'AdminList'],
  games: ['GamesTools', 'GamesScore'],
  stats: ['StatsMatches'],
  equip: ['KitCatalog']
};
// Группы вкладок под меню: страницы одной группы переключаются вкладками
var TAB_GROUPS_ = [
  [['Приём оплат', 'cash'], ['По месяцам и группам', 'pay'], ['Должники', 'debt']],
  [['Индивидуальные', 'ind'], ['Дополнительные', 'extra']]
];

function tabsHtml_(url, page) {
  var group = TAB_GROUPS_.filter(function (g) { return g.some(function (t) { return t[1] === page; }); })[0];
  if (!group) return '';
  var h = group.map(function (t) {
    var on = t[1] === page;
    return '<a target="_top" href="' + url + '?page=' + t[1] + '" style="padding:7px 14px;border-radius:10px;text-decoration:none;font:600 14px system-ui,-apple-system,sans-serif;border:1px solid var(--line,#DCE3DD);'
      + (on ? 'background:var(--ink,#15211A);color:var(--bg,#F4F6F3)' : 'background:var(--card,#fff);color:var(--ink,#15211A)') + '">' + t[0] + '</a>';
  }).join('');
  // data-gate: вкладки показываются только после входа по коду (см. Nav.html)
  return '<div data-gate style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px 0;max-width:592px;margin:0 auto;box-sizing:border-box;width:100%">' + h + '</div>';
}

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || '';
  var def = PAGES_.hasOwnProperty(page) ? PAGES_[page] : null;
  var file = def ? def[0] : 'Index';
  var url = ScriptApp.getService().getUrl();
  var navPage = def ? (def[2] || page) : 'att';
  var nav = HtmlService.createHtmlOutputFromFile('Nav').getContent()
    .replace('__URL__', url)
    .replace('__PAGE__', navPage);
  var sub = tabsHtml_(url, page);
  var html = HtmlService.createHtmlOutputFromFile(file).getContent()
    .replace(/<body[^>]*>/i, function (m) { return m + nav + sub; });
  var extra = '';
  (PAGE_EXTRAS_.hasOwnProperty(page) ? PAGE_EXTRAS_[page] : []).forEach(function (f) {
    extra += HtmlService.createHtmlOutputFromFile(f).getContent();
  });
  var kind = page === 'pay' ? 'pay' : (def ? '' : 'att');
  if (kind) extra += '<script>window.KS_KIND="' + kind + '"</script>' + HtmlService.createHtmlOutputFromFile('MonthTools').getContent();
  if (extra) html = html.replace('</body>', function () { return extra + '</body>'; });
  return HtmlService.createHtmlOutput(html)
    .setTitle(def ? def[1] : 'Посещаемость')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}