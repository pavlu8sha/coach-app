import { useEffect, useState, type ReactNode } from 'react';
import { ADMIN_CHAT, BRANCHES, CAMP, CHAMPIONSHIPS, CLUB_CHANNEL, EQUIPMENT, GOALKEEPERS, INDIVIDUAL, INSTALLMENT_CHAT } from '../lib/clubInfo';
import { CoverBanner, CoverTile, type CoverId } from '../ui/Cover';
import { Pill } from '../ui/components';
import { BackNav } from '../ui/nav';
import type { Role } from './RoleSelect';
import TrialForm from './TrialForm';

export { CLUB_CHANNEL };

type Id = Exclude<CoverId, 'channel'> | 'trial';

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
const Card = ({ title, children }: { title?: string; children: ReactNode }) => (
  <section className="ks-card">
    {title && <h2 className="ks-h">{title}</h2>}
    {children}
  </section>
);

// Каждый раздел — отдельный экран с обложкой; заголовки карточек остаются теми же, что и раньше.
function Branches() {
  return (
    <>
      <CoverBanner id="branches" title="Филиалы" sub="Три филиала в Тбилиси" />
      <section className="ks-card">
        <p className="ks-lead">Время тренировок смотрите во вкладке «Расписание».</p>
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
    </>
  );
}

function Championships() {
  return (
    <>
      <CoverBanner id="champ" title="Чемпионаты сезона 2026/27" sub="Где играют наши команды" />
      {CHAMPIONSHIPS.map(c => (
        <Card key={c.name}>
          <h2>{c.name}</h2>
          <div className="ks-chips">{c.teams.split(', ').map(t => <Pill key={t} tone="primary">{t}</Pill>)}</div>
          <p className="visually-hidden">{c.teams}</p>
        </Card>
      ))}
    </>
  );
}

function Individual() {
  return (
    <>
      <CoverBanner id="individual" title="Индивидуальные тренировки" sub={INDIVIDUAL.note} />
      <Card title="Как проходят">
        <p className="ks-lead" style={{ marginBottom: 0 }}>{INDIVIDUAL.lead}</p>
      </Card>
      <Card title="Четыре блока на три месяца">
        <div className="ks-tiles">
          {INDIVIDUAL.blocks.map((b, i) => <div className="ks-tile" key={b}><b>Блок {i + 1}</b>{b}</div>)}
        </div>
      </Card>
      <Card title="Расписание">
        <div className="ks-chips">{INDIVIDUAL.schedule.map(s => <Pill key={s} tone="primary">{s}</Pill>)}</div>
        <Sign />
      </Card>
    </>
  );
}

function Goalkeepers() {
  return (
    <>
      <CoverBanner id="gk" title="Вратарские тренировки" sub="Отдельная роль в команде" />
      <Card title="Зачем нужны">
        <p className="ks-lead" style={{ marginBottom: 0 }}>{GOALKEEPERS.lead}</p>
      </Card>
      <Card title="Что отрабатываем">
        <Checks items={GOALKEEPERS.skills} />
        <Sign />
      </Card>
    </>
  );
}

function Equipment() {
  return (
    <>
      <CoverBanner id="equipment" title="Экипировка 2026/27" sub="Комплекты клуба" />
      <Card title="Цены">
        {EQUIPMENT.items.map(i => <Price key={i.name} name={i.name} note={i.note} price={`${i.price} GEL`} />)}
      </Card>
      <Card title="Скидка и рассрочка">
        <p className="ks-callout" style={{ marginTop: 0 }}>{EQUIPMENT.bundle}</p>
        <p className="ks-hint">{EQUIPMENT.installment} {EQUIPMENT.fitting}</p>
        <Sign text="Заказать" />
        <a className="ks-btn secondary" href={INSTALLMENT_CHAT} target="_blank" rel="noreferrer">Вопросы по рассрочке</a>
      </Card>
    </>
  );
}

function Camp() {
  return (
    <>
      <CoverBanner id="camp" title={CAMP.title} sub={CAMP.when} />
      <Card title="Программа">
        <p className="ks-lead">Группы: {CAMP.groups}</p>
        <Checks items={CAMP.facts} />
      </Card>
      <Card title="Стоимость">
        {CAMP.prices.map(p => <Price key={p.name} name={p.name} note={p.note} price={p.price} />)}
      </Card>
      <Card>
        <details className="ks-details" style={{ marginTop: 0, borderTop: 0 }}>
          <summary>Условия бронирования и возврата</summary>
          <Checks items={CAMP.terms} plain />
        </details>
        <Sign text="Забронировать место" />
      </Card>
    </>
  );
}

const TILES: { id: Exclude<CoverId, 'channel'>; title: string; sub: string; wide?: boolean }[] = [
  { id: 'camp', title: CAMP.title, sub: `${CAMP.when.split(' · ')[0]} · Уреки`, wide: true },
  { id: 'branches', title: 'Филиалы', sub: 'Три филиала и карты' },
  { id: 'champ', title: 'Чемпионаты', sub: 'Сезон 2026/27' },
  { id: 'individual', title: 'Индивидуальные', sub: 'До 3 футболистов на тренера' },
  { id: 'gk', title: 'Вратарские', sub: 'Отдельные тренировки' },
  { id: 'equipment', title: 'Экипировка', sub: 'Комплекты от 100 GEL' },
];
const SCREENS: Record<Exclude<CoverId, 'channel'>, () => ReactNode> = { branches: Branches, champ: Championships, individual: Individual, gk: Goalkeepers, equipment: Equipment, camp: Camp };

// «О клубе» для гостя, ребёнка и тренера без назначенных групп: только открытая информация, без данных детей и результатов игроков.
// Главный экран — плитки-разделы; каждый раздел открывается отдельным экраном.
export default function About({ role, onChangeRole }: { role: Role | null; onChangeRole: () => void }) {
  const [open, setOpen] = useState<Id | null>(null);
  useEffect(() => { document.documentElement.scrollTop = 0; }, [open]);

  if (open) {
    const Screen = open === 'trial' ? null : SCREENS[open];
    return (
      <main className="page">
        <BackNav onBack={() => setOpen(null)} />
        {Screen ? <Screen /> : <TrialForm startOpen />}
      </main>
    );
  }
  return (
    <main className="page">
      <div className="ks-intro">
        <h1>FC KickStart Tbilisi</h1>
        <p className="muted">Футбольная школа в Тбилиси. Запишитесь на пробную тренировку или выберите раздел.</p>
        <button type="button" className="ks-btn" onClick={() => setOpen('trial')}>Записаться на пробную</button>
        <a className="ks-btn secondary" href={ADMIN_CHAT} target="_blank" rel="noreferrer">Написать администратору</a>
      </div>
      {role === 'coach' && (
        <section className="ks-card">
          <h2>Вы вошли как тренер</h2>
          <p className="muted">Администратор клуба назначит вам группы, после этого здесь появятся отметки, матчи и баллы. Пока доступна открытая информация о клубе.</p>
        </section>
      )}
      <div className="ks-hub">
        {TILES.map(t => <CoverTile key={t.id} {...t} onClick={() => setOpen(t.id)} />)}
        <CoverTile id="channel" title="Наш канал" sub="Новости и фото клуба" href={CLUB_CHANNEL} />
      </div>
      <button type="button" className="ks-btn secondary" onClick={onChangeRole}>
        Сменить роль
      </button>
    </main>
  );
}
