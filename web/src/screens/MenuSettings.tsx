import { useEffect, useState } from 'react';
import { DEFAULT_BAR, MAX_BAR, MENU_KEY, SECTIONS, parseBar, sectionById, type SectionId } from '../lib/adminMenu';
import { supabase } from '../lib/supabase';
import { ListRow } from '../ui/components';
import { Failure, Loading } from './Message';

// Администратор выбирает, какие разделы стоят на нижней панели и в каком порядке; остальные лежат в «Ещё»
export default function MenuSettings({ onChanged }: { onChanged: () => void }) {
  const [clubId, setClubId] = useState<string | null>(null);
  const [bar, setBar] = useState<SectionId[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const c = await supabase.from('clubs').select('id').limit(1);
      if (c.error) return setError(c.error.message);
      const cid = ((c.data ?? []) as { id: string }[])[0]?.id ?? null;
      setClubId(cid);
      if (!cid) return setError('Клуб не найден');
      const st = await supabase.from('club_settings').select('value').eq('club_id', cid).eq('key', MENU_KEY).maybeSingle();
      if (st.error) return setError(st.error.message);
      setBar(parseBar((st.data as { value: string } | null)?.value));
    })();
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить меню" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!bar) return <Loading />;

  const change = (next: SectionId[]) => { setBar(next); setMsg(null); };
  const move = (i: number, d: -1 | 1) => {
    const next = [...bar];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    change(next);
  };
  const rest = SECTIONS.filter(s => !bar.includes(s.id));

  const save = async (value: SectionId[]) => {
    if (!clubId) return;
    setBusy(true);
    const r = await supabase.from('club_settings').upsert({ club_id: clubId, key: MENU_KEY, scope: '', value: JSON.stringify({ bar: value }) }, { onConflict: 'club_id,key,scope' });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось сохранить меню.' });
    setBar(value);
    setMsg({ ok: true, text: 'Меню сохранено.' });
    onChanged();
  };

  return (
    <main className="page ks-menu">
      <h1>Меню</h1>
      <p className="muted">На нижней панели до {MAX_BAR} разделов, пятой всегда идёт «Ещё». Всё остальное лежит в «Ещё».</p>
      <p className="ks-label">На панели</p>
      {bar.map((id, i) => (
        <ListRow
          key={id}
          title={sectionById(id)?.title ?? id}
          end={
            <span className="ks-line">
              <button type="button" className="ks-btn secondary sm" style={{ width: 'auto' }} aria-label={`Выше: ${sectionById(id)?.title}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="ks-btn secondary sm" style={{ width: 'auto' }} aria-label={`Ниже: ${sectionById(id)?.title}`} disabled={i === bar.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="ks-btn secondary sm" style={{ width: 'auto' }} aria-label={`В «Ещё»: ${sectionById(id)?.title}`} disabled={bar.length <= 1} onClick={() => change(bar.filter(x => x !== id))}>В «Ещё»</button>
            </span>
          }
        />
      ))}
      <p className="ks-label">В «Ещё»</p>
      {rest.filter(s => s.id !== 'menu').map(s => (
        <ListRow
          key={s.id}
          title={s.title}
          sub={[s.sub]}
          end={<button type="button" className="ks-btn secondary sm" style={{ width: 'auto' }} aria-label={`На панель: ${s.title}`} disabled={bar.length >= MAX_BAR} onClick={() => change([...bar, s.id])}>На панель</button>}
        />
      ))}
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      <button type="button" className="ks-btn" disabled={busy} onClick={() => void save(bar)}>Сохранить меню</button>
      <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void save(DEFAULT_BAR)}>Вернуть как было</button>
    </main>
  );
}
