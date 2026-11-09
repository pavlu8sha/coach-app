import { useCallback, useEffect, useState } from 'react';
import { ExpandableTextarea } from '../ui/ExpandableTextarea';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { ListRow, Pill, SearchInput, Segmented } from '../ui/components';
import { Loading } from './Message';
import { matchPlayers, parseLines, type ImportResult } from '../lib/firstWaveImport';

type Dir = 'ind_sat' | 'ind_sun' | 'goalkeeper';
interface Row { player_id: string; name: string; direction: Dir; parents: number; enabled: number }
interface Preview { direction: Dir; recipients: number }

const DIRS: { value: Dir; label: string }[] = [{ value: 'ind_sat', label: 'Суббота' }, { value: 'ind_sun', label: 'Воскресенье' }, { value: 'goalkeeper', label: 'Вратарская' }];

// Первая волна уведомлений (миграция 0151): дети из групп владельца по направлениям. Родителям включаются настройки направления.
// Реальную пятничную рассылку запускает владелец отдельно (db/ops/first_wave_friday_send.sql); здесь только предпросмотр.
export default function FirstWave() {
  const [dir, setDir] = useState<Dir>('ind_sat');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [text, setText] = useState('');
  const [imp, setImp] = useState<ImportResult | null>(null);

  const load = useCallback(async () => {
    const r = await supabase.rpc('first_wave_list');
    if (r.error) return setMsg({ ok: false, text: r.error.message.includes('Could not find the function') ? 'Раздел появится после миграции 0151.' : coachError(r.error.message) });
    setRows((r.data ?? []) as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').eq('status', 'active').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as { id: string; full_name: string }[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const add = async (id: string) => {
    setBusy('a' + id);
    setMsg(null);
    const r = await supabase.rpc('first_wave_add', { dirs: [dir], pls: [id] });
    setBusy(null);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setMsg({ ok: true, text: 'Добавлен: родителям включено направление.' });
    setQ('');
    setPreview(null);
    await load();
  };
  const remove = async (row: Row) => {
    setBusy('d' + row.player_id);
    setMsg(null);
    const r = await supabase.rpc('first_wave_remove', { d: row.direction, p: row.player_id });
    setBusy(null);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setPreview(null);
    await load();
  };
  const check = async () => {
    setBusy('preview');
    setMsg(null);
    const r = await supabase.rpc('first_wave_friday', { dry: true });
    setBusy(null);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setPreview((r.data ?? []) as Preview[]);
  };

  // Импорт списком: имена из текста или файла (CSV, TXT) сопоставляются с активными игроками; в базу уходит только то, что нашлось однозначно
  const readFile = async (f: File | undefined) => { if (f) setText(await f.text()); setImp(null); };
  const checkList = async () => {
    setBusy('check');
    setMsg(null);
    const r = await supabase.from('players').select('id, full_name').eq('status', 'active').limit(5000);
    setBusy(null);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setImp(matchPlayers(parseLines(text), (r.data ?? []) as { id: string; full_name: string }[]));
  };
  const addFound = async () => {
    if (!imp) return;
    setBusy('import');
    setMsg(null);
    const byDir = new Map<Dir, string[]>();
    for (const x of imp.ok) byDir.set(x.line.dir ?? dir, [...(byDir.get(x.line.dir ?? dir) ?? []), x.player.id]);
    for (const [d, pls] of byDir) {
      const r = await supabase.rpc('first_wave_add', { dirs: [d], pls });
      if (r.error) { setBusy(null); return setMsg({ ok: false, text: coachError(r.error.message) }); }
    }
    setBusy(null);
    setMsg({ ok: true, text: `Добавлено детей: ${imp.ok.length}. Родителям включены уведомления направления.` });
    setImp(null);
    setText('');
    setPreview(null);
    await load();
  };

  if (!rows) return msg ? <p className="error">{msg.text}</p> : <Loading />;
  const mine = rows.filter(r => r.direction === dir);
  return (
    <>
      <p className="muted">Дети, чьим родителям включаются уведомления о записи по направлению. Выбор самого родителя в профиле не перезаписывается.</p>
      <Segmented label="Направление" value={dir} onChange={v => { setDir(v); setMsg(null); }} items={DIRS} />
      {msg && <p className={msg.ok ? 'muted' : 'error'} role="status">{msg.text}</p>}
      <h3>В списке ({mine.length})</h3>
      {mine.length === 0 ? <p className="muted">Пока никого.</p> : mine.map(r => (
        <ListRow key={r.player_id + r.direction} avatar={r.name} title={r.name}
          sub={[r.parents === 0 ? 'нет привязанных родителей' : `Родителей: ${r.parents}, получают: ${r.enabled}`]}
          end={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{r.parents > 0 && r.enabled === 0 && <Pill tone="warning">Отключено</Pill>}<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} aria-label={`Убрать: ${r.name}`} disabled={busy === 'd' + r.player_id} onClick={() => void remove(r)}>Убрать</button></span>} />
      ))}
      <h3>Добавить ребёнка</h3>
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} suggestions={found.map(f => f.full_name)} />
      {found.map(p => (
        <ListRow key={p.id} avatar={p.full_name} title={p.full_name}
          end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} aria-label={`Добавить: ${p.full_name}`} disabled={busy === 'a' + p.id || mine.some(m => m.player_id === p.id)} onClick={() => void add(p.id)}>Добавить</button>} />
      ))}
      <h3>Загрузить список</h3>
      <p className="muted">Вставьте фамилии по одной в строке или выберите файл CSV/TXT. Во второй колонке можно указать направление (суббота, воскресенье, вратарская), иначе берётся выбранное выше.</p>
      <ExpandableTextarea label="Список" rows={5} value={text} onChange={v => { setText(v); setImp(null); }} />
      <label className="field">Файл<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => void readFile(e.target.files?.[0])} /></label>
      <button type="button" className="ks-btn secondary" disabled={busy === 'check' || !text.trim()} onClick={() => void checkList()}>Проверить список</button>
      {imp && (
        <div role="status">
          <p>Найдено: {imp.ok.length}, неоднозначно: {imp.ambiguous.length}, не найдено: {imp.missing.length}.</p>
          {imp.ambiguous.length > 0 && <p className="error">Неоднозначные (несколько игроков с таким именем) не добавляются: {imp.ambiguous.map(a => a.line.name).join(', ')}.</p>}
          {imp.missing.length > 0 && <p className="error">Не найдены среди активных игроков: {imp.missing.map(m => m.name).join(', ')}.</p>}
          <button type="button" className="ks-btn" disabled={busy === 'import' || imp.ok.length === 0} onClick={() => void addFound()}>Добавить найденных ({imp.ok.length})</button>
        </div>
      )}
      <h3>Пятничная рассылка</h3>
      <p className="muted">Разовое сообщение «запись теперь в приложении». Исключаются дети, уже записанные по направлению, родители с выключенным направлением и те, кто уже получил сообщение. Реальный запуск делает владелец отдельно, здесь только предпросмотр.</p>
      <button type="button" className="ks-btn secondary" disabled={busy === 'preview'} onClick={() => void check()}>Посмотреть, кому уйдёт</button>
      {preview && (
        <ul>{preview.map(p => <li key={p.direction}>{DIRS.find(d => d.value === p.direction)?.label}: родителей {p.recipients}</li>)}</ul>
      )}
    </>
  );
}
