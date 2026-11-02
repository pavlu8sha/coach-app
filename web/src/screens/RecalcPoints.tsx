import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../ui/ConfirmSheet';

// Для администратора: пересчёт автобаллов за матчи по действующим правилам (docs/RATING_SPEC.md, миграция 0027).
export default function RecalcPoints() {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('recalc_match_points');
    setBusy(false);
   
    if (r.error) {
      return setMsg({ ok: false, text: r.error.message.includes('Could not find the function') ? 'Функция пересчёта ещё не установлена в базе (миграция 0027).' : r.error.message.includes('forbidden') ? 'Нет прав: пересчёт доступен только администратору.' : r.error.message });
    }
    setMsg({ ok: true, text: `Готово. Пересчитано матчей: ${String(r.data ?? 0)}.` });
  };

  const askRun = async () => {
    if (!(await ask({ title: 'Пересчитать баллы за матчи?', note: 'Пересчёт перезапишет прежние автоначисления за матчи.', confirmLabel: 'Пересчитать', danger: true }))) return;
    await run();
  };

  return (
    <main className="page">
      <h1>Пересчёт баллов за матчи</h1>
      <p className="muted" style={{ marginBottom: 12 }}>
        Автоматические баллы за матчи будут пересчитаны по действующим правилам: победа — 2 играющим, лучшему игроку — 3; поражение или ничья — 1; гол +1. Ручные баллы тренеров не меняются. Баллы за матчи, у которых нет состава, не затрагиваются.
      </p>
      <p className="muted" style={{ marginBottom: 12 }}>Делайте пересчёт после того, как дополнены составы и голы старых матчей.</p>
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      <button type="button" className="ks-btn" onClick={() => void askRun()}>Пересчитать баллы за матчи</button>
      {confirmDialog}
    </main>
  );
}
