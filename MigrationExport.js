/** Выгрузка всех листов файлов-источников в CSV на Google Диск — для переноса в базу.
 *  Только чтение таблиц. Работает только в окне обслуживания (MAINT_UNTIL), без PIN.
 *  Воронка (листы с «ВОРОНК») не выгружается: там телефоны, которые не переносим. */

var EXPORT_PROPS = ['ATT_ID', 'PAY_ID', 'ADMIN_ID', 'GAMES_ID', 'EQUIP_ID', 'IND_ID', 'EXTRA_ID', 'GN_FILE'];

function csvCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvText_(rows) {
  return rows.map(function (r) { return r.map(csvCell_).join(','); }).join('\n');
}
function exportFileName_(name) {
  return String(name).replace(/[\/\\?*:|"<>]/g, '_') + '.csv';
}
function isFunnelSheet_(name) {
  return /ВОРОНК|FUNNEL/i.test(String(name));
}

function migrationExport() {
  maintCheck_();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tbilisi', 'yyyy-MM-dd HH-mm');
  var root = DriveApp.createFolder('migration-export ' + stamp);
  var report = [];
  EXPORT_PROPS.forEach(function (prop) {
    try {
      // GN_FILE_ID зашит в GamesNew.js (файл игр и тренировок), свойства нет
      var ss = prop === 'GN_FILE' ? SpreadsheetApp.openById(GN_FILE_ID)
        : clubSource_(prop, 'Не задано свойство ' + prop);
      var sub = root.createFolder(prop);
      ss.getSheets().forEach(function (sh) {
        var name = sh.getName();
        if (isFunnelSheet_(name)) { report.push(prop + ' / ' + name + ': пропущен (воронка)'); return; }
        var csv = csvText_(sh.getDataRange().getDisplayValues());
        sub.createFile(exportFileName_(name), csv, MimeType.CSV);
        report.push(prop + ' / ' + name + ': ' + sh.getLastRow() + ' строк');
      });
    } catch (e) {
      report.push(prop + ': ошибка — ' + e.message);
    }
  });
  return { folder: root.getUrl(), report: report };
}
