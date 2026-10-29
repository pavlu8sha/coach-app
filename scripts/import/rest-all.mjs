// Чтение всех строк выборки постранично. Сервер отдаёт не больше 1000 строк за запрос (limit больше 1000 молча обрезается),
// поэтому выборки без страниц теряют хвост: «уже существующие» платежи и матчи выглядят новыми и пишутся повторно.
// rest — функция скрипта (method, path) → JSON; order нужен, чтобы страницы не пересекались и не пропускали строки.
export const PAGE = 1000;

export async function getAll(rest, path, order = 'id', page = PAGE) {
  const out = [];
  for (let off = 0; ; off += page) {
    const rows = await rest('GET', `${path}${path.includes('?') ? '&' : '?'}order=${order}&limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) return out;
  }
}
