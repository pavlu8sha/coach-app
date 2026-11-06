// Что можно восстановить после перезагрузки. Правило: только то, что безопасно повторно показать без новых проверок.
// Открытые записи с данными (карточка, заказ, сбор, редактор, форма) не восстанавливаются: человек возвращается в список
// с теми же фильтрами и прокруткой, а право на запись и свежесть данных проверяет сам список при загрузке.
import { SECTIONS } from '../lib/adminMenu';

const SECTION_IDS: readonly string[] = SECTIONS.map(s => s.id);

const RESTORABLE: Record<string, ((p: Record<string, string>) => boolean) | undefined> = {
  // «Ещё» → раздел администратора: только известные разделы
  section: p => SECTION_IDS.includes(p.id),
  // профиль родителя и «О клубе»: подэкраны без данных ребёнка
  'p.view': p => ['kids', 'data', 'articles', 'news', 'tournaments', 'about'].includes(p.v),
  'ab.open': p => ['branches', 'champ', 'individual', 'gk', 'equipment', 'camp'].includes(p.id),
  'ab.materials': p => ['news', 'tournaments', 'article'].includes(p.s),
  'ab.product': p => Object.keys(p).length === 1 && Boolean(p.id),
  'hm.status': p => Object.keys(p).length === 0,
  'mk.status': p => Object.keys(p).length === 0,
};

/** Можно ли восстановить вложенный экран стека (корневая запись проверяется отдельно). */
export function restorableEntry(screen: string, params: Record<string, string>): boolean {
  const check = RESTORABLE[screen];
  return check ? check(params) : false;
}
