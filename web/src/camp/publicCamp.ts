// Публичная страница сбора /camp/<имя> (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 57-61, 63).
// Без входа и без Telegram: один анонимный вызов camp_public обычным fetch (без клиента Supabase, без сессии и без хранения данных). Весь текст из базы выводится через textContent, разметка не создаётся.

import { CAMP } from '../lib/clubInfo';

interface Tariff { name: string; price: number }
interface Period { from: string | null; to: string | null; text: string }
interface PublicCamp {
  camp: { name: string; location: string | null; starts_on: string; ends_on: string; booking_fee: number | null; booking_deadline: string | null; full_payment_deadline: string | null };
  tariffs: Tariff[];
  terms: Period[];
  seats_available: boolean;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Имя сбора из пути /camp/<имя>; null, если путь или имя неверные (имя проверяется как при сохранении в настройках сбора). */
export function campSlugFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[0] !== 'camp') return null;
  const s = parts[1].toLowerCase();
  return s.length >= 3 && s.length <= 60 && SLUG.test(s) ? s : null;
}

export const telegramLink = (slug: string) => `https://t.me/kicksapp?startapp=camp_${slug}`;

const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const money = (n: number) => `${Math.round(Number(n) * 100) / 100} ₾`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function isCamp(v: unknown): v is PublicCamp {
  const c = v as PublicCamp | null;
  return Boolean(c && typeof c === 'object' && c.camp && typeof c.camp === 'object' && typeof c.camp.name === 'string'
    && typeof c.camp.starts_on === 'string' && typeof c.camp.ends_on === 'string' && Array.isArray(c.tariffs) && Array.isArray(c.terms));
}

const periodText = (p: Period) => {
  const range = p.from && p.to ? `с ${fmtDate(p.from)} по ${fmtDate(p.to)}` : p.from ? `с ${fmtDate(p.from)}` : p.to ? `до ${fmtDate(p.to)}` : 'всегда';
  return `${range}: ${p.text}`;
};

function card(title: string, items: string[]): HTMLElement {
  const s = el('section', undefined, 'card');
  s.append(el('h2', title));
  const ul = el('ul');
  for (const t of items) ul.append(el('li', t));
  s.append(ul);
  return s;
}

// Описание сборов из презентации Winter Camp 2027: постоянный текст приложения, не данные базы
function about(): HTMLElement[] {
  const C = CAMP;
  const hero = el('img', undefined, 'hero');
  hero.src = '/img/camp-hero.jpg';
  hero.alt = C.title;
  hero.loading = 'lazy';
  return [
    hero,
    card(C.atmosphere.label, [C.atmosphere.title, C.atmosphere.text]),
    card(C.program.label, [C.program.lead, C.program.text]),
    card(C.hotel.label, [C.hotel.lead, ...C.hotel.items]),
    card(C.ages.label, C.ages.items.map(a => `${a.group}: ${a.text}`)),
    card(C.life.label, C.life.day.map(d => `${d.title}: ${d.text}`)),
    card(C.family.label, [C.family.lead, C.family.text, C.family.note]),
    card(C.result.label, [...C.result.numbers.map(([n, l]) => `${n} ${l}`), C.result.text]),
  ];
}

function renderCamp(root: HTMLElement, slug: string, d: PublicCamp) {
  const c = d.camp;
  const main = el('main');
  main.append(el('h1', c.name));
  main.append(el('p', `${fmtDate(c.starts_on)} — ${fmtDate(c.ends_on)}${c.location ? ` · ${c.location}` : ''}`, 'muted'));
  main.append(el('p', d.seats_available ? 'Есть места' : 'Мест нет', d.seats_available ? 'pill ok' : 'pill no'));
  main.append(...about());
  if (d.tariffs.length) main.append(card('Тарифы', d.tariffs.map(t => `${t.name}: ${money(t.price)}`)));
  const dates: string[] = [];
  if (c.booking_deadline) dates.push(`Бронь${c.booking_fee ? ` ${money(c.booking_fee)}` : ''} до ${fmtDate(c.booking_deadline)}`);
  if (c.full_payment_deadline) dates.push(`Полная оплата до ${fmtDate(c.full_payment_deadline)}`);
  if (dates.length) main.append(card('Сроки', dates));
  if (d.terms.length) main.append(card('Условия отмены', d.terms.map(periodText)));
  const a = el('a', 'Открыть в Telegram', 'btn');
  a.href = telegramLink(slug);
  main.append(a);
  main.append(el('p', 'Запись на сбор оформляется в приложении клуба.', 'muted'));
  root.replaceChildren(main);
}

function renderMessage(root: HTMLElement, title: string, text?: string, retry?: () => void) {
  const main = el('main');
  main.append(el('h1', title));
  if (text) main.append(el('p', text, 'muted'));
  if (retry) {
    const b = el('button', 'Повторить', 'btn');
    b.type = 'button';
    b.addEventListener('click', retry);
    main.append(b);
  }
  root.replaceChildren(main);
}

// Публичный ключ (publishable) и адрес базы подставляются при сборке; токен пользователя и cookie не отправляются
async function fetchCamp(slug: string): Promise<{ data: unknown } | 'config' | 'error'> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) return 'config';
  try {
    const res = await fetch(`${url}/rest/v1/rpc/camp_public`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sl: slug }),
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) return 'error';
    return { data: await res.json() };
  } catch {
    return 'error';
  }
}

/** Показывает страницу сбора для пути вида /camp/<имя> в элементе root. */
export function mountPublicCamp(root: HTMLElement, pathname: string): void {
  const slug = campSlugFromPath(pathname);
  if (!slug) return renderMessage(root, 'Сбор не найден', 'Проверьте ссылку.');
  let busy = false;
  const load = async () => {
    if (busy) return;
    busy = true;
    root.replaceChildren(el('p', 'Загрузка…', 'muted'));
    try {
      const r = await fetchCamp(slug);
      if (r === 'config') return renderMessage(root, 'Не удалось загрузить сбор', 'Страница временно недоступна. Попробуйте позже.', load);
      if (r === 'error') return renderMessage(root, 'Не удалось загрузить сбор', 'Нет связи с сервером. Попробуйте ещё раз.', load);
      if (r.data === null || r.data === undefined) return renderMessage(root, 'Сбор не найден или запись закрыта', 'Проверьте ссылку или спросите у тренера.');
      if (!isCamp(r.data)) return renderMessage(root, 'Не удалось загрузить сбор', 'Ответ сервера не распознан. Попробуйте позже.', load);
      renderCamp(root, slug, r.data);
    } catch {
      renderMessage(root, 'Не удалось загрузить сбор', 'Нет связи с сервером. Попробуйте ещё раз.', load);
    } finally {
      busy = false;
    }
  };
  void load();
}
