import { useState } from 'react';
import { closeApp } from '../lib/telegram';
import { supabase } from '../lib/supabase';
import { Segmented } from '../ui/components';
import CashDesk from './CashDesk';
import CashReport from './CashReport';

type Sub = 'cash' | 'report';

// Касса локального администратора (#321): только платежи своих локаций. Остальные разделы для него закрыты.
// База проверяет права на каждый запрос; список локаций здесь — только для подписи.
export default function LocationCash({ locations }: { locations: string[] }) {
  const [sub, setSub] = useState<Sub>('cash');
  // как в профиле: выход и сброс приложения, иначе экран кассы остаётся открытым
  const logout = async () => {
    await supabase.auth.signOut();
    closeApp();
  };
  return (
    <>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px 0' }}>
        <p className="ks-muted" style={{ margin: 0 }}>Касса: {locations.join(', ')}</p>
        <Segmented label="Раздел кассы" value={sub} onChange={setSub} items={[{ value: 'cash', label: 'Приём оплат' }, { value: 'report', label: 'Отчёт' }]} />
        <button type="button" className="ks-btn secondary" style={{ marginTop: 8, width: 'auto' }} onClick={() => void logout()}>Выйти</button>
      </div>
      {sub === 'cash' ? <CashDesk /> : <CashReport />}
    </>
  );
}
