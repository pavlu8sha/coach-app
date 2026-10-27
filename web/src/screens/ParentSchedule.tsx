import { useState } from 'react';
import { Segmented } from '../ui/components';
import Booking from './Booking';
import ParentCalendar from './ParentCalendar';
import Schedule from './Schedule';

// «Расписание» родителя: календарь ребёнка, расписание групп и запись на занятия.
export default function ParentSchedule() {
  const [tab, setTab] = useState<'calendar' | 'groups' | 'booking'>('calendar');
  const items = [
    { value: 'calendar' as const, label: 'Календарь' },
    { value: 'groups' as const, label: 'Группы' },
    { value: 'booking' as const, label: 'Запись на занятия' },
  ];
  const switcher = <Segmented label="Раздел расписания" value={tab} onChange={setTab} items={items} />;

  if (tab === 'calendar') {
    return (
      <>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>{switcher}</div>
        <ParentCalendar />
      </>
    );
  }
  if (tab === 'groups') {
    return (
      <>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>{switcher}</div>
        <Schedule />
      </>
    );
  }
  return (
    <main className="page">
      <h1>Запись на занятия</h1>
      {switcher}
      <Booking />
    </main>
  );
}
