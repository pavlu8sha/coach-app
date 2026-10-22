function auditSheets_() {
  var out = [];
  function dump(label, ss) {
    out.push('=== ' + label + ': ' + ss.getName() + ' ===');
    ss.getSheets().forEach(function (sh) {
      var lr = sh.getLastRow(), lc = sh.getLastColumn(), head = '';
      if (lr > 0 && lc > 0) {
        var h = sh.getRange(1, 1, 1, Math.min(lc, 12)).getValues()[0];
        head = h.map(function (x) { return String(x).slice(0, 18); }).join(' | ');
      }
      out.push(sh.getName() + ' — строк ' + lr + ', колонок ' + lc + (sh.isSheetHidden() ? ' [скрыт]' : '') + (head ? '\n    ' + head : ''));
    });
  }
  dump('ТАБЛИЦА ПОСЕЩАЕМОСТИ (копия)', SpreadsheetApp.getActive());
  var id = PropertiesService.getScriptProperties().getProperty('ADMIN_ID');
  if (id) dump('ADMINAPP', SpreadsheetApp.openById(id));
  Logger.log(out.join('\n'));
}