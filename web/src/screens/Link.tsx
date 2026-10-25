import { useCallback, useEffect, useRef, useState } from 'react';
import { CONSENT, CONSENT_VERSION } from '../lib/consent';
import Privacy from './Privacy';
import { supabase } from '../lib/supabase';
import { preferredLang } from '../lib/telegram';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { useMainButton } from '../ui/nav';
import { STATUS, type Req } from './LinkStatus';

interface Found { player_id: string; full_name: string; group_name: string | null }
// Родитель ищет ребёнка по имени и отправляет запрос; связь создаёт администратор.
const MIN = 3; // функция поиска в базе ищет от 3 букв
const LIMIT = 5; // и отдаёт не больше 5 детей

// Ошибки базы и сети — человеческим языком; технический текст родителю не показываем
const linkError = (m: string) =>
  m.includes('consent') ? 'Нужно согласие. Отметьте его ниже.'
  : m.includes('too many') ? 'Слишком много неподтверждённых запросов. Дождитесь ответа администратора клуба.'
  : m.includes('player not found') ? 'Этого ребёнка больше нет в списке. Обновите поиск.'
  : m.includes('not authenticated') ? 'Сессия закончилась. Закройте приложение и откройте снова.'
  : /fetch|network|failed to load|timeout/i.test(m) ? 'Нет связи. Проверьте интернет и попробуйте ещё раз.'
  : m.includes('Could not find the function') || m.includes('schema cache') ? 'Это действие пока недоступно.'
  : m;

// Родитель ищет ребёнка по имени, выбирает его, соглашается и отправляет запрос; связь создаёт администратор.
export default function Link({ onApproved, onOpenStatus }: { onApproved?: () => void; onOpenStatus?: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const notified = useRef(false); // «подтверждено» сообщаем родителю экрана один раз, иначе обновление зацикливается
  const c = CONSENT[preferredLang()];

  const loadReqs = useCallback(async () => {
    const me = (await supabase.auth.getUser()).data.user?.id;
    if (!me) return;
    // только свои запросы: администратору RLS отдаёт чужие, они показываются во вкладке «Запросы»
    const r = await supabase.from('link_requests').select('id, status, players(full_name)').eq('user_id', me).order('created_at', { ascending: false });
    if (r.error) return setError(linkError(r.error.message));
    const rows = (r.data ?? []) as unknown as Req[];
    setReqs(rows);
    if (!notified.current && rows.some(x => x.status === 'approved')) {
      notified.current = true;
      onApproved?.();
    }
  }, [onApproved]);

  useEffect(() => {
    void loadReqs();
  }, [loadReqs]);

  const short = q.trim().length < MIN;

  const search = async () => {
    if (short) return;
    setError(null);
    setSelected(null);
    setBusy(true);
    const r = await supabase.rpc('search_players_for_link', { q });
    setBusy(false);
    if (r.error) return setError(linkError(r.error.message));
    setFound((r.data ?? []) as Found[]);
  };

  const request = async (id: string) => {
    setError(null);
    setBusy(true);
    const r = await supabase.rpc('request_link', { p: id, consent: CONSENT_VERSION });
    setBusy(false);
    if (r.error) return setError(linkError(r.error.message));
    setFound(f => (f ?? []).filter(x => x.player_id !== id));
    setSelected(null);
    await loadReqs();
    onOpenStatus?.(); // показать статус только что отправленного запроса
  };

  const chosen = found?.find(f => f.player_id === selected) ?? null;
  // В Telegram запрос отправляет главная кнопка Telegram для выбранного ребёнка; в браузере — кнопка под списком
  const native = useMainButton({ text: 'Отправить запрос', visible: Boolean(chosen), enabled: agreed && !busy, loading: busy, onClick: () => selected && void request(selected) });

  if (policy) return <Privacy onBack={() => setPolicy(false)} />;

  return (
    <section className="ks-card">
      <h2>Добавить ребёнка</h2>
      <p className="muted">Введите фамилию или имя ребёнка. Администратор клуба подтвердит, что это ваш ребёнок.</p>
      <form
        className="search"
        onSubmit={e => {
          e.preventDefault();
          void search();
        }}
      >
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Фамилия Имя" autoComplete="off" aria-label="Фамилия или имя ребёнка" aria-describedby="link-hint" />
        <button className="ks-btn sm" disabled={busy || short}>
          Найти
        </button>
      </form>
      <p id="link-hint" className="muted note">{short && q.trim().length > 0 ? `Введите ещё ${MIN - q.trim().length} ${MIN - q.trim().length === 1 ? 'букву' : 'буквы'}: поиск начинается от ${MIN} букв.` : `Поиск начинается от ${MIN} букв.`}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {found && found.length === 0 && (
        <EmptyState icon="search" title="Ничего не найдено" text="Проверьте написание. Ребёнка, на которого уже отправлен запрос, в поиске нет: смотрите «Статус запросов». Если не получается, напишите администратору клуба." />
      )}
      {found && found.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="muted note" style={{ marginBottom: 8 }}>Выберите своего ребёнка:</p>
          {found.map(f => (
            <ListRow
              key={f.player_id}
              avatar={f.full_name}
              title={f.full_name}
              sub={[...(f.group_name ? [f.group_name] : []), ...(selected === f.player_id ? [<Pill tone="primary" dot>Выбрано</Pill>] : [])]}
              onClick={() => setSelected(f.player_id)}
            />
          ))}
          {found.length >= LIMIT && <p className="muted note">Показаны первые {LIMIT}. Нет нужного? Введите фамилию и имя полностью.</p>}
        </div>
      )}
      {chosen && (
        <div className="ks-consent">
          <p className="note">Запрос на привязку: <b>{chosen.full_name}</b></p>
          <label className="check agree">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            <span>
              {c.agree[0]}
              <button type="button" className="link-btn" onClick={() => setPolicy(true)}>
                {c.agree[1]}
              </button>
              {c.agree[2]}
            </span>
          </label>
          {!agreed && <p className="muted note">Отметьте согласие, чтобы отправить запрос.</p>}
          {!native && (
            <button type="button" className="ks-btn" style={{ marginTop: 12 }} disabled={busy || !agreed} onClick={() => void request(chosen.player_id)}>
              {busy ? 'Отправляю…' : 'Отправить запрос'}
            </button>
          )}
        </div>
      )}
      {reqs.length > 0 && onOpenStatus && (
        <div className="reqs">
          <ListRow
            title="Статус запросов"
            sub={[`Всего: ${reqs.length}`, ...(reqs.some(r => r.status === 'pending') ? [<Pill tone={STATUS.pending.tone} dot>{STATUS.pending.label}</Pill>] : [])]}
            onClick={onOpenStatus}
          />
        </div>
      )}
    </section>
  );
}
