// Превью UI-kit для согласования с дизайнером и PM (npm run dev → /ui-preview.html). Данные выдуманные.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './kit.css';
import { EmptyState, ListRow, Pill, SearchInput, Segmented, SkeletonRows, SwitchRow } from './components';

function Preview() {
  const [tab, setTab] = useState<'child' | 'schedule'>('child');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  document.documentElement.setAttribute('data-theme', theme);
  document.body.style.background = 'var(--ks-bg)';
  return (
    <main className="ks-page">
      <h1 className="ks-h1">UI-kit Mini App</h1>
      <Segmented label="Тема превью" value={theme} onChange={setTheme} items={[{ value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }]} />
      <Segmented label="Разделы" value={tab} onChange={setTab} items={[{ value: 'child', label: 'Ребёнок' }, { value: 'schedule', label: 'Расписание' }]} />
      <SearchInput label="Поиск ребёнка" placeholder="Поиск: ФИ" value={q} onChange={setQ} />
      <div style={{ height: 8 }} />
      <SwitchRow id="only" label="Только не оплатившие" checked={only} onChange={setOnly} />
      <p className="ks-label">Строки списка</p>
      <ListRow avatar="Amodeo Nolan" title="Amodeo Nolan" sub={['U10-B', 'KS-0002 · р. 05.09.2016']} end={<Pill tone="success" dot>Оплачено</Pill>} onClick={() => {}} />
      <ListRow avatar="Shevchukovskiy Aleksandr Konstantinovich" title="Shevchukovskiy Aleksandr Konstantinovich" sub={['Ortachala U12 + Индивидуальные']} end={<Pill tone="danger" dot>Не оплачено</Pill>} onClick={() => {}} />
      <ListRow avatar="Andreev Boris" title="Andreev Boris" sub={['U7-A']} end={<Pill tone="warning">Частично</Pill>} />
      <p className="ks-label">Пилюли</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pill tone="success" dot>Оплачено</Pill>
        <Pill tone="danger" dot>Не оплачено</Pill>
        <Pill tone="warning">Частично</Pill>
        <Pill tone="primary">12 баллов</Pill>
        <Pill>Пауза</Pill>
      </div>
      <p className="ks-label">Загрузка</p>
      <SkeletonRows count={2} />
      <p className="ks-label">Пустое состояние и ошибка</p>
      <div className="ks-card">
        <EmptyState icon="search" title="Ничего не найдено" text="Попробуйте изменить запрос." action={{ label: 'Сбросить', run: () => setQ('') }} />
      </div>
      <div className="ks-card">
        <EmptyState icon="alert" title="Не удалось загрузить данные" text="Проверьте соединение и попробуйте ещё раз." action={{ label: 'Повторить', run: () => {} }} />
      </div>
      <button type="button" className="ks-btn">Основная кнопка</button>
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn secondary">Второстепенная</button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
