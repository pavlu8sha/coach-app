import { useState } from 'react';
import type { CoachGroup } from '../lib/coach';
import { SECTIONS, type SectionId } from '../lib/adminMenu';
import { ListRow } from '../ui/components';
import HomeScreenPrompt from '../ui/HomeScreenPrompt';
import NotifyToggle from '../ui/NotifyToggle';
import AdminSection from './AdminSection';

// «Ещё» у администратора: разделы, которых нет на нижней панели. Вернуться в список можно кнопкой «Ещё» внизу или ссылкой наверху.
export default function More({ groups, bar, onMenuChanged, onPreview }: { groups: CoachGroup[]; bar: SectionId[]; onMenuChanged: () => void; onPreview?: (r: 'guest' | 'parent' | 'child') => void }) {
  const [sub, setSub] = useState<SectionId | null>(null);
  if (sub) {
    return (
      <>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>
          <button type="button" className="ks-back" onClick={() => setSub(null)}>
            <span className="ks-chev back" aria-hidden="true" />
            Ещё
          </button>
        </div>
        <AdminSection id={sub} groups={groups} onMenuChanged={onMenuChanged} />
      </>
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
            <ListRow key={s.id} title={s.title} sub={[s.sub]} onClick={() => setSub(s.id)} />
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
