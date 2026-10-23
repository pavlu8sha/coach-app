import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Pill } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

interface Req { id: string; status: 'open' | 'done' | 'rejected'; created_at: string; note: string | null }

const unavailable = (m: string) => (m.includes('Could not find the function') || m.includes('schema cache') ? 'Это действие пока недоступно.' : m);
const fmt = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

// «Мои данные»: выгрузка своих данных одним файлом и запрос на удаление данных (обрабатывает администратор клуба).
export default function MyData({ onBack }: { onBack: () => void }) {
  const [req, setReq] = useState<Req | null | undefined>(undefined); // undefined — загрузка, null — запросов нет
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dump, setDump] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await supabase.from('data_requests').select('id, status, created_at, note').eq('kind', 'delete').order('created_at', { ascending: false }).limit(1);
      if (r.error) return setReq(null); // таблицы ещё нет (миграция не применена): блок удаления покажет «недоступно» при попытке
      setReq(((r.data ?? []) as Req[])[0] ?? null);
    })();
  }, [reload]);

  const exportData = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('export_my_data');
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: unavailable(r.error.message) });
    const text = JSON.stringify(r.data, null, 2);
    setDump(text);
    // скачивание файла; в некоторых версиях Telegram оно закрыто, поэтому ниже есть «Скопировать»
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kickstart-moi-dannye.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      /* остаётся «Скопировать» */
    }
    setMsg({ ok: true, text: 'Данные выгружены. Если файл не скачался, нажмите «Скопировать данные».' });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dump ?? '');
      setMsg({ ok: true, text: 'Скопировано.' });
    } catch {
      setMsg({ ok: false, text: 'Не удалось скопировать: выделите текст ниже и скопируйте вручную.' });
    }
  };
  const requestDelete = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('request_data_deletion');
    setBusy(false);
    setConfirm(false);
    if (r.error) return setMsg({ ok: false, text: r.error.message.includes('already open') ? 'Запрос уже отправлен и ждёт обработки.' : unavailable(r.error.message) });
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (req === undefined) return <Loading />;

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Мои данные</h1>

      <h3>Скачать</h3>
      <div className="ks-card">
        <p className="ks-muted" style={{ marginBottom: 10 }}>Ваши данные, данные ваших детей, которые вы видите в приложении, и отметки о согласии — одним файлом.</p>
        <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void exportData()}>Скачать мои данные</button>
        {dump && (
          <>
            <div style={{ height: 8 }} />
            <button type="button" className="ks-btn secondary" onClick={() => void copy()}>Скопировать данные</button>
            <textarea className="ks-input" readOnly rows={6} value={dump} style={{ marginTop: 8, fontSize: 12 }} aria-label="Выгруженные данные" />
          </>
        )}
      </div>
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}

      <h3>Удаление данных</h3>
      <div className="ks-card">
        {req?.status === 'open' ? (
          <>
            <Pill tone="warning" dot>Запрос отправлен {fmt(req.created_at)}</Pill>
            <p className="ks-muted" style={{ marginTop: 8 }}>Администратор клуба обработает его.</p>
          </>
        ) : (
          <>
            {req?.status === 'done' && <p className="ks-ok">Ваш прошлый запрос выполнен {fmt(req.created_at)}.</p>}
            {req?.status === 'rejected' && <p className="error">Прошлый запрос отклонён{req.note ? `: ${req.note}` : ''}. Вопросы — администратору клуба.</p>}
            <p className="ks-muted" style={{ margin: '8px 0 10px' }}>
              Администратор клуба удалит ваши данные в приложении: связи с детьми, запросы, отметки о согласии и имя. Данные самих игроков принадлежат клубу и этим запросом не удаляются.
            </p>
            {confirm ? (
              <>
                <p style={{ marginBottom: 10 }}>Отправить запрос на удаление данных? Вы потеряете доступ к детям в приложении.</p>
                <button type="button" className="ks-btn" disabled={busy} onClick={() => void requestDelete()}>Отправить запрос</button>
                <div style={{ height: 8 }} />
                <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setConfirm(false)}>Отмена</button>
              </>
            ) : (
              <button type="button" className="ks-btn secondary" onClick={() => setConfirm(true)}>Удалить мои данные</button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
