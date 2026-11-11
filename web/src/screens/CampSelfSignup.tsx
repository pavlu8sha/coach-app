import { useCallback, useEffect, useState } from 'react';
import { coachError, fmtDate } from '../lib/coach';
import { checkPdfFile, openCampDoc, uploadCampDoc } from '../lib/campDocs';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { Loading } from './Message';

// Админский экран сборов: самозапись родителей, документы, рассылки (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 43-48).
// Экран только вызывает функции базы и показывает их ответ: права и правила проверяет база.

export interface CampLite { id: string; name: string; capacity: number | null; slug: string | null }

const MESSAGES: [string, string][] = [
  ['camp full', 'На сборе нет свободных мест.'],
  ['capacity below registered', 'Лимит не может быть меньше числа подтверждённых участников.'],
  ['bad capacity', 'Лимит указан неверно.'],
  ['bad slug', 'Имя ссылки: от 3 до 60 латинских букв, цифр и дефисов.'],
  ['bad terms', 'Условия указаны неверно: у каждого периода нужен текст, дата конца не раньше даты начала.'],
  ['already decided', 'Заявка уже решена.'],
  ['already registered', 'Этот ребёнок уже записан на сбор.'],
  ['application not found', 'Заявка не найдена.'],
  ['too many documents', 'На сборе уже слишком много документов.'],
  ['bad document', 'Документ указан неверно: название до 120 знаков, файл PDF до 10 МБ.'],
  ['not_pdf', 'Файл не похож на PDF.'],
  ['too_large', 'Файл больше 10 МБ.'],
  ['empty', 'Файл пустой.'],
  ['bad_title', 'Название нужно, до 120 знаков.'],
  ['not_published', 'Документ не опубликован. Загрузите файл ещё раз.'],
  ['unknown_state', 'Не удалось узнать, опубликован ли документ. Обновите список.'],
  ['storage', 'Хранилище недоступно. Попробуйте позже.'],
  ['network', 'Нет связи с сервером. Попробуйте ещё раз.'],
  ['forbidden', 'Недостаточно прав.'],
  ['unauthorized', 'Нужно войти заново.'],
  ['recipients changed', 'Список получателей изменился. Сделайте предпросмотр заново.'],
  ['duplicate broadcast', 'Такая рассылка уже отправлена. Повторить можно позже.'],
  ['too many broadcasts', 'По сбору уже пять рассылок за сутки.'],
  ['notifications off', 'Уведомления по сборам выключены.'],
  ['no recipients', 'Получателей нет.'],
  ['confirmation required', 'Сначала сделайте предпросмотр.'],
  ['bad text', 'Текст нужен, до 1000 знаков.'],
  ['refund above paid', 'Возврат больше внесённой суммы.'],
  ['bad amount', 'Сумма указана неверно.'],
  ['bad date', 'Дата возврата не может быть в будущем.'],
  ['already replaced', 'За этого участника уже оформлена замена.'],
  ['bad replacement', 'Замена невозможна: заменяемый должен быть отменившим или отказавшимся, заменяющий записанным.'],
  ['bad note', 'Комментарий слишком длинный.'],
  // родительские сценарии (условия 52-54)
  ['registration declined', 'Администратор отказал в записи на этот сбор.'],
  ['camp closed', 'Запись на сбор закрыта.'],
  ['not eligible', 'Этого ребёнка нельзя записать на этот сбор.'],
  ['tariff change closed', 'Срок смены тарифа прошёл.'],
  ['custom amount', 'У записи особая сумма, тариф меняет администратор.'],
  ['amount below paid', 'Тариф дешевле уже внесённой суммы.'],
  ['already cancelled', 'Запись уже отменена.'],
  ['not registered', 'Запись не активна.'],
  ['tariff not found', 'Тариф недоступен.'],
  ['bad comment', 'Комментарий до 500 знаков.'],
  ['camp not found', 'Сбор не найден.'],
];
export const campErr = (m: string): string => MESSAGES.find(([k]) => m.includes(k))?.[1] ?? coachError(m);

const num = (s: string) => Number(s.replace(',', '.'));
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { timeZone: 'Asia/Tbilisi', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ===== Заявки (43) =====
interface App { id: string; child_name: string; child_birth: string; parent_name: string; parent_phone: string; comment: string | null; status: 'new' | 'approved' | 'rejected'; created_at: string; decision_note: string | null; camp_tariffs: { name: string } | null }
const APP_STATUS: Record<App['status'], string> = { new: 'Новая', approved: 'Принята', rejected: 'Отклонена' };

export function CampApplications({ camp }: { camp: CampLite }) {
  const [apps, setApps] = useState<App[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void supabase.from('camp_applications').select('id, child_name, child_birth, parent_name, parent_phone, comment, status, created_at, decision_note, camp_tariffs(name)').eq('camp_id', camp.id).order('created_at', { ascending: false }).then(r => {
      if (r.error) return setMsg(campErr(r.error.message));
      const rows = (r.data ?? []) as unknown as App[];
      setApps([...rows].sort((a, b) => Number(b.status === 'new') - Number(a.status === 'new') || b.created_at.localeCompare(a.created_at)));
    });
  }, [camp.id, reload]);

  const decide = async (a: App, approve: boolean) => {
    const ok = await ask({
      title: approve ? 'Принять заявку?' : 'Отклонить заявку?',
      lines: [['Ребёнок', a.child_name], ['Родитель', a.parent_name], ['Тариф', a.camp_tariffs?.name]],
      note: approve ? 'Ребёнок будет записан на сбор, родитель получит уведомление (если они включены).' : 'Родитель получит уведомление о решении (если они включены).',
      confirmLabel: approve ? 'Принять заявку' : 'Отклонить заявку',
      danger: !approve,
    });
    if (!ok) return;
    setBusy(a.id);
    setMsg(null);
    const r = await supabase.rpc('camp_application_decide', { aid: a.id, approve, note: (notes[a.id] ?? '').trim() || null });
    setBusy(null);
    if (r.error) return setMsg(campErr(r.error.message));
    setApps(null);
    setReload(n => n + 1);
  };

  if (!apps) return msg ? <p className="error">{msg}</p> : <Loading />;
  return (
    <>
      {dialog}
      {msg && <p className="error">{msg}</p>}
      {apps.length === 0 ? <EmptyState icon="users" title="Заявок нет" text="Гостевые заявки появятся здесь." /> : apps.map(a => (
        <div className="ks-card" key={a.id} data-testid="application">
          <div className="ks-line"><b style={{ overflowWrap: 'anywhere' }}>{a.child_name}</b><Pill tone={a.status === 'new' ? 'warning' : a.status === 'approved' ? 'success' : 'neutral'}>{APP_STATUS[a.status]}</Pill></div>
          <p className="muted" style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>
            Родился {fmtDate(a.child_birth)} · {a.parent_name} · {a.parent_phone} · {a.camp_tariffs?.name ?? 'без тарифа'} · {when(a.created_at)}
          </p>
          {a.comment && <p style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>Комментарий: {a.comment}</p>}
          {a.decision_note && <p className="muted" style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>Решение: {a.decision_note}</p>}
          {a.status === 'new' && (
            <>
              <label className="field">Комментарий к решению<input value={notes[a.id] ?? ''} maxLength={500} onChange={e => setNotes({ ...notes, [a.id]: e.target.value })} /></label>
              <div className="two">
                <button type="button" className="ks-btn" disabled={busy === a.id} onClick={() => void decide(a, true)}>Принять</button>
                <button type="button" className="ks-btn secondary" disabled={busy === a.id} onClick={() => void decide(a, false)}>Отклонить</button>
              </div>
            </>
          )}
        </div>
      ))}
    </>
  );
}

// ===== Настройки: лимит, ссылка, условия отмены (44-45) =====
interface Period { from: string; to: string; text: string }

export function CampSettings({ camp, onPatched }: { camp: CampLite; onPatched: (p: Partial<CampLite>) => void }) {
  const [cap, setCap] = useState(camp.capacity === null ? '' : String(camp.capacity));
  const [slug, setSlug] = useState(camp.slug ?? '');
  const [seats, setSeats] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [rows, setRows] = useState<Period[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [termsMsg, setTermsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSeats = useCallback(() => {
    void supabase.rpc('camp_seats', { cid: camp.id }).then(r => setSeats(r.error || r.data === null || r.data === undefined ? null : Number(r.data)));
  }, [camp.id]);
  useEffect(() => { loadSeats(); }, [loadSeats]);
  useEffect(() => {
    void supabase.from('camp_cancel_terms').select('version, periods').eq('camp_id', camp.id).order('version', { ascending: false }).limit(1).then(r => {
      const t = ((r.data ?? []) as { version: number; periods: { from: string | null; to: string | null; text: string }[] }[])[0];
      if (t) {
        setVersion(t.version);
        setRows(t.periods.map(p => ({ from: p.from ?? '', to: p.to ?? '', text: p.text })));
      }
      setLoaded(true);
    });
  }, [camp.id]);

  const capNum = cap.trim() === '' ? null : Number(cap);
  const capOk = capNum === null || (Number.isInteger(capNum) && capNum >= 1);
  const slugClean = slug.trim().toLowerCase();

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('camp_set_public', { cid: camp.id, sl: slugClean, cap: capNum });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: campErr(r.error.message) });
    setMsg({ ok: true, text: 'Настройки сохранены.' });
    onPatched({ capacity: capNum, slug: slugClean || null });
    loadSeats();
  };

  const saveTerms = async () => {
    setBusy(true);
    setTermsMsg(null);
    const r = await supabase.rpc('camp_terms_save', { cid: camp.id, periods: rows.map(p => ({ from: p.from || null, to: p.to || null, text: p.text.trim() })) });
    setBusy(false);
    if (r.error) return setTermsMsg({ ok: false, text: campErr(r.error.message) });
    setVersion(Number(r.data));
    setTermsMsg({ ok: true, text: `Условия сохранены, версия ${String(r.data)}.` });
  };
  const setRow = (i: number, patch: Partial<Period>) => setRows(rows.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const termsOk = rows.length > 0 && rows.every(p => p.text.trim() !== '' && !(p.from && p.to && p.to < p.from));

  return (
    <>
      <h3>Места и ссылка</h3>
      <label className="field">Лимит мест<input type="number" inputMode="numeric" min={1} step={1} value={cap} onChange={e => setCap(e.target.value)} /></label>
      <p className="muted" style={{ margin: '4px 0' }}>Пусто: без лимита.</p>
      {seats !== null && capNum !== null && <p className="muted" style={{ margin: '4px 0' }}>{`Свободно мест: ${seats}`}</p>}
      <label className="field">Имя ссылки<input value={slug} maxLength={60} placeholder="например, zima-2027" onChange={e => setSlug(e.target.value)} /></label>
      {slugClean && <p className="muted" style={{ overflowWrap: 'anywhere' }}>Публичная ссылка:<br /><span>{`https://t.me/kicksapp?startapp=camp_${slugClean}`}</span></p>}
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
      <button type="button" className="ks-btn" disabled={busy || !capOk} onClick={() => void save()}>Сохранить настройки</button>

      <h3>Условия отмены</h3>
      <p className="muted" style={{ margin: '4px 0' }}>{version === null ? (loaded ? 'Условия ещё не заданы.' : '') : `Версия условий: ${version}`}</p>
      {rows.map((p, i) => (
        <div className="ks-card" key={i}>
          <div className="two">
            <label className="field">С<input type="date" aria-label="Период с" value={p.from} onChange={e => setRow(i, { from: e.target.value })} /></label>
            <label className="field">По<input type="date" aria-label="Период по" value={p.to} min={p.from || undefined} onChange={e => setRow(i, { to: e.target.value })} /></label>
          </div>
          <label className="field">Текст периода<textarea aria-label="Текст периода" rows={2} maxLength={500} value={p.text} onChange={e => setRow(i, { text: e.target.value })} /></label>
          <button type="button" className="ks-btn secondary" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Убрать период</button>
        </div>
      ))}
      <button type="button" className="ks-btn secondary" disabled={rows.length >= 10} onClick={() => setRows([...rows, { from: '', to: '', text: '' }])}>Добавить период</button>
      {termsMsg && <p className={termsMsg.ok ? 'muted' : 'error'}>{termsMsg.text}</p>}
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn" disabled={busy || !termsOk} onClick={() => void saveTerms()}>Сохранить условия</button>
    </>
  );
}

// ===== Документы (46) =====
interface Doc { id: string; doc_id: string; title: string; version: number; status: 'pending' | 'ready' | 'failed'; size_bytes: number; created_at: string; ready_at: string | null; removed_at: string | null }
const DOC_STATUS: Record<Doc['status'], string> = { ready: 'опубликован', pending: 'загружается', failed: 'не загружен' };
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

export function CampDocuments({ camp }: { camp: CampLite }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<Doc | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void supabase.rpc('camp_document_admin_list', { cid: camp.id }).then(r => {
      if (r.error) return setMsg({ ok: false, text: campErr(r.error.message) });
      setDocs((r.data ?? []) as Doc[]);
    });
  }, [camp.id, reload]);

  // «Последняя» версия цепочки: ей доступны замена и снятие
  const latest = (d: Doc) => !d.removed_at && d.status === 'ready' && !(docs ?? []).some(x => x.doc_id === d.doc_id && x.status === 'ready' && x.version > d.version);

  const pick = (f: File | undefined) => {
    setFile(f ?? null);
    setFileErr(f ? checkPdfFile(f) : null);
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const r = await uploadCampDoc({ camp: camp.id, title: replacing ? replacing.title : title, replaces: replacing?.id, file });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: campErr(r.error) });
    setMsg({ ok: true, text: 'Документ загружен.' });
    setTitle('');
    setFile(null);
    setReplacing(null);
    setInputKey(k => k + 1);
    setDocs(null);
    setReload(n => n + 1);
  };
  const [fallback, setFallback] = useState<string | null>(null);
  const remove = async (d: Doc) => {
    const ok = await ask({ title: 'Снять документ?', lines: [['Документ', d.title], ['Версия', String(d.version)]], note: 'Документ исчезнет у участников вместе со всеми версиями. В истории он останется.', confirmLabel: 'Снять документ', danger: true });
    if (!ok) return;
    const r = await supabase.rpc('camp_document_remove', { did: d.id });
    if (r.error) return setMsg({ ok: false, text: campErr(r.error.message) });
    setDocs(null);
    setReload(n => n + 1);
  };
  const open = async (d: Doc) => {
    setMsg(null);
    setFallback(null);
    const r = await openCampDoc(d.id);
    if (!r.ok) return setMsg({ ok: false, text: campErr(r.error) });
    setFallback(r.fallbackUrl);
  };

  return (
    <>
      {dialog}
      <p className="muted" style={{ margin: '10px 0' }}>PDF до 10 МБ. Участники видят только последнюю версию и только пока они подтверждены на сборе.</p>
      {!docs ? <Loading /> : docs.length === 0 ? <EmptyState icon="users" title="Документов нет" text="Загрузите первый документ ниже." /> : docs.map(d => (
        <div className="ks-card" key={d.id}>
          <ListRow title={d.title} sub={[`версия ${d.version}`, d.removed_at ? 'снят' : DOC_STATUS[d.status], kb(d.size_bytes), when(d.created_at)]} />
          <div className="two">
            {d.status === 'ready' && <button type="button" className="ks-btn secondary" onClick={() => void open(d)}>Открыть</button>}
            {latest(d) && <button type="button" className="ks-btn secondary" onClick={() => { setReplacing(d); setMsg(null); }}>Заменить</button>}
            {latest(d) && <button type="button" className="ks-btn secondary" onClick={() => void remove(d)}>Снять</button>}
          </div>
        </div>
      ))}
      <h3>{replacing ? `Новая версия: ${replacing.title}` : 'Новый документ'}</h3>
      {replacing ? <button type="button" className="ks-btn secondary" onClick={() => setReplacing(null)}>Отменить замену</button> : (
        <label className="field">Название документа<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
      )}
      <label className="field">Файл PDF<input key={inputKey} type="file" accept="application/pdf,.pdf" onChange={e => pick(e.target.files?.[0])} /></label>
      {fileErr && <p className="error">{fileErr}</p>}
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
      {fallback && <p><a href={fallback} target="_blank" rel="noopener">Открыть файл</a></p>}
      <button type="button" className="ks-btn" disabled={busy || !file || !!fileErr || (!replacing && !title.trim())} onClick={() => void upload()}>{replacing ? 'Загрузить новую версию' : 'Загрузить'}</button>
    </>
  );
}

// ===== Рассылки (47) =====
type Kind = 'info' | 'reminder';
interface Preview { recipients: number; messages: number; list: { name: string }[]; blocked: { name: string; reason: string }[]; sample: string | null; token: string; unreachable: number | null; enabled: boolean }
interface Entry { id: string; kind: Kind; body: string | null; recipients: number; author_name: string | null; created_at: string; pending: number; sent: number; failed: number; cleared: number }
interface Result { name: string; state: 'pending' | 'sent' | 'failed' | 'cleared'; error: string | null }
const KIND: Record<Kind, string> = { info: 'Информационная', reminder: 'Напоминание об оплате' };
const BLOCKED: Record<string, string> = { notifications_off: 'выключены уведомления бота', daily_limit: 'уже три сообщения рассылок за сутки' };
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'получателю' : 'получателям');
const resultText = (r: Result) => (r.state === 'sent' ? 'отправлено' : r.state === 'failed' ? `не доставлено${r.error ? ` (${r.error})` : ''}` : r.state === 'pending' ? 'ждёт отправки' : 'очищено из очереди');

export function CampBroadcasts({ camp }: { camp: CampLite }) {
  const [kind, setKind] = useState<Kind>('info');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [journal, setJournal] = useState<Entry[] | null>(null);
  const [results, setResults] = useState<Record<string, Result[]>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void supabase.rpc('camp_broadcast_list', { cid: camp.id }).then(r => {
      if (r.error) return setMsg({ ok: false, text: campErr(r.error.message) });
      setJournal((r.data ?? []) as Entry[]);
    });
  }, [camp.id, reload]);

  const body = text.trim() || null;
  const edit = (f: () => void) => { f(); setPreview(null); setMsg(null); };

  const doPreview = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('camp_broadcast_preview', { cid: camp.id, k: kind, b: body });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: campErr(r.error.message) });
    setPreview(r.data as Preview);
  };
  const send = async () => {
    if (!preview) return;
    const ok = await ask({
      title: 'Отправить рассылку?',
      lines: [['Сбор', camp.name], ['Вид', KIND[kind]], ['Сообщений', String(preview.recipients)]],
      note: 'Сообщения уйдут сразу. Отменить рассылку после отправки нельзя.',
      confirmLabel: 'Отправить',
    });
    if (!ok) return;
    setBusy(true);
    const r = await supabase.rpc('camp_broadcast_send', { cid: camp.id, k: kind, b: body, expected: preview.recipients, tok: preview.token });
    setBusy(false);
    setPreview(null);
    if (r.error) return setMsg({ ok: false, text: campErr(r.error.message) });
    setMsg({ ok: true, text: `Рассылка поставлена в очередь: ${(r.data as { recipients: number }).recipients}.` });
    setJournal(null);
    setReload(n => n + 1);
  };
  const showResult = async (id: string) => {
    if (results[id]) return setResults(({ [id]: _, ...rest }) => rest);
    const r = await supabase.rpc('camp_broadcast_recipients', { bid: id });
    if (r.error) return setMsg({ ok: false, text: campErr(r.error.message) });
    setResults({ ...results, [id]: (r.data ?? []) as Result[] });
  };

  return (
    <>
      {dialog}
      <p className="muted" style={{ margin: '10px 0' }}>Рассылка уходит только после предпросмотра и вашего подтверждения. Каждый родитель получает своё сообщение, недоступного родителя другим членом семьи не заменяют.</p>
      <Segmented label="Вид рассылки" value={kind} onChange={v => edit(() => setKind(v))} items={[{ value: 'info', label: KIND.info }, { value: 'reminder', label: KIND.reminder }]} />
      <label className="field">Текст рассылки<textarea rows={4} maxLength={1000} value={text} placeholder={kind === 'reminder' ? 'Необязательно: добавится к напоминанию' : 'Сообщение родителям клуба'} onChange={e => edit(() => setText(e.target.value))} /></label>
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
      <button type="button" className="ks-btn secondary" disabled={busy || (kind === 'info' && !text.trim())} onClick={() => void doPreview()}>Предпросмотр</button>
      {preview && (
        <div className="ks-card" style={{ marginTop: 10 }}>
          <b>{`Получателей: ${preview.recipients}`}</b>
          {preview.sample && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '8px 0' }}>{preview.sample}</pre>}
          {preview.recipients > 0 && (
            <>
              <p className="muted" style={{ margin: '4px 0' }}>Список получателей</p>
              <ul aria-label="Получатели" style={{ margin: 0, paddingLeft: 18 }}>{preview.list.map((p, i) => <li key={i}>{p.name}</li>)}</ul>
            </>
          )}
          {preview.blocked.length > 0 && (
            <>
              <p className="muted" style={{ margin: '8px 0 4px' }}>Не получат сообщение (другим членом семьи не заменяются)</p>
              <ul aria-label="Не получат сообщение" style={{ margin: 0, paddingLeft: 18 }}>{preview.blocked.map((p, i) => <li key={i}>{`${p.name}: ${BLOCKED[p.reason] ?? p.reason}`}</li>)}</ul>
            </>
          )}
          {preview.unreachable !== null && preview.unreachable > 0 && <p className="muted">{`Должников, до которых рассылка не дойдёт: ${preview.unreachable}`}</p>}
          {!preview.enabled && <p className="error">Уведомления по сборам выключены. Отправка недоступна, пока их не включит владелец.</p>}
          {preview.enabled && preview.recipients === 0 && <p className="muted">Получателей нет, отправлять некому.</p>}
          {preview.enabled && preview.recipients > 0 && (
            <button type="button" className="ks-btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => void send()}>{`Отправить ${preview.recipients} ${plural(preview.recipients)}`}</button>
          )}
        </div>
      )}

      <h3>Журнал рассылок</h3>
      {!journal ? <Loading /> : journal.length === 0 ? <p className="muted">Рассылок ещё не было.</p> : journal.map(e => (
        <div className="ks-card" key={e.id}>
          <div className="ks-line"><b>{KIND[e.kind]}</b><span className="muted">{when(e.created_at)}{e.author_name ? ` · ${e.author_name}` : ''}</span></div>
          {e.body && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '6px 0' }}>{e.body}</p>}
          <p className="muted" style={{ margin: '4px 0' }}>{`Получателей ${e.recipients}: ждёт ${e.pending}, отправлено ${e.sent}, не доставлено ${e.failed}, очищено ${e.cleared}`}</p>
          <button type="button" className="ks-btn secondary" onClick={() => void showResult(e.id)}>Результат</button>
          {results[e.id] && <ul aria-label="Результат по получателям" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{results[e.id].map((r, i) => <li key={i}>{`${r.name}: ${resultText(r)}`}</li>)}</ul>}
        </div>
      ))}
    </>
  );
}

