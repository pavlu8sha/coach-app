import { useNavState } from '../nav';
import { Segmented } from '../ui/components';
import CashDesk from './CashDesk';
import CashReport from './CashReport';
import LocationEquipment from './LocationEquipment';

type Sub = 'cash' | 'report' | 'issue';

// Касса локального администратора (#321): платежи своих локаций и выдача формы (0108). Остальные разделы для него закрыты.
// База проверяет права на каждый запрос; список локаций здесь — только для подписи.
export default function LocationCash({ locations }: { locations: string[] }) {
  const [sub, setSub] = useNavState<Sub>('sub', 'cash', { entry: 0, persist: { kind: 'enum', values: ['cash', 'report', 'issue'] } });
  return (
    <>
      <header style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px 0' }}>
        <p className="ks-muted" style={{ margin: 0 }}>Касса: {locations.join(', ')}</p>
        <Segmented label="Раздел кассы" value={sub} onChange={setSub} items={[{ value: 'cash', label: 'Приём оплат' }, { value: 'issue', label: 'Выдача формы' }, { value: 'report', label: 'Отчёт' }]} />
      </header>
      {sub === 'cash' ? <CashDesk /> : sub === 'issue' ? <LocationEquipment /> : <CashReport />}
    </>
  );
}
