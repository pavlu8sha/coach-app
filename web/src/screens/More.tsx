import { useState } from 'react';
import type { CoachGroup } from '../lib/coach';
import { ListRow } from '../ui/components';
import HomeScreenPrompt from '../ui/HomeScreenPrompt';
import NotifyToggle from '../ui/NotifyToggle';
import AdminPayments from './AdminPayments';
import AdminPhotos from './AdminPhotos';
import AdminPrices from './AdminPrices';
import Coaches from './Coaches';
import Debtors from './Debtors';
import Group from './Group';
import MonthPayments from './MonthPayments';
import Leads from './Leads';
import TrainerLog from './TrainerLog';
import Camps from './Camps';
import Equipment from './Equipment';
import Extra from './Extra';
import Individual from './Individual';
import PointsStart from './PointsStart';
import RecalcPoints from './RecalcPoints';
import Schedule from './Schedule';
import Stats from './Stats';

type Sub = 'pstart' | 'month' | 'leads' | 'tlog' | 'camps' | 'equip' | 'extra' | 'ind' | 'schedule' | 'debtors' | 'coaches' | 'points' | 'payments' | 'prices' | 'recalc' | 'stats' | 'photos';

// «Ещё» у администратора: остальные разделы. Вернуться в список можно кнопкой «Ещё» внизу или ссылкой наверху.
export default function More({ groups, onPreview }: { groups: CoachGroup[]; onPreview?: (r: 'guest' | 'parent' | 'child') => void }) {
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
        {sub === 'schedule' ? <Schedule all /> : sub === 'debtors' ? <Debtors /> : sub === 'coaches' ? <Coaches /> : sub === 'payments' ? <AdminPayments /> : sub === 'photos' ? <AdminPhotos /> : sub === 'prices' ? <AdminPrices /> : sub === 'recalc' ? <RecalcPoints /> : sub === 'stats' ? <Stats /> : sub === 'ind' ? <Individual /> : sub === 'extra' ? <Extra /> : sub === 'equip' ? <Equipment /> : sub === 'camps' ? <Camps /> : sub === 'tlog' ? <TrainerLog /> : sub === 'leads' ? <Leads /> : sub === 'month' ? <MonthPayments /> : sub === 'pstart' ? <PointsStart /> : <Group groups={groups} />}
      </>
    );
  }
  return (
    <main className="page ks-menu">
      <h1>Ещё</h1>
      <p className="ks-label">Деньги</p>
      <ListRow title="Оплаты за месяц" sub={['Кто сколько внёс по группам, быстрый платёж']} onClick={() => setSub('month')} />
      <ListRow title="Платежи" sub={['Внести платёж, исправить запись']} onClick={() => setSub('payments')} />
      <ListRow title="Должники" sub={['Долг по абонементам, скидки, показ родителям']} onClick={() => setSub('debtors')} />
      <p className="ks-label">Занятия</p>
      <ListRow title="Индивидуальные" sub={['Вратари и индивидуальные: запись, оплата, долги']} onClick={() => setSub('ind')} />
      <ListRow title="Дополнительные" sub={['Доп. тренировки: запись, оплата, долги']} onClick={() => setSub('extra')} />
      <ListRow title="Расписание" sub={['Тренировки всех групп, правка слотов']} onClick={() => setSub('schedule')} />
      <p className="ks-label">Клуб</p>
      <ListRow title="Экипировка" sub={['Заказы, оплата, выдача, каталог']} onClick={() => setSub('equip')} />
      <ListRow title="Сборы" sub={['Лагеря и сборы: участники, тарифы, платежи']} onClick={() => setSub('camps')} />
      <ListRow title="Фото клуба" sub={['Заменить фото в «О клубе» и экипировке']} onClick={() => setSub('photos')} />
      <ListRow title="Заявки" sub={['Новые родители из бота «Хочу в KickStart»']} onClick={() => setSub('leads')} />
      <p className="ks-label">Тренеры и игроки</p>
      <ListRow title="Статистика" sub={['Посещаемость и матчи за период']} onClick={() => setSub('stats')} />
      <ListRow title="Учёт тренеров" sub={['Проведённые тренировки и часы по месяцам']} onClick={() => setSub('tlog')} />
      <ListRow title="Баллы игроков" sub={['Ручные баллы, история, контакты родителей']} onClick={() => setSub('points')} />
      <ListRow title="Тренеры" sub={['Назначение групп тренерам']} onClick={() => setSub('coaches')} />
      <p className="ks-label">Настройки</p>
      <ListRow title="Цены" sub={['Абонемент и индивидуальные занятия по месяцам']} onClick={() => setSub('prices')} />
      <ListRow title="Старт подсчёта баллов" sub={['С какой даты баллы видны родителям и тренерам']} onClick={() => setSub('pstart')} />
      <ListRow title="Пересчёт баллов за матчи" sub={['Привести баллы к новой схеме']} onClick={() => setSub('recalc')} />
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
