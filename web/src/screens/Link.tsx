import { useCallback, useEffect, useRef, useState } from 'react';
import { CONSENT, CONSENT_VERSION } from '../lib/consent';
import { useNav, useSubEntry } from '../nav';
import Privacy from './Privacy';
import { supabase } from '../lib/supabase';
import { userError } from '../lib/userError';
import { preferredLang } from '../lib/telegram';
import { EmptyState, ListRow, Pill, searchFocusProps } from '../ui/components';
import { useMainButton } from '../ui/nav';
import { ADMIN_CHAT } from '../lib/clubInfo';
import { STATUS, type Req } from './LinkStatus';
import { loadMyLinkRequests } from '../lib/linkRequests';

interface Found { player_id: string; full_name: string; group_name: string | null }
/** Открыта ли политика поверх экрана с формой привязки (запись стека 'policy'). */
export const useLinkPolicyOpen = () => Boolean(useSubEntry('policy'));
/** Прячет остальное содержимое экрана, пока открыта политика: форма (поиск, согласие) остаётся смонтированной, видна только политика. */
export const HideWhen = ({ hide, children }: { hide: boolean; children: React.ReactNode }) => (
  <div style={{ display: hide ? 'none' : 'contents' }}>{children}</div>
);

// Родитель ищет ребёнка по имени и отправляет запрос; связь создаёт администратор.
const MIN = 3; // функция поиска в базе ищет от 3 букв
const LIMIT = 5; // и отдаёт не больше 5 детей

// Ожидаемые ошибки базы — человеческим языком; остальное (сеть, неизвестное) переводит userError, технический текст родителю не показываем
const linkKnown = (m: string): string | null =>
  m.includes('consent') ? 'Нужно согласие. Отметьте его ниже.'
  : m.includes('search limit') ? 'Слишком много поисков. Подождите несколько минут и попробуйте снова.'
  : m.includes('link request limit') ? 'Слишком много запросов и отмен за час. Попробуйте позже.'
  : m.includes('too many') ? 'Слишком много неподтверждённых запросов. Дождитесь ответа администратора клуба.'
  : m.includes('player not found') ? 'Этого ребёнка больше нет в списке. Обновите поиск.'
  : m.includes('not authenticated') ? 'Сессия закончилась. Закройте приложение и откройте снова.'
  : m.includes('Could not find the function') || m.includes('schema cache') ? 'Это действие пока недоступно.'
  : null;
const linkError = (e: unknown) => userError(e, linkKnown);

// Родитель ищет ребёнка по имени, выбирает его, соглашается и отправляет запрос; связь создаёт администратор.
export default function Link({ onApproved, onOpenStatus }: { onApproved?: () => void; onOpenStatus?: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [staleSent, setStaleSent] = useState(false); // запрос отправлен, а список статусов обновить не удалось (#761)
  const nav = useNav();
  const policy = Boolean(useSubEntry('policy')); // политика — запись стека: список и согласие остаются
  const [selected, setSelected] = useState<string | null>(null);
  const notified = useRef(false); // «подтверждено» сообщаем родителю экрана один раз, иначе обновление зацикливается
  const c = CONSENT[preferredLang()];

  // true: список запросов обновлён. report=false: после отправки сбой не выдаётся за ошибку самой отправки (#761), его показывает вызывающий
  const loadReqs = useCallback(async (report = true): Promise<boolean> => {
    try {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return false;
      const r = await loadMyLinkRequests(me); // имя ребёнка из my_link_requests() (0217), до подтверждения его нет в players
      if (r.error) {
        if (report) setError(linkError(r.error));
        return false;
      }
      const rows = (r.reqs ?? []) as Req[];
      setReqs(rows);
      if (!notified.current && rows.some(x => x.status === 'approved')) {
        notified.current = true;
        onApproved?.();
      }
      return true;
    } catch (e) {
      if (report) setError(linkError(e)); // отказ загрузки не остаётся необработанным
      return false;
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
    try {
      const r = await supabase.rpc('search_players_for_link', { q });
      if (r.error) return setError(linkError(r.error));
      setFound((r.data ?? []) as Found[]);
    } catch (e) {
      setError(linkError(e));
    } finally {
      setBusy(false);
    }
  };

  const request = async (id: string) => {
    setError(null);
    setStaleSent(false);
    setBusy(true);
    try {
      const r = await supabase.rpc('request_link', { p: id, consent: CONSENT_VERSION });
      if (r.error) return setError(linkError(r.error));
      setFound(f => (f ?? []).filter(x => x.player_id !== id));
      setSelected(null);
      if (!(await loadReqs(false))) return setStaleSent(true); // запрос ушёл, список не обновился: не открываем устаревший статус и не пугаем ошибкой отправки
      setStaleSent(false);
      onOpenStatus?.(); // показать статус только что отправленного запроса
    } catch (e) {
      setError(linkError(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterSend = async () => {
    setBusy(true);
    try {
      if (await loadReqs(false)) {
        setStaleSent(false);
        onOpenStatus?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const chosen = found?.find(f => f.player_id === selected) ?? null;
  // В Telegram запрос отправляет главная кнопка Telegram для выбранного ребёнка; в браузере — кнопка под списком
  const native = useMainButton({ text: 'Отправить запрос', visible: Boolean(chosen) && agreed, enabled: !busy, loading: busy, onClick: () => selected && void request(selected) });

  if (policy) return <Privacy onBack={() => nav.back()} />;

  return (
    <section className="ks-card">
      <h2>Добавить ребёнка</h2>
      <p className="muted">Введите фамилию и имя ребёнка латиницей, как в заявке клуба (например, Ivanov Max). Порядок слов не важен. Администратор клуба подтвердит, что это ваш ребёнок.</p>
      <form
        className="search"
        onSubmit={e => {
          e.preventDefault();
          void search();
        }}
      >
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ivanov Max" autoComplete="off" {...searchFocusProps} aria-label="Фамилия или имя ребёнка" aria-describedby="link-hint" />
        <button className="ks-btn sm" disabled={busy || short}>
          Найти
        </button>
      </form>
      <p id="link-hint" className="muted note">{short && q.trim().length > 0 ? `Введите ещё ${MIN - q.trim().length} ${MIN - q.trim().length === 1 ? 'букву' : 'буквы'}: поиск начинается от ${MIN} букв.` : `Поиск начинается от ${MIN} букв.`}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {staleSent && (
        <div className="note" role="status">
          <p>Запрос отправлен, но список статусов пока не обновился. Повторно отправлять не нужно.</p>
          <button type="button" className="ks-btn secondary sm" disabled={busy} onClick={() => void refreshAfterSend()}>
            Обновить статусы
          </button>
        </div>
      )}
      {error && found === null && !short && (
        <button type="button" className="ks-btn secondary sm" disabled={busy} onClick={() => void search()}>
          Повторить поиск
        </button>
      )}
      {found && found.length === 0 && (
        <EmptyState icon="search" title="Ничего не найдено" text="Проверьте написание: имя и фамилию лучше вводить латиницей, порядок слов не важен. Ребёнка, на которого уже отправлен запрос, в поиске нет: смотрите «Статус запросов». Если не получается, напишите администратору клуба." />
      )}
      {found && found.length === 0 && (
        <p className="note">
          <a href={ADMIN_CHAT} target="_blank" rel="noreferrer">Написать администратору клуба</a>
        </p>
      )}
      {found && found.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="muted note" style={{ marginBottom: 8 }}>Выберите своего ребёнка:</p>
          {found.map(f => (
            <ListRow
              key={f.player_id}
              avatar={f.full_name}
              title={f.full_name}
              sub={f.group_name ? [f.group_name] : []}
              selected={selected === f.player_id}
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
              <button type="button" className="link-btn" onClick={() => nav.push('policy')}>
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
