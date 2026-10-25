import type { ReactNode } from 'react';
import { usePhoto } from '../lib/photos';

export type CoverId = 'branches' | 'champ' | 'individual' | 'gk' | 'equipment' | 'camp' | 'channel';

// Нарисованные обложки разделов (пока без фотографий клуба): цвет раздела и крупный значок.
const ART: Record<CoverId, ReactNode> = {
  branches: (
    <>
      <rect x="8" y="14" width="84" height="72" rx="6" />
      <path d="M50 14v72" />
      <circle cx="50" cy="50" r="13" />
      <path d="M8 36h14v28H8M92 36H78v28h14" />
    </>
  ),
  champ: (
    <>
      <path d="M32 84h36M50 66v18M30 14h40v22a20 20 0 0 1-40 0z" />
      <path d="M70 20h16v8a12 12 0 0 1-12 12M30 20H14v8a12 12 0 0 0 12 12" />
    </>
  ),
  individual: (
    <>
      <circle cx="50" cy="50" r="38" />
      <circle cx="50" cy="50" r="24" />
      <circle cx="50" cy="50" r="9" />
      <path d="M50 4v14M50 82v14M4 50h14M82 50h14" />
    </>
  ),
  gk: (
    <path d="M26 56V28a6 6 0 0 1 12 0v22M38 48V18a6 6 0 0 1 12 0v30M50 48V22a6 6 0 0 1 12 0v30M62 48V30a6 6 0 0 1 12 0v32a28 28 0 0 1-28 28h-4a24 24 0 0 1-19-10L18 70a7 7 0 0 1 11-8l7 8" />
  ),
  equipment: <path d="M34 12 8 26l9 20 14-5v47h38V41l14 5 9-20-26-14a16 16 0 0 1-32 0z" />,
  channel: <path d="M92 10 44 58M92 10 62 90 44 58 10 40z" />,
  camp: (
    <>
      <circle cx="70" cy="30" r="12" />
      <path d="M4 84 32 40l16 22 14-18 34 40z" />
      <path d="M20 84h72" />
    </>
  ),
};

const COLORS: Record<CoverId, [string, string]> = {
  branches: ['#1e8a57', '#0e4f33'],
  champ: ['#c28a1f', '#7a4e0e'],
  individual: ['#3563e0', '#1b3a94'],
  gk: ['#e07a2a', '#a14510'],
  equipment: ['#34457a', '#141c33'],
  camp: ['#1f9cba', '#0f5c75'],
  channel: ['#2a8fd6', '#1a5f99'],
};

// Фото с тёмным градиентом снизу, чтобы белый текст читался
const withPhoto = (url: string) => `linear-gradient(to top, rgba(8,14,30,0.78), rgba(8,14,30,0.08) 70%), url(${url}) center / cover no-repeat`;

export const Art = ({ id, size = 96 }: { id: CoverId; size?: number }) => (
  <svg viewBox="0 0 100 100" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ART[id]}
  </svg>
);

/** Плитка раздела на хабе: цвет, крупный значок, название и короткая подпись. */
export function CoverTile({ id, title, sub, wide = false, onClick, href, photo: photoKey }: { id: CoverId; title: string; sub: string; wide?: boolean; onClick?: () => void; href?: string; photo?: string }) {
  const [a, b] = COLORS[id];
  const photo = usePhoto(photoKey);
  const cls = `ks-cover tile${wide ? ' wide' : ''}`;
  const style = { background: photo ? withPhoto(photo) : `linear-gradient(145deg, ${a}, ${b})` };
  const inner = (
    <>
      {!photo && <span className="art"><Art id={id} size={wide ? 120 : 92} /></span>}
      <span className="txt">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </>
  );
  // тайл-ссылка (внешний канал) или кнопка раздела
  return href ? (
    <a className={cls} style={style} href={href} target="_blank" rel="noreferrer">{inner}</a>
  ) : (
    <button type="button" className={cls} style={style} onClick={onClick}>{inner}</button>
  );
}

/** Шапка раздела: та же обложка, но во всю ширину. */
export function CoverBanner({ id, title, sub, photo: photoKey }: { id: CoverId; title: string; sub?: string; photo?: string }) {
  const [a, b] = COLORS[id];
  const photo = usePhoto(photoKey);
  return (
    <header className={`ks-cover banner${photo ? ' photo' : ''}`} style={{ background: photo ? withPhoto(photo) : `linear-gradient(145deg, ${a}, ${b})` }}>
      {!photo && <span className="art"><Art id={id} size={110} /></span>}
      <span className="txt">
        <h1>{title}</h1>
        {sub && <small>{sub}</small>}
      </span>
    </header>
  );
}
