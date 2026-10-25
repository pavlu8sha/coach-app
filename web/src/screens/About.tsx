import type { ReactNode } from 'react';
import { ADMIN_CHAT, BRANCHES, CAMP, CHAMPIONSHIPS, CLUB_CHANNEL, EQUIPMENT, GOALKEEPERS, INDIVIDUAL, INSTALLMENT_CHAT } from '../lib/clubInfo';
import { Pill } from '../ui/components';
import type { Role } from './RoleSelect';
import TrialForm from './TrialForm';

export { CLUB_CHANNEL };

const I_PIN = <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>;
const I_CUP = <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>;
const I_TARGET = <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>;
const I_HAND = <><path d="M6 12V6a2 2 0 0 1 4 0v5M10 11V4a2 2 0 0 1 4 0v7M14 11V6a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2-4a2 2 0 0 1 3-2l2 2" /></>;
const I_SHIRT = <><path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z" /></>;
const I_SUN = <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>;
const I_SEND = <><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></>;

/** Карточка раздела: иконка и заголовок в одной строке. */
const Section = ({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) => (
  <section className="ks-card">
    <div className="ks-sec-head">
      <span className="ks-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <h2>{title}</h2>
    </div>
    {children}
  </section>
);
const Checks = ({ items, plain = false }: { items: string[]; plain?: boolean }) => (
  <ul className={`ks-checks${plain ? ' plain' : ''}`}>{items.map(x => <li key={x}>{x}</li>)}</ul>
);
const Price = ({ name, note, price }: { name: string; note?: string; price: string }) => (
  <div className="ks-price">
    <span className="nm">{name}{note && <span className="nt">{note}</span>}</span>
    <span className="pr">{price}</span>
  </div>
);
const Sign = ({ text = 'Записаться' }: { text?: string }) => (
  <a className="ks-btn" href={ADMIN_CHAT} target="_blank" rel="noreferrer">{text}</a>
);

// «О клубе» для гостя, ребёнка и тренера без назначенных групп: только открытая информация, без данных детей и результатов игроков.
export default function About({ role, onChangeRole }: { role: Role | null; onChangeRole: () => void }) {
  return (
    <main className="page">
      <h1>FC KickStart Tbilisi</h1>
      {role === 'coach' && (
        <section className="ks-card">
          <h2>Вы вошли как тренер</h2>
          <p className="muted">Администратор клуба назначит вам группы, после этого здесь появятся отметки, матчи и баллы. Пока доступна открытая информация о клубе.</p>
        </section>
      )}
      <TrialForm />
      <section className="ks-card">
        <div className="ks-sec-head">
          <span className="ks-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{I_PIN}</svg>
          </span>
          <h2>Филиалы</h2>
        </div>
        <p className="ks-lead">Три филиала в Тбилиси. Время тренировок смотрите во вкладке «Расписание».</p>
        {BRANCHES.map(b => (
          <a key={b.name} className="ks-row" href={b.map} target="_blank" rel="noreferrer" aria-label="Открыть на карте">
            <span className="ks-row-main">
              <span className="ks-row-title">{b.name}</span>
              <span className="ks-row-sub">Открыть на карте</span>
            </span>
            <span className="ks-row-end"><span className="ks-chev" aria-hidden="true" /></span>
          </a>
        ))}
      </section>
      <Section icon={I_CUP} title="Чемпионаты сезона 2026/27">
        {CHAMPIONSHIPS.map(c => (
          <div className="ks-price" key={c.name}>
            <span className="nm">{c.name}</span>
            <span className="pr" style={{ fontWeight: 600 }}>{c.teams}</span>
          </div>
        ))}
      </Section>
      <Section icon={I_TARGET} title="Индивидуальные тренировки">
        <p className="ks-lead">{INDIVIDUAL.lead}</p>
        <p className="ks-label" style={{ marginTop: 0 }}>Четыре блока на ближайшие три месяца</p>
        <div className="ks-tiles">
          {INDIVIDUAL.blocks.map((b, i) => <div className="ks-tile" key={b}><b>Блок {i + 1}</b>{b}</div>)}
        </div>
        <p className="ks-label">Расписание</p>
        <div className="ks-chips">
          {INDIVIDUAL.schedule.map(s => <Pill key={s} tone="primary">{s}</Pill>)}
        </div>
        <p className="ks-hint">{INDIVIDUAL.note}</p>
        <Sign />
      </Section>
      <Section icon={I_HAND} title="Вратарские тренировки">
        <p className="ks-lead">{GOALKEEPERS.lead}</p>
        <Checks items={GOALKEEPERS.skills} />
        <Sign />
      </Section>
      <Section icon={I_SHIRT} title="Экипировка 2026/27">
        {EQUIPMENT.items.map(i => <Price key={i.name} name={i.name} note={i.note} price={`${i.price} GEL`} />)}
        <p className="ks-callout">{EQUIPMENT.bundle}</p>
        <p className="ks-hint">{EQUIPMENT.installment} {EQUIPMENT.fitting}</p>
        <Sign text="Заказать" />
        <a className="ks-btn secondary" href={INSTALLMENT_CHAT} target="_blank" rel="noreferrer">Вопросы по рассрочке</a>
      </Section>
      <Section icon={I_SUN} title={CAMP.title}>
        <p style={{ margin: '0 0 4px' }}><b>{CAMP.when}</b></p>
        <p className="ks-lead">Группы: {CAMP.groups}</p>
        <Checks items={CAMP.facts} />
        <p className="ks-label">Стоимость</p>
        {CAMP.prices.map(p => <Price key={p.name} name={p.name} note={p.note} price={p.price} />)}
        <details className="ks-details">
          <summary>Условия бронирования и возврата</summary>
          <Checks items={CAMP.terms} plain />
        </details>
        <Sign text="Забронировать место" />
      </Section>
      <Section icon={I_SEND} title="Наш канал">
        <p className="ks-lead" style={{ marginBottom: 0 }}>Новости клуба, результаты, фото и объявления.</p>
        <a className="ks-btn secondary" href={CLUB_CHANNEL} target="_blank" rel="noreferrer">Открыть канал</a>
      </Section>
      <button type="button" className="ks-btn secondary" onClick={onChangeRole}>
        Сменить роль
      </button>
    </main>
  );
}
