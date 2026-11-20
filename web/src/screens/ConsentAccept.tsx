import { useState } from 'react';
import { useNav, useSubEntry } from '../nav';
import { errMsg } from '../lib/coach';
import type { PendingConsent } from '../lib/linkRequests';
import { supabase } from '../lib/supabase';
import { Avatar } from '../ui/components';
import { useMainButton } from '../ui/nav';
import Privacy from './Privacy';

// Запрос подтверждён, но доступ к ребёнку открывается только после согласия родителя на обработку данных (новая модель согласий, #238).
// Принять согласие может только сам родитель: accept_consent(ребёнок, тип, версия). Текст правил открывается по ссылке (экран Privacy).
export default function ConsentAccept({ items, onDone }: { items: PendingConsent[]; onDone: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNav();
  const policy = Boolean(useSubEntry('policy')); // политика — запись стека: галочка остаётся
  const names = items.map(i => i.full_name).join(', ');

  const accept = async () => {
    if (!agreed || busy) return;
    setError(null);
    setBusy(true);
    try {
      // по каждому ребёнку; первый сбой останавливает, принятое остаётся принятым, повтор безопасен
      for (const i of items) {
        const r = await supabase.rpc('accept_consent', { p: i.player_id, t: 'data_processing', ver: i.version_id });
        if (r.error) return setError(errMsg(r.error));
      }
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const native = useMainButton({ text: 'Принять согласие', visible: agreed && !policy, enabled: !busy, loading: busy, onClick: () => void accept() });

  if (policy) return <Privacy onBack={() => nav.back()} />;
  return (
    <main className="page">
      <div className="ks-state">
        <h1>Примите согласие</h1>
        <p className="muted">Администратор подтвердил запрос. Чтобы {items.length > 1 ? 'детей' : 'ребёнка'} можно было увидеть в приложении, нужно ваше согласие на обработку данных.</p>
      </div>
      {items.map(i => (
        <div className="ks-row" key={i.player_id}>
          <Avatar name={i.full_name} />
          <span className="ks-row-main">
            <span className="ks-row-title">{i.full_name}</span>
            {i.group_name && <span className="ks-row-sub">{i.group_name}</span>}
          </span>
        </div>
      ))}
      <div className="ks-consent">
        <label className="check agree">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} aria-label={`Согласие на обработку данных: ${names}`} />
          <span>
            Я соглашаюсь с{' '}
            <button type="button" className="link-btn" onClick={() => nav.push('policy')}>правилами обработки персональных данных</button>
            {' '}и даю согласие на обработку данных {items.length > 1 ? 'детей' : 'ребёнка'}.
          </span>
        </label>
        {!agreed && <p className="muted note">Отметьте согласие, чтобы продолжить.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!native && (
          <button type="button" className="ks-btn" style={{ marginTop: 12 }} disabled={busy || !agreed} onClick={() => void accept()}>
            {busy ? 'Принимаю…' : 'Принять согласие'}
          </button>
        )}
      </div>
    </main>
  );
}
