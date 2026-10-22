/**
 * Замеры времени серверных операций при обычном открытии страниц (этап производительности 1).
 * Пишет в журнал выполнения (console.log) одну строку на запрос: название операции, длительность частей
 * и попадание в кэш (hit / miss по названию ключа). Никаких данных: ни ФИ, ни ID, ни сумм, ни PIN.
 * Не читает таблицы и не трогает кэш сам — только засекает время вокруг уже существующих вызовов.
 * Выключить: PERF_LOG = false.
 */
var PERF_LOG = false; // по умолчанию выключено: включается вручную на время замеров
var _perf = null;   // текущий запрос: { op, t0, parts[], cache{} }

// Обернуть операцию. Верхний уровень открывает запись и печатает её в конце; вложенный — добавляет часть «метка N мс».
function perfSpan_(label, fn) {
  if (!PERF_LOG) return fn();
  var top = !_perf, t = Date.now();
  if (top) _perf = { op: label, t0: t, parts: [], cache: {} };
  try {
    return fn();
  } finally {
    if (top) perfFlush_();
    else _perf.parts.push(label + ' ' + (Date.now() - t));
  }
}

// Часть замера только внутри уже идущего запроса (вне запроса — просто выполняет fn, ничего не пишет)
function perfPart_(label, fn) { return _perf ? perfSpan_(label, fn) : fn(); }

// Отметка попадания в кэш (вызывается из cacheGetBig_). Ключ без месяца/номера части: 'cola_10.26' → 'cola'.
function perfCache_(key, hit) {
  if (!_perf) return;
  var k = String(key).replace(/_[\d.]+$/, '') + (hit ? ' hit' : ' miss');
  _perf.cache[k] = (_perf.cache[k] || 0) + 1;
}

function perfFlush_() {
  var p = _perf;
  _perf = null;
  if (!p) return;
  var c = Object.keys(p.cache).map(function (k) { return k + (p.cache[k] > 1 ? ' ×' + p.cache[k] : ''); });
  try {
    console.log('[perf] ' + p.op + ' | всего ' + (Date.now() - p.t0) + ' мс' + (p.parts.length ? ' | ' + p.parts.join(', ') : '') + (c.length ? ' | кэш: ' + c.join(', ') : ''));
  } catch (e) {}
}
