import { useState } from 'react';
import { ListRow } from '../ui/components';
import AdminPayments from './AdminPayments';
import CashDesk from './CashDesk';
import Debtors from './Debtors';
import MonthPayments from './MonthPayments';

type Sub = 'cash' | 'month' | 'payments' | 'debtors';

// Вкладка «Оплаты» администратора: приём оплат, оплаты за месяц, платежи игрока, должники
export default function Money() {
  const [sub, setSub] = useState<Sub | null>(null);
  if (sub) {
    return (
      <>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>
          <button type="button" className="ks-back" onClick={() => setSub(null)}>
            <span className="ks-chev back" aria-hidden="true" />
            Оплаты
          </button>
        </div>
        {sub === 'cash' ? <CashDesk /> : sub === 'month' ? <MonthPayments /> : sub === 'payments' ? <AdminPayments /> : <Debtors />}
      </>
    );
  }
  return (
    <main className="page ks-menu">
      <h1>Оплаты</h1>
      <ListRow title="Приём оплат" sub={['Игрок: всё, что к оплате, и платёж в один шаг']} onClick={() => setSub('cash')} />
      <ListRow title="Оплаты за месяц" sub={['Кто сколько внёс по группам, быстрый платёж']} onClick={() => setSub('month')} />
      <ListRow title="Платежи" sub={['Внести платёж, исправить запись']} onClick={() => setSub('payments')} />
      <ListRow title="Должники" sub={['Долг по абонементам, скидки, показ родителям']} onClick={() => setSub('debtors')} />
    </main>
  );
}
