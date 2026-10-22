/**
 * Окно обслуживания для ручных функций, которые меняют триггеры (installWarmTrigger, indInstallTrigger).
 * Веб-приложение открыто всем и выполняется от имени владельца, поэтому любую публичную функцию можно вызвать
 * извне через google.script.run. Установщики остаются публичными, чтобы их было видно в меню «Выполнить»,
 * но работают только пока открыто окно:
 *   «Настройки проекта» → «Свойства скрипта» → MAINT_UNTIL = время окончания, «ГГГГ-ММ-ДД ЧЧ:ММ» (часовой пояс скрипта),
 *   не дальше MAINT_MAX_MIN минут от текущего. Окно закрывается само, когда время прошло.
 */

var MAINT_PROP = 'MAINT_UNTIL', MAINT_MAX_MIN = 60;

// «2026-10-22 12:30» → минуты (для сравнения двух времён в одном поясе); неверный формат → null
function maintMin_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31 || +m[4] > 23 || +m[5] > 59) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
}

function maintCheck_() {
  var until = maintMin_(PropertiesService.getScriptProperties().getProperty(MAINT_PROP));
  var now = maintMin_(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  if (until === null || until < now || until - now > MAINT_MAX_MIN)
    throw new Error('Окно обслуживания закрыто. «Настройки проекта» → «Свойства скрипта»: задайте ' + MAINT_PROP +
      ' = время окончания в формате ГГГГ-ММ-ДД ЧЧ:ММ, не дальше ' + MAINT_MAX_MIN + ' минут от текущего, и запустите снова.');
}
