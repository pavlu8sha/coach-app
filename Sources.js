/** Общие источники файлов для рабочих модулей приложения.
 *  Отдельные прямые открытия оставлены только в диагностике envCheck()/auditSheets();
 *  gnFile_ (GamesNew.js) имеет собственную проверку ID для production/test. */

var _sourceFiles = Object.create(null);

// Открыть файл по свойству с ID. Один открытый экземпляр на ID за запуск;
// два свойства с одним ID открывают один файл.
function clubSource_(propKey, notSetMsg) {
  var id = prop_(propKey);
  if (!id) throw new Error(notSetMsg);
  var hit = _sourceFiles[id];
  if (hit) return hit;
  var t0 = Date.now();
  var f = SpreadsheetApp.openById(id);
  _sourceFiles[id] = f;
  Logger.log('открытие ' + propKey + ': ' + (Date.now() - t0) + ' мс');
  return f;
}
