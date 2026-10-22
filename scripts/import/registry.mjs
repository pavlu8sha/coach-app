// Разбор CSV реестра игроков (лист «РЕЕСТР ИГРОКОВ», строки с 4-й) в группы и игроков для базы.
// Колонки листа: A ID, B ФИ, C Группа, D Локация, E Статус, F Начало, G Конец, H Доп. программы.
// Без зависимостей: CSV с кавычками разбираем сами.

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* пропускаем */ }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Дата dd.mm.yyyy или yyyy-mm-dd → yyyy-mm-dd; пусто → null; иное — ошибка (не тихо).
export function isoDate(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  // Серийный номер Google Sheets (дни от 1899-12-30), если ячейка без формата даты
  if (/^\d{5}$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  throw new Error('Дата не распознана: ' + t);
}

export function parseRegistry(text) {
  const rows = parseCsv(text).slice(3); // первые три строки — шапка листа
  const groups = new Map(); // имя группы → { name, location }
  const players = [];
  const problems = [];
  rows.forEach((r, i) => {
    const id = (r[0] || '').trim();
    const name = (r[1] || '').trim();
    if (!id && !name) return;
    const line = i + 4;
    if (!id) { problems.push({ line, error: 'нет ID игрока', name }); return; }
    if (!name) { problems.push({ line, error: 'нет ФИ', id }); return; }
    const group = (r[2] || '').trim();
    const location = (r[3] || '').trim();
    if (group && !groups.has(group)) groups.set(group, { name: group, location: location || null });
    try {
      players.push({
        external_id: id,
        full_name: name,
        group_name: group || null,
        status: (r[4] || '').trim() === 'Активен' ? 'active' : 'inactive',
        starts_on: isoDate(r[5]),
        ends_on: isoDate(r[6]),
        extras: (r[7] || '').split(',').map(x => x.trim()).filter(Boolean),
      });
    } catch (e) {
      problems.push({ line, error: e.message, id });
    }
  });
  return { groups: [...groups.values()], players, problems };
}
