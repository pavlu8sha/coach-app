import { useState } from 'react';
import { Segmented } from '../ui/components';
import AdminPayments from './AdminPayments';
import CashDesk from './CashDesk';
import Debtors from './Debtors';
import MonthPayments from './MonthPayments';

type Sub = 'month' | 'cash' | 'debtors' | 'payments';

// Вкладка «Оплаты» администратора: по умолчанию месяц по группам (как в старом приложении), рядом приём оплат, должники и журнал платежей игрока
export default function Money() {
  const [sub, setSub] = useState<Sub>('month');
  return (
    <>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px 0' }}>
        <Segmented label="Раздел оплат" value={sub} onChange={setSub} items={[{ value: 'month', label: 'Месяц' }, { value: 'cash', label: 'Приём' }, { value: 'debtors', label: 'Долги' }, { value: 'payments', label: 'Платежи' }]} />
      </div>
      {sub === 'month' ? <MonthPayments /> : sub === 'cash' ? <CashDesk /> : sub === 'debtors' ? <Debtors /> : <AdminPayments />}
    </>
  );
}
