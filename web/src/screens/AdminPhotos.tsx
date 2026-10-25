import { useRef, useState } from 'react';
import { PHOTO_SLOTS, resetPhoto, savePhoto, shrinkImage, usePhoto } from '../lib/photos';

function Slot({ k, label }: { k: string; label: string }) {
  const src = usePhoto(k);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const r = await shrinkImage(file);
    const err = 'error' in r ? r.error : await savePhoto(k, r.dataUrl);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Фото заменено.' });
    if (input.current) input.current.value = '';
  };
  const reset = async () => {
    setBusy(true);
    setMsg(null);
    const err = await resetPhoto(k);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Возвращено исходное фото.' });
  };

  return (
    <div className="ks-card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <img src={src} alt={label} loading="lazy" style={{ width: 84, height: 64, objectFit: 'cover', borderRadius: 10, flex: 'none', background: 'var(--ks-surface-2, #eee)' }} />
      <span className="ks-row-main">
        <span className="ks-row-title">{label}</span>
        <span style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <button type="button" className="ks-btn secondary sm" style={{ width: 'auto' }} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Загружаю…' : 'Заменить'}
          </button>
          <button type="button" className="ks-btn secondary sm" style={{ width: 'auto' }} disabled={busy} onClick={() => void reset()} aria-label={`Вернуть исходное: ${label}`}>
            Вернуть исходное
          </button>
        </span>
        {msg && <span className={msg.ok ? 'muted note' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}
        <input ref={input} type="file" accept="image/*" hidden aria-label={`Файл фото: ${label}`} onChange={e => void pick(e.target.files?.[0])} />
      </span>
    </div>
  );
}

// «Ещё → Фото клуба»: администратор заменяет любое фото в «О клубе» и в экипировке, не обновляя приложение.
export default function AdminPhotos() {
  const groups = [...new Set(PHOTO_SLOTS.map(s => s.group))];
  return (
    <main className="page">
      <h1>Фото клуба</h1>
      <p className="muted">Выберите фото, и оно сразу заменится у всех в разделах «О клубе» и «Экипировка». Подойдёт любое фото с телефона: оно будет уменьшено автоматически.</p>
      {groups.map(g => (
        <section key={g}>
          <p className="ks-label">{g}</p>
          {PHOTO_SLOTS.filter(s => s.group === g).map(s => <Slot key={s.key} k={s.key} label={s.label} />)}
        </section>
      ))}
    </main>
  );
}
