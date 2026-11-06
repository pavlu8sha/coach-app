import { useNavState } from '../nav';
import { Segmented } from '../ui/components';
import Booking from './Booking';
import ParentCalendar from './ParentCalendar';
import Schedule from './Schedule';

// «Расписание» родителя: календарь ребёнка, расписание групп и запись на занятия.
export default function ParentSchedule() {
  const [tab, setTab] = useNavState<'calendar' | 'groups' | 'booking'>('ps.tab', 'calendar', { persist: { kind: 'enum', values: ['calendar', 'groups', 'booking'] } });
  const items = [
    { value: 'calendar' as const, label: 'Календарь' },
    { value: 'groups' as const, label: 'Группы' },
    { value: 'booking' as const, label: 'Запись на занятия' },
  ];
  const switcher = <Segmented label="Раздел расписания" value={tab} onChange={setTab} items={items} />;

  if (tab === 'calendar') {
    return (
      <>
        <header style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>{switcher}</header>
        <ParentCalendar />
      </>
    );
  }
  if (tab === 'groups') {
    return (
      <>
        <header style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>{switcher}</header>
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
