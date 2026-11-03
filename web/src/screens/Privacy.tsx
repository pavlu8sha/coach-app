import { CONSENT, CONSENT_VERSION } from '../lib/consent';
import { preferredLang } from '../lib/telegram';
import { BackNav } from '../ui/nav';

// Правила обработки персональных данных: текст юриста клуба (lib/consent.ts), на отдельном экране.
export default function Privacy({ onBack }: { onBack: () => void }) {
  const c = CONSENT[preferredLang()];
  return (
    <section className="ks-card policy-doc">
      <BackNav onBack={onBack} />
      <h1>Политика конфиденциальности</h1>
      <p className="muted">FC Kickstart · {c.title}</p>
      {c.intro.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      {c.sections.map(sec => (
        <div key={sec.h}>
          <h2 className="ks-sub">{sec.h}</h2>
          {sec.blocks.map((b, i) =>
            typeof b === 'string' ? (
              <p key={i}>{b}</p>
            ) : (
              <ul key={i} className="policy">
                {b.map((t, j) => (
                  <li key={j}>{t}</li>
                ))}
              </ul>
            ),
          )}
        </div>
      ))}
      <p className="muted">{CONSENT_VERSION}</p>
    </section>
  );
}
