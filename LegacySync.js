/**
 * Запись игр в старый файл матчей (games): колонки Played / Paid, новые игры и заметка со счётом.
 * Пишет только в файл из свойства GAMES_ID и только если свойство GAMES_WRITE = yes.
 * Ничего не удаляет: недостающие колонки и строки только добавляются.
 */

function legacyEnabled_() {
  return PropertiesService.getScriptProperties().getProperty('GAMES_WRITE') === 'yes';
}

// Цвета ячеек колонки: красная ячейка = игрока нет в этом турнире, её не трогаем.
function colBg_(sh, col, rows) {
  if (!col || col > sh.getMaxColumns()) return null;
  return sh.getRange(1, col, rows, 1).getBackgrounds();
}
function redCell_(bgs, row) { return !!bgs && row - 1 < bgs.length && isRed_(bgs[row - 1][0]); }

// Пакетная запись: sets = [[строка, колонка, значение], ...]. На каждую колонку одно чтение и одна запись.
// Формулы в соседних (не меняемых) ячейках колонки сохраняются как формулы.
function legacyWriteSets_(sh, sets) {
  var byCol = {};
  sets.forEach(function (s) { (byCol[s[1]] = byCol[s[1]] || []).push(s); });
  Object.keys(byCol).forEach(function (c) {
    var list = byCol[c], lo = Infinity, hi = 0;
    list.forEach(function (s) { lo = Math.min(lo, s[0]); hi = Math.max(hi, s[0]); });
    var rg = sh.getRange(lo, Number(c), hi - lo + 1, 1);
    var fx = rg.getFormulas(), val = rg.getValues(), out = [], i;
    for (i = 0; i < fx.length; i++) out.push([fx[i][0] !== '' ? fx[i][0] : val[i][0]]);
    list.forEach(function (s) { out[s[0] - lo][0] = s[2]; });
    rg.setValues(out);
  });
}

// Вызывается после сохранения в приложении. Ошибка не ломает основное сохранение.
function legacySafe_(eventId) {
  var t0 = Date.now();
  try {
    var res = legacySync_(eventId, false);
    var sec = Math.round((Date.now() - t0) / 1000);
    if (sec >= 10) { try { logChange_('', '', 'старый файл: медленно ' + eventId, '', sec + ' с'); } catch (x) {} }
    return res;
  } catch (e) {
    try { logChange_('', '', 'старый файл: ошибка ' + eventId, '', e.message); } catch (x) {}
    return 'В старый файл не записано: ' + e.message + '.';
  }
}

function legacySync_(eventId, dryOnly) {
  if (!dryOnly && !legacyEnabled_()) return 'Запись в старый файл выключена (свойство GAMES_WRITE).';
  if (dryOnly) return legacySyncCore_(eventId, true);
  var lock = LockService.getDocumentLock();   // отдельная от общей блокировки: оплаты не ждут синхронизацию
  lock.waitLock(30000);
  try {
    return legacySyncCore_(eventId, false);
  } finally {
    lock.releaseLock();
  }
}

function legacySyncCore_(eventId, dryOnly) {
  if (!dryOnly && !legacyEnabled_()) return 'Запись в старый файл выключена (свойство GAMES_WRITE).';
  var msh = sheetOf_('МАТЧИ');
  if (!msh) throw new Error('Нет листа МАТЧИ: сначала выполните перенос файла матчей');
  var ss = msh.getParent(), evs = {}, ev;
  msh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    evs[String(r[0])] = { id: String(r[0]), team: String(r[1]), type: String(r[2]), name: String(r[3]),
      date: r[4] instanceof Date ? r[4] : null, fee: 0, parent: String(r[6] || ''),
      opp: String(r[7] || ''), gf: r[8], ga: r[9] };
  });
  ev = evs[eventId];
  if (!ev) throw new Error('событие ' + eventId + ' не найдено');
  var hasScore = ev.gf !== '' && ev.gf != null && ev.ga !== '' && ev.ga != null && !isNaN(Number(ev.gf)) && !isNaN(Number(ev.ga));
  var scoreTxt = hasScore ? Number(ev.gf) + ':' + Number(ev.ga) : 'не указан';
  if (!ev) throw new Error('событие ' + eventId + ' не найдено');
  ev.fee = feeOf_(String(eventId));
  var parent = ev.parent ? evs[ev.parent] : null;
  var pAll = partsSheet_().getDataRange().getValues().slice(1);
  var rosterId = parent ? parent.id : ev.id, roster = {};
  pAll.forEach(function (r) { if (String(r[0]) === rosterId && r[1]) roster[nameKey2_(String(r[2]))] = true; });
  var recs = pAll.filter(function (r) {
    return String(r[0]) === eventId && r[1];
  }).map(function (r) {
      return { team: String(r[4] || ''), name: String(r[2]), played: r[3] === true ? true : (r[3] === false ? false : null),
      paid: finPaid_(eventId, String(r[1])), goals: Number(r[10]) || 0 };
  });

  // Лист команды: чемпионат лежит на листе команды, остальное на «<команда> Friendly».
  var champ = ev.type === 'Чемпионат' || (parent && parent.type === 'Чемпионат'), sh = null;
  gamesFile_().getSheets().forEach(function (s) {
    var n = s.getName();
    if (/newton/i.test(n)) { if (/newton/i.test(ev.team)) sh = s; return; }
    var isF = /friendly\s*$/i.test(n), base = n.replace(/\s*friendly\s*$/i, '').trim();
    if (norm(base) === norm(ev.team) && isF === !champ) sh = s;
  });
  var ov = {};
  try { ov = JSON.parse(PropertiesService.getScriptProperties().getProperty('LEGACY_TABS') || '{}'); } catch (err) {}
  var ovName = ov[ev.team + (champ ? '' : ' Friendly')];
  if (ovName) {
    sh = gamesFile_().getSheetByName(ovName);
    if (!sh) throw new Error('в старом файле нет листа «' + ovName + '»');
  }
  if (!sh) throw new Error('в старом файле нет листа для команды ' + ev.team);
  var blks = legacyBlocks_(sh);
  if (blks.length > 1) return legacyBlockSync_(sh, blks, ev, parent, recs, roster, dryOnly, pAll);
  var P = parseGames_(sh, sh.getName());
  var tzS = ss.getSpreadsheetTimeZone();
  var d = ev.date ? { d: Number(Utilities.formatDate(ev.date, tzS, 'd')), m: Number(Utilities.formatDate(ev.date, tzS, 'M')) } : null;
  var undated = ev.type === 'Чемпионат' || ev.type === 'Фестиваль' || ev.type === 'Турнир';
  var found = P.events.filter(function (e) {
    if (undated) return !e.date && norm(e.name) === norm(ev.name);
    if (!d || !e.date || e.date.d !== d.d || e.date.m !== d.m) return false;
    if (ev.type === 'Игра' && e.parent && parent) return norm(e.parent.name) === norm(parent.name);
    return true;
  })[0] || null;

  var needPlayed = ev.type === 'Игра' || ev.type === 'Товарищеская';
  var needPaid = undated || ev.type === 'Кубок' || (ev.type === 'Товарищеская' && ev.fee > 0);
  var playedCol = found && found.playedCol !== undefined ? found.playedCol + 1 : 0;
  var paidCol = found && found.paidCol !== undefined ? found.paidCol + 1 : 0;
  var live = !dryOnly, notes = [];

  // Новая игра: ищем свободное место, иначе добавляем колонки.
  if (!found) {
    if (ev.type === 'Кубок') throw new Error('кубок: колонку добавьте в старом файле вручную');
    var cnt = (needPlayed ? 1 : 0) + (needPaid ? 1 : 0), maxC = sh.getMaxColumns();
    var hdr = sh.getRange(1, 1, 2, maxC).getDisplayValues();
    var empty = function (c) { return c > maxC || (!hdr[0][c - 1] && !hdr[1][c - 1]); };
    var pos = 0, c;
    if (ev.type === 'Игра' && parent) {
      var pe = P.events.filter(function (e) { return !e.date && norm(e.name) === norm(parent.name); })[0];
      if (pe) {
        var end = pe.paidCol;
        P.events.forEach(function (e) { if (e.parent === pe && e.playedCol > end) end = e.playedCol; });
        pos = end + 2;
      }
    }
    if (!pos) {
      pos = 1;
      for (c = maxC; c >= 1; c--) { if (!empty(c)) { pos = c + 1; break; } }
    }
    var free = true;
    for (c = pos; c < pos + cnt; c++) if (!empty(c)) free = false;
    var inserted = !free || pos + cnt - 1 > maxC;
    if (inserted) {
      if (live) sh.insertColumnsAfter(Math.min(pos - 1, maxC), cnt);
      notes.push('добавлено колонок: ' + cnt);
    }
    if (live) {
      var k = pos, ref = pos > 1 ? pos - 1 : 0, lastR = sh.getMaxRows();
      var put = function (col, label, isDate) {
        if (ref && inserted) {
          try {
            sh.getRange(1, ref, lastR, 1).copyTo(sh.getRange(1, col, lastR, 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
            sh.getRange(lastR, ref).copyTo(sh.getRange(lastR, col), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
          } catch (e) {}
        }
        if (isDate) sh.getRange(1, col).setValue(ev.date).setNumberFormat('dd.MM');
        else if (label.top) sh.getRange(1, col).setValue(label.top);
        sh.getRange(2, col).setValue(label.row2);
      };
      if (undated) { paidCol = k; put(k, { top: ev.name, row2: 'Paid' }, false); }
      else {
        if (needPlayed) { playedCol = k; put(k, { row2: 'Played' }, true); k++; }
        if (needPaid) { paidCol = k; put(k, { row2: 'Paid' }, false); if (needPlayed && needPaid) sh.getRange(1, playedCol, 1, 2).merge(); }
      }
    } else {
      playedCol = needPlayed ? pos : 0;
      paidCol = needPaid ? pos + (needPlayed ? 1 : 0) : 0;
    }
  }

  // Строки игроков на листе.
  var lastRow = Math.max(sh.getLastRow(), 3);
  var A = sh.getRange(1, 1, lastRow, 2).getValues(), bg = sh.getRange(1, 2, lastRow, 1).getBackgrounds();
  var rowOf = {}, maxNum = 0, firstFree = 0, footer = 0, r;
  for (r = 3; r <= lastRow; r++) {
    var a = A[r - 1][0], b = String(A[r - 1][1]).trim();
    if (b && a !== '' && !isNaN(Number(a))) {
      maxNum = Math.max(maxNum, Number(a));
      if (!isRed_(bg[r - 1][0])) rowOf[nameKey2_(b)] = r;
    } else if (!b && a === '' && r === lastRow && lastRow > 3) {
      footer = r;
    } else if (!b && !firstFree) {
      firstFree = r;
    }
  }
  var vals = playedCol || paidCol ? sh.getRange(1, 1, lastRow, Math.max(playedCol, paidCol, 1)).getValues() : [];
  var cellVal = function (row, col) { return vals.length && col ? vals[row - 1][col - 1] : ''; };
  var bgP = colBg_(sh, playedCol, lastRow), bgQ = colBg_(sh, paidCol, lastRow);
  var sets = [], seen = {}, added = 0, skippedNum = 0;
  recs.forEach(function (rec) {
    var key = nameKey2_(rec.name), row = rowOf[key];
    if (!row) {
      if (rec.played !== true && rec.paid === null) return;
      var nr = firstFree && firstFree < (footer || lastRow + 1) ? firstFree : 0;
      if (live) {
        if (!nr) {
          if (footer) { sh.insertRowBefore(footer); nr = footer; footer++; } else { nr = lastRow + 1; }
          lastRow = Math.max(lastRow, nr);
        }
        sh.getRange(nr, 1, 1, 2).setValues([[maxNum + 1, rec.name]]);
        if (nr === firstFree) firstFree = 0;
      }
      maxNum++; added++;
      row = nr || -1;
      rowOf[key] = row;
    }
    seen[row] = true;
    if (row < 0) return;
    if (playedCol && rec.played !== null && !redCell_(bgP, row)) sets.push([row, playedCol, rec.played]);
    if (paidCol && rec.paid !== null && !redCell_(bgQ, row)) sets.push([row, paidCol, rec.paid]);
  });
  // Остальным игрокам листа в колонке «Played» ставим FALSE, если ячейка пуста.
  if (playedCol && recs.length) {
    Object.keys(rowOf).forEach(function (k) {
      var row = rowOf[k];
      if (row > 0 && roster[k] && !seen[row] && cellVal(row, playedCol) === '' && !redCell_(bgP, row)) sets.push([row, playedCol, false]);
    });
  }
  var wrote = 0;
  var lock = null; // блокировка берётся снаружи, в legacySync_
  try {
    var todo = [];
    sets.forEach(function (s) {
      var cur = cellVal(s[0], s[1]);
      if (typeof cur === 'number') { skippedNum++; return; }
      if (cur === s[2]) return;
      wrote++;
      todo.push(s);
    });
    if (live && todo.length) legacyWriteSets_(sh, todo);
    // Заметка к дате игры: соперник, счёт, голы.
    if (live && playedCol && needPlayed) {
      var gf = ev.gf, ga = ev.ga, top = [];
        if (gf !== '' && ga !== '' && gf !== null && ga !== null && !isNaN(Number(gf)) && !isNaN(Number(ga))) {
        var lose = Number(gf) < Number(ga);
        sh.getRange(1, playedCol)
          .setBackground(Number(gf) > Number(ga) ? '#00ff00' : (lose ? '#ff0000' : '#ffff00'))
          .setFontColor(lose ? '#ffffff' : '#000000');
      }
      if (ev.opp) top.push('Соперник: ' + ev.opp + '.');
      if (hasScore) top.push('Счёт: ' + scoreTxt + '.');
      var gl = recs.filter(function (x) { return x.goals > 0; }).map(function (x) { return x.name + (x.goals > 1 ? ' ' + x.goals : ''); });
      if (gl.length && hasScore) top.push('Голы: ' + gl.join(', ') + '.');
      // Без счёта текст приложения не пишем: прежнее [Приложение] очищается, своё примечание сохраняется
      var cell = sh.getRange(1, playedCol), old = String(cell.getNote() || '');
      var keep = old.indexOf('[Приложение]') >= 0 ? old.slice(0, old.indexOf('[Приложение]')).trim() : old.trim();
      cell.setNote((keep ? keep + '\n' : '') + (hasScore && top.length ? '[Приложение] ' + top.join(' ') : ''));
    }
    if (live) { SpreadsheetApp.flush(); logChange_('', '', 'старый файл: ' + sh.getName() + ' ' + ev.name, '', 'ячеек ' + wrote + ', новых игроков ' + added); }
  } finally {
    if (lock) lock.releaseLock();
  }
  var msg = (live ? 'В старый файл записано' : 'Пробный план для старого файла') + ': лист «' + sh.getName() + '», изменено ячеек ' + wrote
    + (added ? ', новых игроков ' + added : '') + (notes.length ? ', ' + notes.join(', ') : '')
    + (skippedNum ? '; пропущено ячеек с числами: ' + skippedNum : '') + (found ? '' : '; колонка создана заново') + '.';
  return msg;
}

// Однократно: указывает, на какой лист писать чемпионатные игры команды.
function legacySetTabs() {
  PropertiesService.getScriptProperties().setProperty('LEGACY_TABS', JSON.stringify({
    'U9': 'U9 Champ 2', 'U9-A': 'U9 Champ 2', 'U9-B': 'U9 Champ 2'
  }));
}

// ---------- Листы с несколькими блоками (например, U9-A и U9-B на одном листе) ----------

// Находит блоки: строка, где в колонке B стоит название команды (U9-A), а ниже «ФИ ребенка».
function legacyBlocks_(sh) {
  var n = sh.getLastRow(), out = [];
  if (n < 3) return out;
  var B = sh.getRange(1, 2, n, 1).getDisplayValues(), A = sh.getRange(1, 1, n, 1).getValues();
  for (var r = 1; r < n; r++) {
    if (/^U\d+\s*-\s*[A-Za-z0-9]+$/i.test(String(B[r - 1][0]).trim()) && /ФИ/i.test(String(B[r][0]))) out.push({ name: String(B[r - 1][0]).trim(), head: r });
  }
  out.forEach(function (b, i) {
    b.from = b.head + 2;
    b.to = i + 1 < out.length ? out[i + 1].head - 1 : n;
    while (b.to > b.from && !String(A[b.to - 1][0]).trim() && !String(B[b.to - 1][0]).trim()) b.to--;
  });
  return out;
}

function legacyBlockMap_(sh, b) {
  var out = { rows: {}, free: [], maxNum: 0 }, cnt = b.to - b.from + 1;
  if (cnt < 1) return out;
  var v = sh.getRange(b.from, 1, cnt, 2).getValues(), bg = sh.getRange(b.from, 2, cnt, 1).getBackgrounds();
  v.forEach(function (x, i) {
    var row = b.from + i, a = x[0], nm = String(x[1]).trim();
    if (a !== '' && !isNaN(Number(a))) out.maxNum = Math.max(out.maxNum, Number(a));
    if (nm) { if (!isRed_(bg[i][0])) out.rows[nameKey2_(nm)] = row; } else out.free.push(row);
  });
  return out;
}

function legacyBlockSync_(sh, blks, ev, parent, recs, roster, dryOnly, pAll) {
  var live = !dryOnly, tz = sheetOf_('МАТЧИ').getParent().getSpreadsheetTimeZone();
  var lbl = function (x) { return String(x || '').toLowerCase().replace(/\s+/g, ''); };
  var champName = parent ? parent.name : ev.name;
  var undated = ev.type === 'Чемпионат' || ev.type === 'Фестиваль' || ev.type === 'Турнир';
  var needPlayed = ev.type === 'Игра' || ev.type === 'Товарищеская';
  if (!undated && !needPlayed) throw new Error('для листа с блоками этот тип события пока не поддерживается');
  var dtxt = ev.date ? Utilities.formatDate(ev.date, tz, 'dd.MM') : '';
  var maps = blks.map(function (b) { return legacyBlockMap_(sh, b); });
  // Игрок попадает в блок своей команды (колонка «команда» в составе); без команды — туда, где он уже есть.
  var byBlock = blks.map(function () { return []; });
  recs.forEach(function (rec) {
    var idx = -1;
    blks.forEach(function (b, i) { if (idx < 0 && lbl(b.name) === lbl(rec.team)) idx = i; });
    if (idx < 0) maps.forEach(function (m, i) { if (idx < 0 && m.rows[nameKey2_(rec.name)]) idx = i; });
    if (idx < 0) { if (!rec.team && rec.played !== true) return; idx = 0; }
    byBlock[idx].push(rec);
  });
  var msgs = [], wroteAll = 0, addedAll = 0;
  for (var bi = blks.length - 1; bi >= 0; bi--) {
    var b = blks[bi], rr = byBlock[bi];
    if (!rr.length) continue;
    var mp = legacyBlockMap_(sh, b), maxC = sh.getMaxColumns(), c;
    var hd = sh.getRange(b.head, 1, 2, maxC).getDisplayValues(), head = hd[0], lab = hd[1];
    var paidCol = 0, playedCol = 0, newCol = false;
    for (c = 3; c <= maxC; c++) if (lbl(head[c - 1]) === lbl(champName)) { paidCol = c; break; }
    if (undated && !paidCol) { msgs.push(b.name + ': нет колонки «' + champName + '»'); continue; }
    if (needPlayed) {
      var start = paidCol ? paidCol + 1 : 3;
      for (c = start; c <= maxC; c++) if (head[c - 1] === dtxt) { playedCol = c; break; }
      if (!playedCol) for (c = start; c <= maxC; c++) if (!head[c - 1] && !/paid/i.test(lab[c - 1])) { playedCol = c; break; }
      if (!playedCol) { playedCol = maxC + 1; newCol = true; if (live) sh.insertColumnAfter(maxC); }
    }
    var valCol = needPlayed ? playedCol : paidCol, added = 0, wrote = 0, sets = [], seen = {};
    // Колонку блока читаем один раз (значения и цвета), а не по ячейке
    var snap = {};
    var snapOf = function (col) {
      if (col > sh.getMaxColumns()) return null;
      if (!snap[col]) {
        var cnt = b.to - b.from + 1;
        snap[col] = cnt > 0
          ? { v: sh.getRange(b.from, col, cnt, 1).getValues(), g: sh.getRange(b.from, col, cnt, 1).getBackgrounds() }
          : { v: [], g: [] };
      }
      return snap[col];
    };
    var curOf = function (row, col) {
      var s = snapOf(col);
      return s && row >= b.from && row - b.from < s.v.length ? s.v[row - b.from][0] : '';
    };
    var redAt = function (row, col) {
      var s = snapOf(col);
      return !!s && row >= b.from && row - b.from < s.g.length && isRed_(s.g[row - b.from][0]);
    };
    rr.forEach(function (rec) {
      var key = nameKey2_(rec.name), row = mp.rows[key];
      if (!row) {
        if (rec.played !== true && rec.paid === null) return;
        if (mp.free.length) row = mp.free.shift();
        else if (live) {
          sh.insertRowAfter(b.to + added);
          row = b.to + added + 1;
          try { sh.getRange(row - 1, 1, 1, maxC).copyTo(sh.getRange(row, 1, 1, maxC), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false); } catch (e) {}
        } else row = -1;
        if (row > b.to + added) added++;
        mp.maxNum++;
        if (live && row > 0) {
          sh.getRange(row, 2).setValue(rec.name);
          if (String(sh.getRange(row, 1).getValue()) === '') sh.getRange(row, 1).setValue(mp.maxNum);
        }
        addedAll++;
        mp.rows[key] = row;
      }
      seen[row] = true;
      if (row < 0) return;
      if (needPlayed && rec.played !== null) sets.push([row, playedCol, rec.played]);
      if (undated && rec.paid !== null) sets.push([row, paidCol, rec.paid]);
    });
        if (needPlayed && paidCol && parent) {
      var pp = {};
      pAll.forEach(function (r) { if (String(r[0]) === parent.id && r[1] && finPaid_(parent.id, String(r[1])) === true) pp[nameKey2_(String(r[2]))] = true; });
      rr.forEach(function (rec) {
        var k2 = nameKey2_(rec.name), rw = mp.rows[k2];
        if (rw && pp[k2]) sets.push([rw, paidCol, true]);
      });
    }
    if (needPlayed) Object.keys(mp.rows).forEach(function (k) {
      var row = mp.rows[k];
      if (row > 0 && roster[k] && !seen[row] && !newCol && curOf(row, playedCol) === '' && !redAt(row, playedCol)) sets.push([row, playedCol, false]);
    });
    var todo = [];
    sets.forEach(function (s) {
      if (!newCol && redAt(s[0], s[1])) return;
      var cur = newCol ? '' : curOf(s[0], s[1]);
      if (typeof cur === 'number' || cur === s[2]) return;
      wrote++;
      todo.push(s);
    });
    if (live && todo.length) legacyWriteSets_(sh, todo);
    if (live && needPlayed) {
      if (newCol) {
        try { sh.getRange(b.head, playedCol - 1, b.to + added - b.head + 1, 1).copyTo(sh.getRange(b.head, playedCol, b.to + added - b.head + 1, 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false); } catch (e) {}
      }
      sh.getRange(b.head, playedCol).setValue(ev.date).setNumberFormat('dd.MM');
      if (!String(sh.getRange(b.head + 1, playedCol).getValue())) sh.getRange(b.head + 1, playedCol).setValue('Played');
      var gf = ev.gf, ga = ev.ga, opp = ev.opp, other = '';
      blks.forEach(function (x) { if (lbl(x.name) !== lbl(b.name)) other = x.name; });
      if (opp && lbl(opp) === lbl(b.name)) { var t = gf; gf = ga; ga = t; opp = other || opp; }
      var okS = gf !== '' && ga !== '' && gf !== null && ga !== null && !isNaN(Number(gf)) && !isNaN(Number(ga));
      var top = [];
      var gl = rr.filter(function (x) { return x.goals > 0; }).map(function (x) { return x.name + (x.goals > 1 ? ' ' + x.goals : ''); });
      if (okS) {
        if (opp) top.push('Соперник: ' + opp + '.');
        top.push('Счёт: ' + gf + ':' + ga + '.');
        if (gl.length) top.push('Голы: ' + gl.join(', ') + '.');
      }
      var cell = sh.getRange(b.head, playedCol);
      var old = String(cell.getNote() || '');
      var keep = old.indexOf('[Приложение]') >= 0 ? old.slice(0, old.indexOf('[Приложение]')).trim() : old.trim();
      cell.setNote((keep ? keep + '\n' : '') + (top.length ? '[Приложение] ' + top.join(' ') : ''));
      if (okS) {
        var lose = Number(gf) < Number(ga);
        cell.setBackground(Number(gf) > Number(ga) ? '#00ff00' : (lose ? '#ff0000' : '#ffff00')).setFontColor(lose ? '#ffffff' : '#000000');
      }
    }
    wroteAll += wrote;
    msgs.push(b.name + ': ' + (needPlayed ? 'колонка ' + (newCol ? 'новая' : (head[playedCol - 1] === dtxt ? 'есть' : 'свободная')) + ' №' + playedCol + ', ' : '') + 'ячеек ' + wrote + (added ? ', новых строк ' + added : ''));
  }
  if (live) { SpreadsheetApp.flush(); logChange_('', '', 'старый файл: ' + sh.getName() + ' ' + ev.name, '', 'блоки; ячеек ' + wroteAll + ', новых игроков ' + addedAll); }
  return (live ? 'В старый файл записано' : 'Пробный план для старого файла') + ': лист «' + sh.getName() + '» (блоки), ' + msgs.join('; ') + (addedAll ? '; новых игроков ' + addedAll : '') + '.';
}

// Подтягивает оплату взноса из старого файла для только что добавленных в состав игроков.
// TRUE хотя бы на одном листе команды в колонке этого турнира = оплачено. Уже оплаченное не трогает.
function legacyPullPaid_(eventId, names) {
  if (CONFIG.DRY_RUN || !names || !names.length) return 0;
  var ev = sheetOf_('МАТЧИ').getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]) === String(eventId); })[0];
  if (!ev || ['Чемпионат', 'Фестиваль', 'Турнир'].indexOf(String(ev[2])) < 0) return 0;
  var team = String(ev[1]), tname = String(ev[3]), fee = feeOf_(String(eventId));
  var base = team.replace(/\s*-\s*[A-Za-z0-9]+$/, '').toLowerCase();
  var lbl = function (x) { return String(x || '').toLowerCase().replace(/\s+/g, ''); };
  var paid = {};
  gamesFile_().getSheets().forEach(function (sh) {
    if (sh.getName().toLowerCase().indexOf(base) !== 0) return;
    var v = sh.getDataRange().getValues();
    for (var r = 0; r < v.length - 2; r++) {
      for (var c = 2; c < v[r].length; c++) {
        if (lbl(v[r][c]) !== lbl(tname) || !/^paid$/i.test(String(v[r + 1][c]).trim())) continue;
        for (var rr = r + 2; rr < v.length; rr++) {
          var nm = String(v[rr][1]).trim(), val = v[rr][c];
          if (!nm || (val !== true && val !== false)) continue;
          var k = nameKey2_(nm);
          paid[k] = paid[k] === true || val === true;
        }
      }
    }
  });
  var want = {};
  names.forEach(function (n) { want[nameKey2_(n)] = true; });
  var ps = partsSheet_(), pv = ps.getDataRange().getValues(), n = 0;
  pv.forEach(function (r, i) {
    if (!i || String(r[0]) !== String(eventId)) return;
    var k = nameKey2_(String(r[2]));
    if (want[k] && paid[k] === true && finPaid_(String(eventId), String(r[1])) !== true) {
      finUpsert_(String(eventId), String(r[1]), String(r[2]), { paid: true, sum: fee, method: '', date: '', comment: 'из старого файла' });
      n++;
    }
  });
  if (n) {
  logChange_('', '', 'оплата подтянута из старого файла', '', String(eventId) + ': ' + n);
  try { if (legacyEnabled_()) legacySync_(eventId, false); } catch (e) {}
  }
  return n;
}

// Запуск подтягивания оплат для всех фестивалей.
function runFestPull() {
  if (CONFIG.DRY_RUN) return 'DRY_RUN включён: ничего не записано';
  var evs = sheetOf_('МАТЧИ').getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] && String(r[2]) === 'Фестиваль'; });
  var ps = partsSheet_().getDataRange().getValues().slice(1), total = 0;
  evs.forEach(function (r) {
    var id = String(r[0]);
    var names = ps.filter(function (p) { return String(p[0]) === id && p[2]; })
      .map(function (p) { return String(p[2]); });
    if (names.length) total += legacyPullPaid_(id, names);
  });
  return 'подтянуто оплат: ' + total;
}

// Подтягивание оплат для всех чемпионатов.
function runChampPull() {
  if (CONFIG.DRY_RUN) return 'DRY_RUN включён: ничего не записано';
  var evs = sheetOf_('МАТЧИ').getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] && String(r[2]) === 'Чемпионат'; });
  var ps = partsSheet_().getDataRange().getValues().slice(1), total = 0;
  evs.forEach(function (r) {
    var id = String(r[0]);
    var names = ps.filter(function (p) { return String(p[0]) === id && p[2]; })
      .map(function (p) { return String(p[2]); });
    if (names.length) total += legacyPullPaid_(id, names);
  });
  return 'подтянуто оплат: ' + total;
}

// Подтягивает оплату товарищеской игры: колонка «Paid» справа от даты на листе «<команда> Friendly».
function legacyPullFriendlyPaid_(eventId, names) {
  if (CONFIG.DRY_RUN || !names || !names.length) return 0;
  var msh = sheetOf_('МАТЧИ');
  var ev = msh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]) === String(eventId); })[0];
  if (!ev || String(ev[2]) !== 'Товарищеская' || !(ev[4] instanceof Date)) return 0;
  var dtxt = Utilities.formatDate(ev[4], msh.getParent().getSpreadsheetTimeZone(), 'dd.MM');
  var base = String(ev[1]).replace(/\s*-\s*[A-Za-z0-9]+$/, '').toLowerCase();
  var paid = {};
  gamesFile_().getSheets().forEach(function (sh) {
    var nm = sh.getName().toLowerCase();
    if (nm.indexOf(base) !== 0 || !/friendly\s*$/.test(nm)) return;
    var d = sh.getDataRange().getDisplayValues(), v = sh.getDataRange().getValues(), pc = -1;
    for (var c = 0; c < d[0].length - 1; c++) {
      if (String(d[0][c]).trim() === dtxt && String(d[1][c + 1]).trim().toLowerCase() === 'paid') { pc = c + 1; break; }
    }
    if (pc < 0) return;
    for (var r = 2; r < v.length; r++) {
      var p = String(v[r][1]).trim(), val = v[r][pc];
      if (!p || (val !== true && val !== false)) continue;
      var k = nameKey2_(p);
      paid[k] = paid[k] === true || val === true;
    }
  });
  var want = {};
  names.forEach(function (n) { want[nameKey2_(n)] = true; });
  var fee = feeOf_(String(eventId)), n = 0;
  partsSheet_().getDataRange().getValues().forEach(function (r, i) {
    if (!i || String(r[0]) !== String(eventId)) return;
    var k = nameKey2_(String(r[2]));
    if (want[k] && paid[k] === true && finPaid_(String(eventId), String(r[1])) !== true) {
      finUpsert_(String(eventId), String(r[1]), String(r[2]), { paid: true, sum: fee, method: '', date: '', comment: 'из старого файла' });
      n++;
    }
  });
  if (n) logChange_('', '', 'оплата подтянута из старого файла', '', String(eventId) + ': ' + n);
  return n;
}

// Запуск для всех товарищеских игр.
function runFriendlyPull() {
  if (CONFIG.DRY_RUN) return 'DRY_RUN включён: ничего не записано';
  var evs = sheetOf_('МАТЧИ').getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] && String(r[2]) === 'Товарищеская'; });
  var ps = partsSheet_().getDataRange().getValues().slice(1), total = 0;
  evs.forEach(function (r) {
    var id = String(r[0]);
    var names = ps.filter(function (p) { return String(p[0]) === id && p[2]; })
      .map(function (p) { return String(p[2]); });
    if (names.length) total += legacyPullFriendlyPaid_(id, names);
  });
  return 'подтянуто оплат: ' + total;
}