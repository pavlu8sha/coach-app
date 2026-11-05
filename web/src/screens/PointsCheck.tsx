import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../ui/ConfirmSheet';

interface Drift { source_type: string; source_id: string; changes: number }
interface Exc { kind: string; source_id: string; event_date: string; player_id?: string }
interface Report { fix: boolean; checked: number; changes: number; drift: Drift[]; exceptions: Exc[] }

const SOURCE: Record<string, string> = { group_session: 'Групповое занятие', individual: 'Индивидуальное', goalkeeper: 'Вратарское', extra: 'Дополнительное', match: 'Матч', series_bonus: 'Серия' };
const KIND: Record<string, string> = { match_without_score: 'Матч без счёта: баллы не начислены', ledger_without_group: 'Начисление без группы' };
const ruDate = (d: string) => d.slice(0, 10).split('-').reverse().join('.');

// Для администратора: сверка нового журнала баллов (#18) с занятиями, матчами и сериями. Проверка ничего не меняет; исправление запускается отдельно.
export default function PointsCheck() {
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<Report | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fix: boolean) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('points_consistency', { fix });
    setBusy(false);
    if (r.error) {
      return setMsg({ ok: false, text: r.error.message.includes('Could not find the function') ? 'Сверка ещё не установлена в базе (миграция 0127).' : r.error.message.includes('forbidden') ? 'Нет прав: сверка доступна только администратору.' : r.error.message });
    }
    const data = r.data as Report;
    setRep(data);
    if (fix) setMsg({ ok: true, text: `Исправлено записей: ${data.changes}. Проверено источников: ${data.checked}.` });
  };

  const askFix = async () => {
    if (!(await ask({ title: 'Исправить журнал баллов?', note: 'Журнал будет приведён к занятиям и матчам. Старые строки останутся в истории со статусом «исправлено».', confirmLabel: 'Исправить' }))) return;
    await run(true);
  };

  return (
    <main className="page">
      <h1>Сверка баллов</h1>
      <p className="muted" style={{ marginBottom: 12 }}>
        Сравнивает журнал баллов с отметками, матчами и сериями. Расхождения бывают после правок в базе вручную. Проверка ничего не меняет.
      </p>
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      <div className="ks-btns">
        <button type="button" className="ks-btn" disabled={busy} onClick={() => void run(false)}>{busy ? 'Проверяем…' : 'Проверить'}</button>
      </div>
      {rep && !rep.fix && (
        <section className="ks-card" style={{ marginTop: 12 }}>
          <h2>{rep.changes === 0 ? 'Расхождений нет' : `Расхождений: ${rep.changes}`}</h2>
          <p className="muted">Проверено источников: {rep.checked}</p>
          {rep.drift.map(d => (
            <p key={d.source_type + d.source_id}>{SOURCE[d.source_type] ?? d.source_type}: изменений {d.changes}</p>
          ))}
          {rep.changes > 0 && <button type="button" className="ks-btn" disabled={busy} onClick={() => void askFix()}>Исправить журнал</button>}
        </section>
      )}
      {rep && rep.exceptions.length > 0 && (
        <section className="ks-card" style={{ marginTop: 12 }}>
          <h2>Исключения</h2>
          {rep.exceptions.map(e => (
            <p key={e.kind + e.source_id}>{KIND[e.kind] ?? e.kind} · {ruDate(e.event_date)}</p>
          ))}
        </section>
      )}
      {dialog}
    </main>
  );
}
