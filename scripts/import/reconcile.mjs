// Сверка: таблица против базы по ключевым числам. Возвращает список расхождений (пусто — всё сошлось).
export function reconcile(checks) {
  // checks: [{ name, sheet, db }] — числа из таблицы и из базы
  return checks.filter(c => c.sheet !== c.db).map(c => ({ name: c.name, sheet: c.sheet, db: c.db, diff: c.db - c.sheet }));
}

// Сумма по колонке с числами в тексте вида «165,00 ₾»
export function sumMoney(values) {
  return values.reduce((a, v) => {
    const n = Number(String(v || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
    return a + (Number.isFinite(n) ? n : 0);
  }, 0);
}
