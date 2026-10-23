import { useState } from 'react';
import { CONSENT, CONSENT_VERSION, type Lang } from '../lib/consent';
import { preferredLang } from '../lib/telegram';
import { BackNav } from '../ui/nav';

// Политика конфиденциальности: тот же текст, что и в согласии (lib/consent.ts), на отдельном экране.
// ЧЕРНОВИК: юридическую проверку текст не проходил, юристу стоит проверить его до запуска для родителей.
export default function Privacy({ onBack }: { onBack: () => void }) {
  const [lang, setLang] = useState<Lang>(preferredLang());
  const c = CONSENT[lang];
  return (
    <section className="card">
      <BackNav onBack={onBack} />
      <div className="row">
        <h2>{lang === 'ru' ? 'Политика конфиденциальности' : 'Privacy Policy'}</h2>
        <button type="button" className="lang" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
          {lang === 'ru' ? 'EN' : 'RU'}
        </button>
      </div>
      <p className="muted">FC KickStart Tbilisi · {c.title}</p>
      <ul className="policy">
        {c.points.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      <p className="muted">
        {lang === 'ru' ? 'Черновик, не прошёл юридическую проверку.' : 'Draft, not yet reviewed by a lawyer.'} {CONSENT_VERSION}
      </p>
    </section>
  );
}
