import { useState } from 'react';
import { Segmented } from '../ui/components';
import CashDesk from './CashDesk';
import Debtors from './Debtors';
import MonthPayments from './MonthPayments';

type Sub = 'cash' | 'month' | 'debtors';

// Вкладка «Оплаты» администратора, как в старом приложении: «Приём оплат» (платежи дня, отмена), «По месяцам и группам», «Должники»
export default function Money() {
  const [sub, setSub] = useState<Sub>('cash');
  return (
    <>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px 0' }}>
        <Segmented label="Раздел оплат" value={sub} onChange={setSub} items={[{ value: 'cash', label: 'Приём оплат' }, { value: 'month', label: 'По месяцам' }, { value: 'debtors', label: 'Должники' }]} />
      </div>
      {sub === 'cash' ? <CashDesk /> : sub === 'month' ? <MonthPayments /> : <Debtors />}
    </>
  );
}
