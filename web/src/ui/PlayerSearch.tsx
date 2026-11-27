import { useEffect, useState } from 'react';
import { errMsg } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { ListRow, NameDatalist, searchFocusProps } from './components';

export interface FoundPlayer { id: string; full_name: string }

// Единый поиск игрока клуба для «Состава и ответов» и «Результата» (единый экран матча, PR 2).
// Запрос от 2 символов, пауза 150 мс (поиск ходит в базу, лишняя пауза заметна на телефоне), доступ режет RLS (клуб пользователя).
// Результат и ошибка хранятся вместе с текстом запроса: ответ на прежний запрос не показывается (#769), ошибка не выдаётся за «Никого не найдено», у ошибки есть «Повторить поиск».
export function PlayerSearch({ id, label, ariaLabel, placeholder, exclude, onPick, busy = false, actionLabel = 'Добавить', datalist = false }: {
  id: string; label?: string; ariaLabel?: string; placeholder: string; exclude: (playerId: string) => boolean; onPick: (p: FoundPlayer) => void | Promise<void>;
  busy?: boolean; actionLabel?: string; datalist?: boolean;
}) {
  const [q, setQ] = useState('');
  const query = q.trim();
  const [search, setSearch] = useState<{ q: string; rows: FoundPlayer[] | null; text?: string } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (query.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await supabase.from('players').select('id, full_name').ilike('full_name', `%${query}%`).order('full_name').limit(8);
          if (!alive) return;
          setSearch(r.error ? { q: query, rows: null, text: errMsg(r.error) } : { q: query, rows: (r.data ?? []) as FoundPlayer[] });
        } catch (e) {
          if (!alive) return;
          setSearch({ q: query, rows: null, text: errMsg(e) });
        }
      })();
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [query, tries]);
  const now = query.length >= 2 && search?.q === query ? search : null;
  const rows = now?.rows?.filter(f => !exclude(f.id)) ?? null;
  return (
    <div>
      {label && <label className="ks-label" htmlFor={id}>{label}</label>}
      <input id={id} className="ks-input" value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={ariaLabel}
        list={datalist ? `${id}-names` : undefined} autoComplete="off" {...searchFocusProps} />
      {datalist && <NameDatalist id={`${id}-names`} names={rows?.map(f => f.full_name) ?? []} />}
      {query.length >= 2 && !now && <p className="muted" role="status">Поиск…</p>}
      {now && now.rows === null && (
        <div role="alert" className="ks-card">
          <p className="ks-error">Не удалось выполнить поиск</p>
          <p className="muted">{now.text ?? ''}</p>
          <button type="button" className="ks-btn secondary" onClick={() => { setSearch(null); setTries(n => n + 1); }}>Повторить поиск</button>
        </div>
      )}
      {now?.rows && now.rows.length === 0 && <p className="muted">Никого не найдено</p>}
      <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
        {rows?.map(f => (
          <ListRow key={f.id} avatar={f.full_name} title={f.full_name}
            end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy} onClick={() => { setQ(''); setSearch(null); void onPick(f); }}>{actionLabel}</button>} />
        ))}
      </div>
    </div>
  );
}
