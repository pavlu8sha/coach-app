import { useEffect, useRef, useState } from 'react';
import { SETTINGS, settingError, settingText, useClubSettings, type SettingDef, type SettingValues } from '../lib/clubSettings';
import { supabase } from '../lib/supabase';
import { Pill } from '../ui/components';
import { Loading } from './Message';

// «Настройки клуба» (#339): общие значения, которые раньше были зашиты в код или стояли в старом приложении.
// Пустое поле и «По умолчанию» убирают запись, тогда действует значение по умолчанию.

function Row({ def, saved, clubId, onSaved }: { def: SettingDef; saved: string | undefined; clubId: string; onSaved: () => void }) {
  const custom = saved !== undefined && saved.trim() !== '';
  const effective = custom ? saved!.trim() : def.def;
  // В поле всегда стоит действующее значение (своё или по умолчанию), как обычный текст, а не серая подсказка.
  const [value, setValue] = useState(effective);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Поле подстраивается под действующее значение только когда оно изменилось (после сохранения или сброса),
  // но не при первом показе: иначе отложенный эффект мог бы стереть уже введённый текст.
  const prev = useRef(effective);
  useEffect(() => {
    if (prev.current === effective) return;
    prev.current = effective;
    setValue(effective);
  }, [effective]);
  const inputId = `setting-${def.key}`;

  const save = async () => {
    const text = value.trim() === '' ? def.def : value.trim();
    const bad = settingError(def, text);
    if (bad) return setMsg({ ok: false, text: bad });
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').upsert({ club_id: clubId, key: def.key, scope: '', value: text, updated_at: new Date().toISOString() }, { onConflict: 'club_id,key,scope' });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось сохранить. Проверьте, что вы вошли как администратор.' });
    setValue(text);
    setMsg({ ok: true, text: 'Сохранено.' });
    onSaved();
  };
  const reset = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').delete().eq('club_id', clubId).eq('key', def.key).eq('scope', '');
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось вернуть значение по умолчанию.' });
    setValue(def.def);
    setMsg({ ok: true, text: 'Действует значение по умолчанию.' });
    onSaved();
  };

  return (
    <div className="ks-card">
      <div className="ks-line" style={{ alignItems: 'flex-start', gap: 8 }}>
        <label htmlFor={inputId} style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--ks-text, inherit)', overflowWrap: 'anywhere' }}>{def.title}</label>
        <Pill tone={custom ? 'primary' : 'neutral'}>{custom ? 'своё' : 'по умолчанию'}</Pill>
      </div>
      {def.hint && <p className="muted" style={{ margin: '4px 0 0' }}>{def.hint}</p>}
      <div className="field" style={{ marginTop: 10 }}>
        {def.kind === 'list'
          ? <textarea id={inputId} rows={3} value={value} onChange={e => setValue(e.target.value)} style={{ font: 'inherit', fontSize: '1rem', padding: 12, borderRadius: 'var(--ks-radius)', border: '1px solid var(--ks-border-strong)' }} />
          : <input id={inputId} inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} />}
      </div>
      <div className="two" style={{ marginTop: 10 }}>
        <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>Сохранить</button>
        {custom && <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void reset()}>По умолчанию</button>}
      </div>
      {custom && <p className="muted" style={{ margin: '8px 0 0' }}>По умолчанию: {def.def}</p>}
      {msg && <p className={msg.ok ? 'muted' : 'error'} style={{ margin: '8px 0 0' }}>{msg.text}</p>}
    </div>
  );
}

export default function ClubSettings() {
  const s = useClubSettings();
  if (!s.loaded) return <Loading />;
  if (!s.clubId) return <main className="page"><p className="error">Клуб не найден.</p></main>;
  const groups = [...new Set(SETTINGS.map(x => x.group))];
  const values: SettingValues = s.values;
  return (
    <main className="page">
      <h1>Настройки клуба</h1>
      <p className="muted" style={{ marginBottom: 12 }}>Общие значения для всего приложения. Цены, расписание и реквизиты оплаты правятся в своих разделах.</p>
      {groups.map(g => (
        <section key={g}>
          <h3>{g}</h3>
          {SETTINGS.filter(x => x.group === g).map(d => <Row key={d.key} def={d} saved={values[d.key]} clubId={s.clubId!} onSaved={s.reload} />)}
        </section>
      ))}
      <p className="muted">Сейчас в «Экипировке»: {(() => { const pct = settingText(values, 'equipment.discount_pct'); return pct === '0' ? 'скидки нет' : `скидка ${pct}% на новый заказ, если набор собран по правилам выше`; })()}.</p>
    </main>
  );
}
