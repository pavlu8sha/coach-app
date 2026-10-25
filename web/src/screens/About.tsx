import { useEffect, useState, type ReactNode } from 'react';
import { ADMIN_CHAT, BRANCHES, CAMP, CAMP_MORE, CHAMPIONSHIPS, CLUB_CHANNEL, EQUIPMENT, GOALKEEPERS, INDIVIDUAL, INSTALLMENT_CHAT, PRODUCTS, SUIT_SIZES, type Product } from '../lib/clubInfo';
import { Photo } from '../lib/photos';
import { Gallery, ZoomPhoto } from '../ui/Lightbox';
import { Art, CoverBanner, CoverTile, type CoverId } from '../ui/Cover';
import { Pill, Segmented } from '../ui/components';
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

function ProductCard({ p, onOpen }: { p: Product; onOpen: () => void }) {
  return (
    <button type="button" className="ks-prod" onClick={onOpen}>
      {p.photos[0] ? <Photo name={p.photos[0]} alt="" /> : <span className="ph" aria-hidden="true"><Art id="equipment" size={44} /></span>}
      <span className="ks-row-main">
        <span className="ks-row-title">{p.name}</span>
        <span className="ks-row-sub">{p.lead}</span>
      </span>
      <span className="pr">{p.price} GEL</span>
    </button>
  );
}

function ProductDetail({ p }: { p: Product }) {
  return (
    <>
      <h1 className="ks-ptitle">{p.name}</h1>
      <p className="ks-pprice">{p.price} GEL</p>
      {p.photos.length > 0 && (
        <Gallery className="ks-gallery flush" keys={p.photos} alt={p.name} />
      )}
      <Card title="Описание">
        <p className="ks-lead" style={{ marginBottom: 0 }}>{p.lead}</p>
      </Card>
      <Card title="Особенности">
        <Checks items={p.features} />
      </Card>
      {p.id === 'suit' && (
        <Card title="Размерная таблица">
          <table className="ks-table">
            <thead><tr><th>Рост, см</th><th>Длина кофты</th><th>Брюки, внутр.</th><th>Брюки, внеш.</th></tr></thead>
            <tbody>{SUIT_SIZES.map(r => <tr key={r[0]}><th scope="row">{r[0]}</th><td>{r[3]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
          </table>
          <p className="ks-hint">Длины в сантиметрах, включают пояс и манжеты. Допуск ±1 см. Размеры можно примерить на тренировке.</p>
        </Card>
      )}
      <Sign text="Заказать" />
    </>
  );
}

function Equipment({ product, setProduct }: { product: Product['id'] | null; setProduct: (id: Product['id'] | null) => void }) {
  const cur = PRODUCTS.find(p => p.id === product);
  if (cur) return <ProductDetail p={cur} />;
  return (
    <>
      <CoverBanner id="equipment" title="Экипировка 2026/27" sub="Выберите товар" photo="kit-game" />
      <section className="ks-card" style={{ padding: 0 }}>
        {PRODUCTS.map(p => <ProductCard key={p.id} p={p} onOpen={() => setProduct(p.id)} />)}
      </section>
      <Card title="Скидка и рассрочка">
        <p className="ks-callout" style={{ marginTop: 0 }}>{EQUIPMENT.bundle}</p>
        <p className="ks-hint">{EQUIPMENT.installment} {EQUIPMENT.fitting}</p>
        <Sign text="Заказать" />
        <a className="ks-btn secondary" href={INSTALLMENT_CHAT} target="_blank" rel="noreferrer">Вопросы по рассрочке</a>
      </Card>
    </>
  );
}

type CampTab = 'about' | 'program' | 'hotel' | 'price';
const photo = (n: string, alt: string) => <ZoomPhoto name={n} alt={alt} className="ks-photo" />;

function Camp() {
  const [tab, setTab] = useState<CampTab>('about');
  const M = CAMP_MORE;
  return (
    <>
      <CoverBanner id="camp" title={CAMP.title} sub={CAMP.when} photo="camp-hero" />
      <div className="ks-tabs">
        <Segmented<CampTab>
          label="Разделы сборов"
          value={tab}
          onChange={setTab}
          items={[{ value: 'about', label: 'Обзор' }, { value: 'program', label: 'Программа' }, { value: 'hotel', label: 'Отель' }, { value: 'price', label: 'Стоимость' }]}
        />
      </div>
      {tab === 'about' && (
        <>
          <Card title={M.tagline}>
            <p className="ks-lead">Группы: {CAMP.groups}</p>
            <p className="ks-lead" style={{ marginBottom: 0 }}>{M.lead}</p>
          </Card>
          <Card>
            <Gallery className="ks-gallery" keys={['camp-resort', 'camp-team', 'camp-garden', 'camp-play', 'camp-sunset']} alt="Фото сборов" />
            {M.idea.map(i => <Price key={i.title} name={i.title} note={i.text} price="" />)}
          </Card>
          <Card title={M.fields.title}>
            <p className="ks-lead" style={{ marginBottom: 0 }}>{M.fields.text}</p>
          </Card>
          <Card title="Опыт FC KickStart">
            <div className="ks-nums">{M.experience.numbers.map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}</div>
            <p className="ks-hint">{M.experience.note}</p>
            <p className="ks-label">В конце: письменные рекомендации каждому игроку</p>
            <Checks items={M.experience.report} />
          </Card>
          <Card title="Футболка участника">
            <p className="ks-lead" style={{ marginBottom: 0 }}>{M.shirt}</p>
          </Card>
          <Sign text="Забронировать место" />
        </>
      )}
      {tab === 'program' && (
        <>
          <Card title="Каждому возрасту своя задача">
            <p className="ks-lead">{M.agesNote}</p>
            <ul className="ks-steps2">
              {M.ages.map(a => <li key={a.group}><b>{a.group}</b>{a.items.join(' · ')}</li>)}
            </ul>
          </Card>
          <Card title="7 дней в режиме футболиста">
            <ul className="ks-steps2">
              {M.day.map(d => <li key={d.title}><b>{d.title}</b>{d.text}</li>)}
            </ul>
            <p className="ks-hint">{M.dayNote}</p>
          </Card>
          <Card title="Один отпуск, два сценария">
            <div className="ks-two">
              <div><h3>Для ребёнка</h3><Checks items={M.family.child} /></div>
              <div><h3>Для родителей</h3><Checks items={M.family.parents} /></div>
            </div>
            <p className="ks-hint">{M.family.note}</p>
          </Card>
        </>
      )}
      {tab === 'hotel' && (
        <>
          <Card title="Kolkhida Resort & Spa">
            {photo('camp-resort', 'Территория отеля')}
            <p className="ks-lead" style={{ marginBottom: 0 }}>Отель на берегу моря в Уреки: поля, питание и отдых рядом.</p>
          </Card>
          <Card title="Номера">
            <Gallery className="ks-gallery" keys={['camp-room1', 'camp-room2']} alt="Номер отеля" />
            <p className="ks-hint"><b>{M.rooms.title}.</b> {M.rooms.text}</p>
          </Card>
          <Card title="На территории">
            {M.services.map(x => <Price key={x.title} name={x.title} note={x.text} price="" />)}
            {photo('camp-garden', 'Территория отеля')}
          </Card>
        </>
      )}
      {tab === 'price' && (
        <>
          <Card title="Тарифы Winter Camp 2027">
            {CAMP.prices.map(p => <Price key={p.name} name={p.name} note={p.note} price={p.price} />)}
            {M.priceNotes.slice(0, 2).map(n => <p className="ks-hint" key={n}>{n}</p>)}
          </Card>
          <Card title="Бронь и отмена">
            <p className="ks-callout" style={{ marginTop: 0 }}><b>500 GEL</b> бронь до 1 декабря, полная оплата до 20 декабря.</p>
            <Checks items={CAMP.terms.slice(1, 5)} plain />
            <p className="ks-hint">{M.priceNotes[2]}</p>
          </Card>
          <Sign text="Забронировать место" />
        </>
      )}
    </>
  );
}

const TILES: { id: Exclude<CoverId, 'channel'>; title: string; sub: string; wide?: boolean; photo?: string }[] = [
  { id: 'camp', title: CAMP.title, sub: `${CAMP.when.split(' · ')[0]} · Уреки`, wide: true, photo: 'camp-hero' },
  { id: 'branches', title: 'Филиалы', sub: 'Три филиала и карты' },
  { id: 'champ', title: 'Чемпионаты', sub: 'Сезон 2026/27' },
  { id: 'individual', title: 'Индивидуальные', sub: 'До 3 футболистов на тренера' },
  { id: 'gk', title: 'Вратарские', sub: 'Отдельные тренировки' },
  { id: 'equipment', title: 'Экипировка', sub: 'Комплекты от 100 GEL', photo: 'kit-game' },
];
const SCREENS: Record<Exclude<CoverId, 'channel'>, () => ReactNode> = { branches: Branches, champ: Championships, individual: Individual, gk: Goalkeepers, equipment: () => null, camp: Camp };

// «О клубе» для гостя, ребёнка и тренера без назначенных групп: только открытая информация, без данных детей и результатов игроков.
// Главный экран — плитки-разделы; каждый раздел открывается отдельным экраном.
export default function About({ role, onChangeRole }: { role: Role | null; onChangeRole: () => void }) {
  const [open, setOpen] = useState<Id | null>(null);
  const [product, setProduct] = useState<Product['id'] | null>(null);
  useEffect(() => { document.documentElement.scrollTop = 0; }, [open, product]);

  if (open) {
    const Screen = open === 'trial' ? null : SCREENS[open];
    return (
      <main className="page">
        <BackNav onBack={() => (product ? setProduct(null) : setOpen(null))} />
        {open === 'equipment' ? <Equipment product={product} setProduct={setProduct} /> : Screen ? <Screen /> : <TrialForm startOpen />}
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
