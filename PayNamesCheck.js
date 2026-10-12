/** Проверка: игроки из файла оплат, которых нет в реестре игроков. Ничего не записывает.
 *  Запускается вручную из редактора Apps Script (функция payNamesNotInRegistry), результат в журнале. */

function payNamesNotInRegistry() {
  var reg = {};
  readRegistry_().players.forEach(function (p) { reg[norm(p.name)] = p; });
  var miss = {}, file = payFile_();
  file.getSheets().forEach(function (sh) {
    var month = sh.getName();
    if (!/^\d{2}\.\d{2}$/.test(month)) return;
    var groups = parseMonth_(sh);
    // блок «Индивидуальные / Вратарские» пропускается в parseMonth_, поэтому читаем его отдельно
    try {
      var b = indBlock_(sh);
      for (var i = b.hdr + 2; i < b.end; i++) {
        var nm = String(b.vals[i][1]).trim();
        if (nm && !reg[norm(nm)]) add_(miss, nm, month, IND_BLOCK_NAME);
      }
    } catch (e) {}
    groups.forEach(function (g) {
      g.rows.forEach(function (r) {
        if (r.name && !reg[norm(r.name)]) add_(miss, r.name, month, g.name);
      });
    });
  });
  var names = Object.keys(miss).sort();
  var out = ['Игроков в файле оплат, которых нет в реестре: ' + names.length];
  names.forEach(function (k) {
    var e = miss[k];
    out.push('  ' + e.name + ' — ' + e.where.join('; '));
  });
  Logger.log(out.join('\n'));
  return names.length;
}

function add_(miss, name, month, group) {
  var k = norm(name);
  if (!miss[k]) miss[k] = { name: name, where: [] };
  var w = month + ' / ' + group;
  if (miss[k].where.indexOf(w) < 0) miss[k].where.push(w);
}
