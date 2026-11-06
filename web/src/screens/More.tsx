import type { CoachGroup } from '../lib/coach';
import { SECTIONS, isSection, type SectionId } from '../lib/adminMenu';
import { NavEntry, useNav } from '../nav';
import { ListRow } from '../ui/components';
import HomeScreenPrompt from '../ui/HomeScreenPrompt';
import NotifyToggle from '../ui/NotifyToggle';
import AdminSection from './AdminSection';

// «Ещё» у администратора: разделы, которых нет на нижней панели. Открытый подраздел хранится в стеке раздела «Ещё» (src/nav):
// «Назад» и системная кнопка возвращают в каталог на прежнее место, повторное нажатие «Ещё» ничего не сбрасывает.
export default function More({ groups, bar, onMenuChanged, onPreview }: { groups: CoachGroup[]; bar: SectionId[]; onMenuChanged: () => void; onPreview?: (r: 'guest' | 'parent' | 'child') => void }) {
  const nav = useNav();
  // раздел — вторая запись стека; вложенные экраны раздела (карточка, форма) лежат выше и каталогом не подменяются
  const base = nav.entries[1];
  const subId = base?.screen === 'section' ? base.params.id : null;
  const sub: SectionId | null = subId && isSection(subId) ? subId : null;
  if (sub) {
    return (
      <NavEntry index={nav.depth - 1}>
        {nav.depth === 2 && (
          <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>
            <button type="button" className="ks-back" onClick={() => nav.back()}>
              <span className="ks-chev back" aria-hidden="true" />
              Ещё
            </button>
          </div>
        )}
        <AdminSection id={sub} groups={groups} onMenuChanged={onMenuChanged} />
      </NavEntry>
    );
  }
  const items = SECTIONS.filter(s => !bar.includes(s.id));
  const groupsOrder = [...new Set(items.map(s => s.group))];
  return (
    <main className="page ks-menu">
      <h1>Ещё</h1>
      {groupsOrder.map(g => (
        <div key={g}>
          <p className="ks-label">{g}</p>
          {items.filter(s => s.group === g).map(s => (
            <ListRow key={s.id} title={s.title} sub={[s.sub]} onClick={() => nav.push('section', { id: s.id })} />
          ))}
        </div>
      ))}
      {onPreview && (
        <>
          <p className="ks-label">Посмотреть как</p>
          <ListRow title="Гость" sub={['«О клубе», заявка на пробную, расписание']} onClick={() => onPreview('guest')} />
          <ListRow title="Родитель" sub={['Экраны родителя без привязанных детей']} onClick={() => onPreview('parent')} />
          <ListRow title="Ребёнок" sub={['Ввод кода от родителя']} onClick={() => onPreview('child')} />
        </>
      )}
      <HomeScreenPrompt />
      <NotifyToggle hint="Бот пришлёт сообщение о новых запросах на привязку и на удаление данных. Чтобы сообщения приходили, один раз нажмите «Старт» в чате с ботом клуба." />
    </main>
  );
}
