import { useEffect, useRef, useState } from 'react';
import { Photo, usePhoto } from '../lib/photos';

/** Фото на весь экран: закрытие по нажатию на фон, крестику или Esc; листание стрелками и свайпом. */
export function Lightbox({ keys, start = 0, alt, onClose }: { keys: string[]; start?: number; alt: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const touch = useRef<number | null>(null);
  const src = usePhoto(keys[i]);
  const go = (d: number) => setI(n => (n + d + keys.length) % keys.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (keys.length > 1 && e.key === 'ArrowRight') go(1);
      else if (keys.length > 1 && e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      className="ks-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      onTouchStart={e => (touch.current = e.touches[0].clientX)}
      onTouchEnd={e => {
        const x0 = touch.current;
        touch.current = null;
        if (x0 == null || keys.length < 2) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <img src={src} alt={alt} onClick={e => e.stopPropagation()} />
      <button type="button" className="ks-lb-close" aria-label="Закрыть" onClick={onClose}>×</button>
      {keys.length > 1 && (
        <>
          <button type="button" className="ks-lb-nav prev" aria-label="Предыдущее фото" onClick={e => (e.stopPropagation(), go(-1))}>‹</button>
          <button type="button" className="ks-lb-nav next" aria-label="Следующее фото" onClick={e => (e.stopPropagation(), go(1))}>›</button>
          <span className="ks-lb-count">{i + 1} / {keys.length}</span>
        </>
      )}
    </div>
  );
}

/** Ряд фото: нажатие открывает просмотр на весь экран с листанием по всем фото ряда. */
export function Gallery({ keys, alt, className }: { keys: string[]; alt: string; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className={className} aria-label="Фото">
        {keys.map((k, n) => (
          <button key={k} type="button" className="ks-zoom" aria-label={`Открыть фото: ${alt}`} onClick={() => setOpen(n)}>
            <Photo name={k} alt={alt} />
          </button>
        ))}
      </div>
      {open !== null && <Lightbox keys={keys} start={open} alt={alt} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Одиночное фото с открытием на весь экран. */
export function ZoomPhoto({ name, alt, className }: { name: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ks-zoom block" aria-label={`Открыть фото: ${alt}`} onClick={() => setOpen(true)}>
        <Photo name={name} alt={alt} className={className} />
      </button>
      {open && <Lightbox keys={[name]} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
