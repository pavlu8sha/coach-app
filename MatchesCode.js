/** Раздел «Матчи» (версия 2): чтение, отметка «играл», приём взносов. Только для администратора. */

function partsSheet_() {
  var sh = sheetOf_('УЧАСТИЕ');
  if (!sh) throw new Error('Нет листа УЧАСТИЕ: сначала выполните перенос файла матчей');
  return sh;
}

function appMatchFee(pin, eventId, playerId, amount, method, dateStr, comment) {
  checkAdmin_(pin);
  if (PAY_METHODS.indexOf(method) < 0) throw new Error('Выберите способ оплаты: наличные или перевод');
  amount = Math.round(Number(amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Введите сумму больше нуля');
  var res;
  if (CONFIG.DRY_RUN) {
    res = matchFeeCore_(eventId, playerId, amount, method, dateStr, comment);
  } else {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      res = matchFeeCore_(eventId, playerId, amount, method, dateStr, comment);
    } finally {
      lock.releaseLock();
    }
  }
  var lg = CONFIG.DRY_RUN ? '' : gnSyncGameSafe_(eventId);
  return { ok: true, dryRun: CONFIG.DRY_RUN, full: res.full, legacy: lg };
}

/** Массовая оплата взносов: items = [{p: id игрока, amount, method, date}]. Каждый платёж проходит те же проверки,
 *  что и одиночный (appMatchFee). Ошибка у одного игрока не отменяет остальных: возвращается результат по каждому. */
function appMatchFeeBulk(pin, eventId, items) {
  checkAdmin_(pin);
  if (!Array.isArray(items) || !items.length) throw new Error('Выберите хотя бы одного игрока');
  if (items.length > 60) throw new Error('За один раз можно внести не более 60 взносов');
  var seen = {};
  items.forEach(function (it) {
    var id = String(it && it.p || '');
    if (!id) throw new Error('Не указан игрок');
    if (seen[id]) throw new Error('Игрок указан дважды');
    seen[id] = true;
    if (PAY_METHODS.indexOf(it.method) < 0) throw new Error('Выберите способ оплаты у каждого игрока');
    var a = Math.round(Number(it.amount) * 100) / 100;
    if (!(a > 0)) throw new Error('Введите сумму больше нуля у каждого игрока');
  });
  var results = [];
  function runAll() {
    items.forEach(function (it) {
      var pid = String(it.p), amt = Math.round(Number(it.amount) * 100) / 100;
      try {
        var r = matchFeeCore_(eventId, pid, amt, it.method, it.date, '');
        results.push({ p: pid, ok: true, full: r.full });
      } catch (e) {
        results.push({ p: pid, ok: false, error: e && e.message ? e.message : String(e) });
      }
    });
  }
  if (CONFIG.DRY_RUN) {
    runAll();
  } else {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { runAll(); } finally { lock.releaseLock(); }
  }
  var done = results.filter(function (r) { return r.ok; }).length;
  var lg = CONFIG.DRY_RUN || !done ? '' : gnSyncGameSafe_(eventId);
  return { ok: true, dryRun: CONFIG.DRY_RUN, results: results, done: done, failed: results.length - done, legacy: lg };
}

function matchFeeCore_(eventId, playerId, amount, method, dateStr, comment) {
  var ms = sheetOf_('МАТЧИ'), ps = partsSheet_();
  if (!ms || ms.getLastRow() < 2) throw new Error('Нет листа МАТЧИ: сначала выполните перенос файла матчей');
  var evRows = ms.getRange(2, 1, ms.getLastRow() - 1, 7).getValues();
  var ev = evRows.filter(function (r) { return String(r[0]) === eventId; })[0];
  if (!ev) throw new Error('Событие не найдено');
  // Игры турнира: у них в колонке «Родитель» стоит id турнира
  var kids = {};
  evRows.forEach(function (r) { if (String(r[6]) === eventId) kids[String(r[0])] = true; });
  if (ps.getLastRow() < 2) throw new Error('Игрока нет в составе этого события');
  var rec = null, played = false;
  ps.getRange(2, 1, ps.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (String(r[1]) !== playerId) return;
    if (String(r[0]) === eventId) rec = r;
    if ((String(r[0]) === eventId || kids[String(r[0])]) && r[3] === true) played = true;
  });
  if (!rec) throw new Error('Игрока нет в составе этого события');
  if (!played) throw new Error('Игрок не отмечен как сыгравший ни в одной игре турнира: взнос не принимается');
  var fee = feeOf_(eventId), cur = finMap_().pays[eventId + '|' + playerId] || { paid: false, sum: 0 };
  var sum = Math.round((cur.sum || 0) * 100) / 100;
  if (cur.paid && !sum) throw new Error('Взнос уже отмечен как оплаченный');
  var newSum = Math.round((sum + amount) * 100) / 100, full = fee > 0 ? newSum >= fee : true;
  if (!CONFIG.DRY_RUN) {
    // Повтор той же оплаты за 15 секунд (двойное нажатие, повторная отправка) не записываем: тот же приём, что у абонемента
    if (isRecentDup_(dbRead_('ЖУРНАЛ ИЗМЕНЕНИЙ'), [[2, playerId], [4, 'взнос: ' + ev[1] + ', ' + ev[3]], [6, amount + ' ₾, ' + method]], 15))
      throw new Error('Похоже на повтор: такой взнос только что записан. Обновите страницу');
    finUpsert_(eventId, playerId, String(rec[2]), { paid: full, sum: newSum, method: method, date: dateStr || today_(), comment: comment || '' });
    logChange_(playerId, String(rec[2]), 'взнос: ' + ev[1] + ', ' + ev[3], '', amount + ' ₾, ' + method);
  }
  return { full: full };
}

function appMatchDiscount(pin, eventId, playerId, comment) {
  checkAdmin_(pin);
  var res;
  if (CONFIG.DRY_RUN) {
    res = matchDiscountCore_(eventId, playerId, comment);
  } else {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      res = matchDiscountCore_(eventId, playerId, comment);
    } finally {
      lock.releaseLock();
    }
  }
  var lg = CONFIG.DRY_RUN ? '' : gnSyncGameSafe_(eventId);
  return { ok: true, dryRun: CONFIG.DRY_RUN, legacy: lg };
}

function matchDiscountCore_(eventId, playerId, comment) {
  var ms = sheetOf_('МАТЧИ'), ps = partsSheet_();
  if (!ms || ms.getLastRow() < 2) throw new Error('Нет листа МАТЧИ: сначала выполните перенос файла матчей');
  var evRows = ms.getRange(2, 1, ms.getLastRow() - 1, 7).getValues();
  var ev = evRows.filter(function (r) { return String(r[0]) === eventId; })[0];
  if (!ev) throw new Error('Событие не найдено');
  var kids = {};
  evRows.forEach(function (r) { if (String(r[6]) === eventId) kids[String(r[0])] = true; });
  if (ps.getLastRow() < 2) throw new Error('Игрока нет в составе этого события');
  var rec = null, played = false;
  ps.getRange(2, 1, ps.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (String(r[1]) !== playerId) return;
    if (String(r[0]) === eventId) rec = r;
    if ((String(r[0]) === eventId || kids[String(r[0])]) && r[3] === true) played = true;
  });
  if (!rec) throw new Error('Игрока нет в составе этого события');
  if (!played) throw new Error('Игрок не отмечен как сыгравший ни в одной игре турнира');
  var cur = finMap_().pays[eventId + '|' + playerId] || { paid: false, sum: 0 };
  if (cur.paid) throw new Error('Взнос уже отмечен как оплаченный');
  if (!CONFIG.DRY_RUN) {
    finUpsert_(eventId, playerId, String(rec[2]), { paid: true, sum: cur.sum || 0, method: '', date: today_(), comment: 'скидка' + (comment ? ': ' + comment : '') });
    logChange_(playerId, String(rec[2]), 'взнос засчитан без оплаты: ' + ev[1] + ', ' + ev[3], '', comment || '');
  }
  return { ok: true };
}