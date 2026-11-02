import { useEffect, useState } from 'react';
import { SETTINGS, settingError, settingText, useClubSettings, type SettingDef, type SettingValues } from '../lib/clubSettings';
import { supabase } from '../lib/supabase';
import { Loading } from './Message';

// «Настройки клуба» (#339): общие значения, которые раньше были зашиты в код или стояли в старом приложении.
// Пустое поле и «По умолчанию» убирают запись, тогда действует значение по умолчанию.

function Row({ def, saved, clubId, onSaved }: { def: SettingDef; saved: string | undefined; clubId: string; onSaved: () => void }) {
  const [value, setValue] = useState(saved ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setValue(saved ?? ''); }, [saved]);
  const custom = saved !== undefined && saved.trim() !== '';
  const shown = value.trim() === '' ? def.def : value;

  const save = async () => {
    const bad = settingError(def, shown);
    if (bad) return setMsg({ ok: false, text: bad });
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').upsert({ club_id: clubId, key: def.key, scope: '', value: shown.trim(), updated_at: new Date().toISOString() }, { onConflict: 'club_id,key,scope' });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось сохранить. Проверьте, что вы вошли как администратор.' });
    setMsg({ ok: true, text: 'Сохранено.' });
    onSaved();
  };
  const reset = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').delete().eq('club_id', clubId).eq('key', def.key).eq('scope', '');
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось вернуть значение по умолчанию.' });
    setValue('');
    setMsg({ ok: true, text: 'Действует значение по умолчанию.' });
    onSaved();
  };

  return (
    <div className="ks-card">
      <label className="field" style={{ marginBottom: 8 }}>
        {def.title} <span className="muted">{custom ? 'из настроек' : 'по умолчанию'}</span>
        {def.kind === 'list'
          ? <textarea rows={3} value={value} placeholder={def.def} onChange={e => setValue(e.target.value)} />
          : <input inputMode="decimal" value={value} placeholder={def.def} onChange={e => setValue(e.target.value)} />}
      </label>
      <div className="two">
        <button type="button" className="ks-btn" disabled={busy || value.trim() === (saved ?? '').trim()} onClick={() => void save()}>Сохранить</button>
        <button type="button" className="ks-btn secondary" disabled={busy || !custom} onClick={() => void reset()}>По умолчанию</button>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>По умолчанию: {def.def}</p>
      {def.hint && <p className="muted">{def.hint}</p>}
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
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
