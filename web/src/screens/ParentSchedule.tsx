import { useState } from 'react';
import { Segmented } from '../ui/components';
import Booking from './Booking';
import Schedule from './Schedule';

// «Расписание» родителя: группы ребёнка и запись на индивидуальные, вратарские и дополнительные тренировки.
export default function ParentSchedule() {
  const [tab, setTab] = useState<'groups' | 'booking'>('groups');
  return tab === 'groups' ? (
    <>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>
        <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ value: 'groups', label: 'Группы' }, { value: 'booking', label: 'Запись на занятия' }]} />
      </div>
      <Schedule />
    </>
  ) : (
    <main className="page">
      <h1>Запись на занятия</h1>
      <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ value: 'groups', label: 'Группы' }, { value: 'booking', label: 'Запись на занятия' }]} />
      <Booking />
    </main>
  );
}
