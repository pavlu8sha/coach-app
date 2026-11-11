import { useState, type ReactNode } from 'react';
import { useNav, useNavState, useSubEntry } from '../nav';
import ParentCamps from './ParentCamps';
import { ADMIN_CHAT, BRANCHES, CAMP, CHAMPIONSHIPS, CLUB_CHANNEL, EQUIPMENT, GOALKEEPERS, INDIVIDUAL, INSTALLMENT_CHAT, PRODUCTS, SUIT_SIZES, type Product } from '../lib/clubInfo';
import { Photo } from '../lib/photos';
import { Gallery, ZoomPhoto } from '../ui/Lightbox';
import { Art, CoverBanner, CoverTile, type CoverId } from '../ui/Cover';
import { ListRow, Pill, Segmented } from '../ui/components';
import { BackNav } from '../ui/nav';
import type { Role } from './RoleSelect';
import ClubArticles from './ClubArticles';
import { SECTION_HINT, type ArticleSection } from '../lib/articles';
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
// Родителю с привязанным ребёнком запись доступна в приложении, чат админа не нужен.
const BookHint = () => <p className="ks-hint">Записаться на свободное место можно во вкладке «Расписание» → «Запись на занятия».</p>;
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

function Individual({ cabinet }: { cabinet?: boolean }) {
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
        {cabinet ? <BookHint /> : <Sign />}
      </Card>
    </>
  );
}

function Goalkeepers({ cabinet }: { cabinet?: boolean }) {
  return (
    <>
      <CoverBanner id="gk" title="Вратарские тренировки" sub="Отдельная роль в команде" />
      <Card title="Зачем нужны">
        <p className="ks-lead" style={{ marginBottom: 0 }}>{GOALKEEPERS.lead}</p>
      </Card>
      <Card title="Что отрабатываем">
        <Checks items={GOALKEEPERS.skills} />
        {cabinet ? <BookHint /> : <Sign />}
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

const photo = (n: string, alt: string) => <ZoomPhoto name={n} alt={alt} className="ks-photo" />;
const Eyebrow = ({ children }: { children: string }) => <p className="ks-eyebrow">{children}</p>;

// Winter Camp 2027: одна лента секций в порядке презентации (docs/CAMP_GUEST_SECTION_ACCEPTANCE.md)
function Camp({ cabinet }: { cabinet?: boolean }) {
  const C = CAMP;
  const nav = useNav();
  return (
    <>
      <CoverBanner id="camp" title={C.title} sub={`${C.short} · ${C.groups}`} photo="camp-hero" />
      {cabinet && (
        <button type="button" className="ks-btn" style={{ marginBottom: 12 }} onClick={() => nav.push('ab.camps')}>
          Записаться / мои сборы
        </button>
      )}
      <Card>
        <Eyebrow>{C.atmosphere.label}</Eyebrow>
        <h2 className="ks-h">{C.atmosphere.title}</h2>
        {photo('camp-snow', 'Футболисты на снегу')}
        <p className="ks-lead">{C.atmosphere.text}</p>
        <p className="ks-hint">{C.atmosphere.note}</p>
      </Card>
      <Card>
        <Eyebrow>{C.program.label}</Eyebrow>
        <h2 className="ks-h">{C.program.title}</h2>
        {photo('camp-field', 'Тренировка на поле')}
        <p className="ks-callout"><b>{C.program.lead}</b></p>
        <p className="ks-lead" style={{ marginBottom: 0 }}>{C.program.text}</p>
      </Card>
      <Card>
        <Eyebrow>{C.hotel.label}</Eyebrow>
        <h2 className="ks-h">{C.hotel.title}</h2>
        {photo('camp-room', 'Номер в отеле')}
        <p className="ks-label">{C.hotel.lead}</p>
        <Checks items={C.hotel.items} />
      </Card>
      <Card>
        <Eyebrow>{C.ages.label}</Eyebrow>
        <h2 className="ks-h">{C.ages.title}</h2>
        {photo('camp-ages', 'Занятие по возрастам')}
        <ul className="ks-steps2">
          {C.ages.items.map(a => <li key={a.group}><b>{a.group}</b>{a.text}</li>)}
        </ul>
      </Card>
      <Card>
        <Eyebrow>{C.life.label}</Eyebrow>
        <h2 className="ks-h">{C.life.title}</h2>
        <div className="ks-two">{photo('camp-life1', 'Команда в свободное время')}{photo('camp-life2', 'Командный вечер')}</div>
        <ul className="ks-steps2" style={{ marginTop: 10 }}>
          {C.life.day.map(d => <li key={d.title}><b>{d.title}</b>{d.text}</li>)}
        </ul>
      </Card>
      <Card>
        <Eyebrow>{C.family.label}</Eyebrow>
        <h2 className="ks-h">{C.family.title}</h2>
        {photo('camp-family', 'Футболист на сборах')}
        <p className="ks-lead"><b>{C.family.lead}</b></p>
        <p className="ks-lead">{C.family.text}</p>
        <p className="ks-hint">{C.family.note}</p>
      </Card>
      <Card>
        <Eyebrow>{C.result.label}</Eyebrow>
        <h2 className="ks-h">{C.result.title}</h2>
        <div className="ks-nums">{C.result.numbers.map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}</div>
        <p className="ks-lead" style={{ marginTop: 12 }}>{C.result.text}</p>
        <p className="ks-hint">{C.result.note}</p>
      </Card>
      <Card>
        <Eyebrow>{C.price.label}</Eyebrow>
        <h2 className="ks-h">{C.price.title}</h2>
        {C.price.tariffs.map(t => <Price key={t.name} name={t.name} note={t.note} price={t.price} />)}
        <p className="ks-hint">{C.price.transfer}</p>
        <p className="ks-callout"><b>{C.price.booking}</b><br /><b>{C.price.full}</b></p>
      </Card>
      <Card>
        {photo('camp-team', 'Участники Winter Camp')}
        <h2 className="ks-h">{C.cta.title}</h2>
        <p className="ks-lead">{C.short}</p>
        <a className="ks-btn" href={ADMIN_CHAT} target="_blank" rel="noreferrer">{C.cta.open} · {C.chat}</a>
        <p className="ks-hint">{C.cta.note}</p>
      </Card>
    </>
  );
}

const TILES: { id: Exclude<CoverId, 'channel'>; title: string; sub: string; wide?: boolean; photo?: string }[] = [
  { id: 'camp', title: CAMP.title, sub: CAMP.short, wide: true, photo: 'camp-hero' },
  { id: 'branches', title: 'Филиалы', sub: 'Три филиала и карты' },
  { id: 'champ', title: 'Чемпионаты', sub: 'Сезон 2026/27' },
  { id: 'individual', title: 'Индивидуальные', sub: 'До 3 футболистов на тренера' },
  { id: 'gk', title: 'Вратарские', sub: 'Отдельные тренировки' },
  { id: 'equipment', title: 'Экипировка', sub: 'Комплекты от 100 GEL', photo: 'kit-game' },
];
const SCREENS: Record<Exclude<CoverId, 'channel'>, (p: { cabinet?: boolean }) => ReactNode> = { branches: Branches, champ: Championships, individual: Individual, gk: Goalkeepers, equipment: () => null, camp: Camp };

// «О клубе» для гостя, ребёнка и тренера без назначенных групп: только открытая информация, без данных детей и результатов игроков.
// Главный экран — плитки-разделы; каждый раздел открывается отдельным экраном.
export default function About({ role, onChangeRole, onBack, cabinet }: { role: Role | null; onChangeRole: () => void; onBack?: () => void; cabinet?: boolean }) {
  // раздел, товар и материалы — записи стека: «Назад» и системная кнопка идут по шагам, плитки остаются на прежнем месте
  const nav = useNav();
  const open = (useSubEntry('ab.open')?.params.id as Id | undefined) ?? null;
  const product = (useSubEntry('ab.product')?.params.id as Product['id'] | undefined) ?? null;
  const materials = (useSubEntry('ab.materials')?.params.s as ArticleSection | undefined) ?? null;
  const setOpen = (id: Id) => nav.push('ab.open', { id });
  const setProduct = (id: Product['id'] | null) => (id ? nav.push('ab.product', { id }) : nav.back());
  const setMaterials = (s: ArticleSection) => nav.push('ab.materials', { s });

  const campsOpen = Boolean(useSubEntry('ab.camps'));
  if (campsOpen) return <ParentCamps onBack={() => nav.back()} />;
  if (materials) return <ClubArticles role={role === 'parent' ? 'parent' : 'guest'} section={materials} onBack={() => nav.back()} />;

  // «Экипировка» не для гостя (#234): плитки нет, а прямое открытие раздела закрыто. Родителю раздел остаётся.
  const tiles = role === 'guest' ? TILES.filter(t => t.id !== 'equipment') : TILES;
  if (open && (open !== 'equipment' || role !== 'guest')) {
    const Screen = open === 'trial' ? null : SCREENS[open];
    return (
      <main className="page">
        <BackNav onBack={() => nav.back()} managed />
        {open === 'equipment' ? <Equipment product={product} setProduct={setProduct} /> : Screen ? <Screen cabinet={cabinet} /> : <TrialForm startOpen />}
      </main>
    );
  }
  return (
    <main className="page">
      {onBack && <BackNav onBack={onBack} managed />}
      <div className="ks-intro">
        <h1>FC KickStart Tbilisi</h1>
        <p className="muted">Футбольная школа в Тбилиси. {cabinet ? 'Выберите раздел.' : 'Запишитесь на пробную тренировку или выберите раздел.'}</p>
        {role !== 'child' && !cabinet && <button type="button" className="ks-btn" onClick={() => setOpen('trial')}>Записаться на пробную</button>}
        <a className="ks-btn secondary" href={ADMIN_CHAT} target="_blank" rel="noreferrer">Написать администратору</a>
      </div>
      {!cabinet && (
        <>
          <ListRow title="Новости клуба" sub={[SECTION_HINT.news]} onClick={() => setMaterials('news')} />
          <ListRow title="Турниры и матчи" sub={[SECTION_HINT.tournaments]} onClick={() => setMaterials('tournaments')} />
          <ListRow title="Материалы клуба" sub={[SECTION_HINT.article]} onClick={() => setMaterials('article')} />
        </>
      )}
      {role === 'coach' && (
        <section className="ks-card">
          <h2>Вы вошли как тренер</h2>
          <p className="muted">Администратор клуба назначит вам группы, после этого здесь появятся отметки, матчи и баллы. Пока доступна открытая информация о клубе.</p>
        </section>
      )}
      <div className="ks-hub">
        {tiles.map(t => <CoverTile key={t.id} {...t} onClick={() => setOpen(t.id)} />)}
        <CoverTile id="channel" title="Наш канал" sub="Новости и фото клуба" href={CLUB_CHANNEL} />
      </div>
      {!onBack && (
        <button type="button" className="ks-btn secondary" onClick={onChangeRole}>
          Сменить роль
        </button>
      )}
    </main>
  );
}
