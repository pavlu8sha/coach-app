// Разбор экипировки (лист «СЕЗОН» и «КАТАЛОГ ЭКИПИРОВКИ» из выгрузки EQUIP_ID). Чистая функция, без сети.
import { parseCsv } from './registry.mjs';
import { parseAmount } from './payments.mjs';

// Опечатки и наборы: полный набор — отдельная цена (скидка), остальное — позиции каталога.
const FULL_SET_ITEMS = 'Дождевик + Тренировочная форма + Спортивный костюм + Игровая форма';
export const KIT_ALIAS = { 'Полный комлпект': FULL_SET_ITEMS, 'Полный комплект': FULL_SET_ITEMS };
export const FULL_SET_PRICE = 525; // сумма полного набора из листа, как в заказах 32, 36, 37, 44, 57, 94

// «Тренировочная форма» … каталог → [{kit, price}]
export function parseCatalog(text) {
  const rows = parseCsv(text).slice(1);
  return rows.filter(r => (r[0] || '').trim()).map(r => ({ kit: r[0].trim(), price: parseAmount(r[1]) }));
}

// «дд.мм.гггг» → 'гггг-мм-дд'; пусто → null (дата в выгрузке не у всех заказов)
export function isoOrNull(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new Error('Дата не распознана: ' + t);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Заказы: строки до второго заголовка «№» (дальше — блок себестоимости, его не трогаем)
export function parseSeason(text, catalogKits) {
  const rows = parseCsv(text);
  const head = rows.findIndex(r => (r[0] || '').trim() === '№');
  if (head < 0) throw new Error('Не найден заголовок заказов');
  const second = rows.findIndex((r, i) => i > head && (r[0] || '').trim() === '№');
  const end = second < 0 ? rows.length : second;
  const H = rows[head].map(h => h.trim());
  const col = name => H.indexOf(name);
  const c = {
    date: col('Дата заказа'), name: col('ФИ ребёнка'), kit: col('Комплект'), size: col('Размер'),
    insc: col('Надпись'), num: col('Номер'), inst: col('Рассрочка'), total: col('Сумма заказа'),
    paid: col('Оплачено'), pid: col('ID игрока'), loc: col('Локация'), oid: col('ID заказа'), qty: col('Кол-во'),
  };
  const orders = [];
  const problems = [];
  for (let i = head + 1; i < end; i++) {
    // запятая в «Размере» без кавычек даёт лишнее поле: склеиваем его обратно в размер
    let r = rows[i];
    const extra = r.length - H.length;
    if (extra > 0) r = [...r.slice(0, c.size), r.slice(c.size, c.size + extra + 1).join(','), ...r.slice(c.size + extra + 1)];
    const no = (r[0] || '').trim();
    if (!/^\d+$/.test(no)) continue;
    const get = k => (r[c[k]] ?? '').trim();
    try {
      const kitText = KIT_ALIAS[get('kit')] ?? get('kit');
      const parts = kitText.split('+').map(p => p.trim()).filter(Boolean);
      const qtyParts = get('qty') ? get('qty').split('+').map(q => Number(q.trim())) : [];
      if (qtyParts.length && qtyParts.length !== parts.length) throw new Error('Кол-во не совпадает с комплектом');
      const lines = parts.map((kit, k) => {
        if (!catalogKits.has(kit)) throw new Error('Нет в каталоге: ' + kit);
        return { kit, size: get('size') || null, quantity: qtyParts[k] || 1, unit_price: catalogKits.get(kit) };
      });
      orders.push({
        ext_id: get('oid'), player_ext: get('pid'), ordered_on: isoOrNull(get('date')),
        inscription: get('insc') || null, number: get('num') || null,
        installment: get('inst').toLowerCase() === 'да', total: parseAmount(get('total')),
        paid: parseAmount(get('paid')), location: get('loc') || null, lines,
        line_sum: lines.reduce((a, l) => a + l.unit_price * l.quantity, 0),
        src_row: i + 1, kit_text: get('kit'),
      });
    } catch (e) {
      problems.push({ line: i + 1, id: get('oid'), error: e.message });
    }
  }
  return { orders, problems };
}
