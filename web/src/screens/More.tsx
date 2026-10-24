import { useState } from 'react';
import type { CoachGroup } from '../lib/coach';
import { ListRow } from '../ui/components';
import NotifyToggle from '../ui/NotifyToggle';
import AdminPayments from './AdminPayments';
import AdminPrices from './AdminPrices';
import Coaches from './Coaches';
import Debtors from './Debtors';
import Group from './Group';
import RecalcPoints from './RecalcPoints';
import Schedule from './Schedule';

type Sub = 'schedule' | 'debtors' | 'coaches' | 'points' | 'payments' | 'prices' | 'recalc';

// «Ещё» у администратора: остальные разделы. Вернуться в список можно кнопкой «Ещё» внизу или ссылкой наверху.
export default function More({ groups }: { groups: CoachGroup[] }) {
  const [sub, setSub] = useState<Sub | null>(null);
  if (sub) {
    return (
      <>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>
          <button type="button" className="ks-back" onClick={() => setSub(null)}>
            <span className="ks-chev back" aria-hidden="true" />
            Ещё
          </button>
        </div>
        {sub === 'schedule' ? <Schedule all /> : sub === 'debtors' ? <Debtors /> : sub === 'coaches' ? <Coaches /> : sub === 'payments' ? <AdminPayments /> : sub === 'prices' ? <AdminPrices /> : sub === 'recalc' ? <RecalcPoints /> : <Group groups={groups} />}
      </>
    );
  }
  return (
    <main className="page">
      <h1>Ещё</h1>
      <ListRow title="Расписание" sub={['Тренировки всех групп, правка слотов']} onClick={() => setSub('schedule')} />
      <ListRow title="Баллы игроков" sub={['Ручные баллы, история, контакты родителей']} onClick={() => setSub('points')} />
      <ListRow title="Платежи" sub={['Внести платёж, исправить запись']} onClick={() => setSub('payments')} />
      <ListRow title="Цены" sub={['Абонемент и индивидуальные занятия по месяцам']} onClick={() => setSub('prices')} />
      <ListRow title="Пересчёт баллов за матчи" sub={['Привести баллы к новой схеме']} onClick={() => setSub('recalc')} />
      <ListRow title="Должники" sub={['Долг по абонементам, скидки, показ родителям']} onClick={() => setSub('debtors')} />
      <ListRow title="Тренеры" sub={['Назначение групп тренерам']} onClick={() => setSub('coaches')} />
      <NotifyToggle hint="Бот пришлёт сообщение о новых запросах на привязку и на удаление данных. Чтобы сообщения приходили, один раз нажмите «Старт» в чате с ботом клуба." />
    </main>
  );
}
