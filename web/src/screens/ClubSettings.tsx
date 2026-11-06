import { useDirtyGuard } from '../nav';
import { useEffect, useRef, useState } from 'react';
import { setGroupOrder } from '../lib/coach';
import { CHAMP_FEE_KEY, SETTINGS, settingError, settingText, useClubSettings, type SettingDef, type SettingValues } from '../lib/clubSettings';
import { supabase } from '../lib/supabase';
import { Pill } from '../ui/components';
import { Loading } from './Message';

// «Настройки клуба» (#339): общие значения, которые раньше были зашиты в код или стояли в старом приложении.
// В поле всегда стоит действующее значение. Пустое поле и «По умолчанию» убирают запись и возвращают значение по умолчанию.

function Row({ def, scope = '', title, saved, clubId, resetLabel = 'По умолчанию', showDefault = true, onSaved }: {
  def: SettingDef; scope?: string; title?: string; saved: string | undefined; clubId: string; resetLabel?: string; showDefault?: boolean; onSaved: () => void;
}) {
  const custom = saved !== undefined && saved.trim() !== '';
  const effective = custom ? saved!.trim() : def.def;
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
  useDirtyGuard(value.trim() !== effective);
  const inputId = `setting-${def.key}-${scope}`;
  const defText = def.def === '' ? (def.emptyLabel ?? 'не задано') : def.def;
  const savedError = custom ? settingError(def, saved!.trim()) : null;

  const remove = async (okText: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').delete().eq('club_id', clubId).eq('key', def.key).eq('scope', scope);
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось вернуть значение по умолчанию.' });
    setValue(def.def);
    setMsg({ ok: true, text: okText });
    onSaved();
  };
  const save = async () => {
    const text = value.trim();
    if (text === '') return void remove(showDefault ? 'Действует значение по умолчанию.' : 'Значение убрано.');
    const bad = settingError(def, text);
    if (bad) return setMsg({ ok: false, text: bad });
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').upsert({ club_id: clubId, key: def.key, scope, value: text, updated_at: new Date().toISOString() }, { onConflict: 'club_id,key,scope' });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось сохранить. Проверьте, что вы вошли как администратор.' });
    setValue(text);
    setMsg({ ok: true, text: 'Сохранено.' });
    onSaved();
  };

  return (
    <div className="ks-card">
      <div className="ks-line" style={{ alignItems: 'flex-start', gap: 8 }}>
        <label htmlFor={inputId} style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--ks-text, inherit)', overflowWrap: 'anywhere' }}>{title ?? def.title}</label>
        <Pill tone={custom ? 'primary' : 'neutral'}>{custom ? 'своё' : showDefault ? 'по умолчанию' : 'общее'}</Pill>
      </div>
      {def.hint && showDefault && <p className="muted" style={{ margin: '4px 0 0' }}>{def.hint}</p>}
      {savedError && <p className="error" style={{ margin: '4px 0 0' }}>Сохранённое значение недопустимо: {savedError}</p>}
      <div className="field" style={{ marginTop: 10 }}>
        {def.kind === 'list'
          ? <textarea id={inputId} rows={3} value={value} onChange={e => setValue(e.target.value)} style={{ font: 'inherit', fontSize: '1rem', padding: 12, borderRadius: 'var(--ks-radius)', border: '1px solid var(--ks-border-strong)' }} />
          : <input id={inputId} inputMode={def.integer ? 'numeric' : 'decimal'} value={value} onChange={e => setValue(e.target.value)} />}
      </div>
      <div className="two" style={{ marginTop: 10 }}>
        <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>Сохранить</button>
        {custom && <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void remove(showDefault ? 'Действует значение по умолчанию.' : 'Команда снова берёт общий взнос.')}>{resetLabel}</button>}
      </div>
      {custom && showDefault && <p className="muted" style={{ margin: '8px 0 0' }}>По умолчанию: {defText}</p>}
      {!custom && showDefault && def.def === '' && <p className="muted" style={{ margin: '8px 0 0' }}>Сейчас: {defText}</p>}
      {msg && <p className={msg.ok ? 'muted' : 'error'} style={{ margin: '8px 0 0' }}>{msg.text}</p>}
    </div>
  );
}

// Свои значения взноса за чемпионат по командам (ключ matches.champFee, область = название команды).
function TeamFees({ clubId, teams, onSaved }: { clubId: string; teams: Record<string, string>; onSaved: () => void }) {
  const [team, setTeam] = useState('');
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useDirtyGuard(team.trim() !== '' || fee.trim() !== '');
  const def = SETTINGS.find(s => s.key === CHAMP_FEE_KEY)!;
  const add = async () => {
    const t = team.trim();
    const bad = settingError({ ...def, def: '0' }, fee);
    if (!t) return setMsg({ ok: false, text: 'Укажите команду.' });
    if (bad || fee.trim() === '') return setMsg({ ok: false, text: bad ?? 'Нужно число.' });
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').upsert({ club_id: clubId, key: CHAMP_FEE_KEY, scope: t, value: fee.trim(), updated_at: new Date().toISOString() }, { onConflict: 'club_id,key,scope' });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: 'Не удалось сохранить.' });
    setTeam('');
    setFee('');
    setMsg({ ok: true, text: 'Сохранено.' });
    onSaved();
  };
  return (
    <>
      <h3>Свои значения команд</h3>
      {Object.entries(teams).sort(([a], [b]) => a.localeCompare(b, 'ru', { numeric: true })).map(([t, v]) => (
        <Row key={t} def={def} scope={t} title={t} saved={v} clubId={clubId} resetLabel="К общему" showDefault={false} onSaved={onSaved} />
      ))}
      <div className="ks-card">
        <b style={{ fontSize: '1rem' }}>Добавить своё значение команды</b>
        <label className="field">Команда<input value={team} placeholder="Например U13-A" onChange={e => setTeam(e.target.value)} /></label>
        <label className="field">Взнос, ₾<input inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} /></label>
        <button type="button" className="ks-btn" style={{ marginTop: 10 }} disabled={busy} onClick={() => void add()}>Добавить</button>
        {msg && <p className={msg.ok ? 'muted' : 'error'} style={{ margin: '8px 0 0' }}>{msg.text}</p>}
      </div>
    </>
  );
}

export default function ClubSettings() {
  const s = useClubSettings();
  const order = s.values['groups.order'];
  useEffect(() => { if (s.loaded) setGroupOrder(order ?? ''); }, [s.loaded, order]);
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
          {g === 'Матчи' && <TeamFees clubId={s.clubId!} teams={s.scoped[CHAMP_FEE_KEY] ?? {}} onSaved={s.reload} />}
        </section>
      ))}
      <p className="muted">Сейчас в «Экипировке»: {(() => { const pct = settingText(values, 'equip.discPct'); return pct === '0' ? 'скидки нет' : `скидка ${pct}% на новый заказ, если набор собран по правилам выше`; })()}.</p>
    </main>
  );
}
