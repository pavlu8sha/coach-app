// UI-kit Mini App: React-компоненты по образцу приложения тренеров. Пока не используются экранами —
// подключение по шагам из docs/MINIAPP_UI_PLAN.md. Стили — ui/tokens.css и ui/kit.css.
import type { ReactNode } from 'react';

export type Tone = 'success' | 'danger' | 'warning' | 'primary' | 'neutral';

/** Пилюля статуса. Смысл передаёт текст; цвет и точка — дополнительный признак. */
export function Pill({ tone = 'neutral', dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return <span className={`ks-pill ${tone === 'neutral' ? '' : tone}${dot ? ' dot' : ''}`}>{children}</span>;
}

/** Инициалы из ФИ: «Amodeo Nolan» → «AN». */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={`ks-avatar${large ? ' lg' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Строка списка: аватар, заголовок, подписи, статус справа, стрелка. С onClick — кнопка. */
export function ListRow(props: { title: string; sub?: ReactNode[]; avatar?: string; end?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      {props.avatar !== undefined && <Avatar name={props.avatar} />}
      <span className="ks-row-main">
        <span className="ks-row-title">{props.title}</span>
        {props.sub?.map((s, i) => (
          <span className="ks-row-sub" key={i}>
            {s}
          </span>
        ))}
      </span>
      {(props.end || props.onClick) && (
        <span className="ks-row-end">
          {props.end}
          {props.onClick && <span className="ks-chev" aria-hidden="true" />}
        </span>
      )}
    </>
  );
  return props.onClick ? (
    <button type="button" className="ks-row" onClick={props.onClick}>
      {inner}
    </button>
  ) : (
    <div className="ks-row">{inner}</div>
  );
}

/** Сегментный переключатель (вкладки). */
export function Segmented<T extends string>(props: { value: T; items: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ks-seg" role="tablist" aria-label={props.label}>
      {props.items.map(it => (
        <button key={it.value} type="button" role="tab" aria-selected={it.value === props.value} onClick={() => props.onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Тумблер в строке с подписью (например, «Только не оплатившие»). */
export function SwitchRow(props: { label: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <div className="ks-switch-row">
      <span id={props.id + '-l'}>{props.label}</span>
      <button type="button" className="ks-switch" role="switch" aria-checked={props.checked} aria-labelledby={props.id + '-l'} onClick={() => props.onChange(!props.checked)}>
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

const SEARCH_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

/** Поле поиска со значком. */
export function SearchInput(props: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="ks-search">
      {SEARCH_ICON}
      <input className="ks-input" value={props.value} placeholder={props.placeholder} aria-label={props.label} onChange={e => props.onChange(e.target.value)} />
    </div>
  );
}

/** Скелетон списка на время загрузки. */
export function SkeletonRows({ count = 4, avatar = true }: { count?: number; avatar?: boolean }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="ks-skel" key={i}>
          {avatar && <i className="av" />}
          <span className="t">
            <i style={{ width: '60%' }} />
            <i style={{ width: '40%' }} />
          </span>
        </div>
      ))}
    </div>
  );
}

const ICONS: Record<'users' | 'box' | 'search' | 'alert' | 'trophy', ReactNode> = {
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  box: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
};

/** Пустое состояние / ошибка загрузки с действием («Повторить», «Сбросить фильтры»). */
export function EmptyState(props: { icon: keyof typeof ICONS; title: string; text?: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="ks-empty" role="status">
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[props.icon]}
      </svg>
      <b>{props.title}</b>
      {props.text && <p>{props.text}</p>}
      {props.action && (
        <button type="button" className="ks-btn" onClick={props.action.run}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}

const NAV_ICONS = {
  child: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  trophy: ICONS.trophy,
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h14v2" />
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M16 14h2" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
    </>
  ),
  users: ICONS.users,
};

/** Нижняя навигация: иконка и подпись, текущий раздел — aria-current. Закреплена внизу с учётом безопасной зоны. */
export function BottomNav<T extends string>(props: { value: T; items: { value: T; label: string; icon: keyof typeof NAV_ICONS }[]; onChange: (v: T) => void; label: string }) {
  return (
    <nav className="ks-bottomnav" aria-label={props.label}>
      <div>
        {props.items.map(it => (
          <button key={it.value} type="button" aria-current={it.value === props.value ? 'page' : undefined} onClick={() => props.onChange(it.value)}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {NAV_ICONS[it.icon]}
            </svg>
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/** Кнопка «Назад» на вложенном экране. */
export function BackButton(props: { onClick: () => void }) {
  return (
    <button type="button" className="ks-back" onClick={props.onClick}>
      <span className="ks-chev back" aria-hidden="true" />
      Назад
    </button>
  );
}
