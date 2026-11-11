import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';
import { campSlugFromPath, mountPublicCamp, telegramLink } from './publicCamp';

// Публичная страница сбора (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 57-61, 63)
const camp = {
  camp: { name: 'Зимний лагерь', location: 'Бакуриани', starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 100, booking_deadline: '2026-12-01', full_payment_deadline: '2026-12-20' },
  tariffs: [{ name: 'Футболист', price: 850 }, { name: 'Вратарь', price: 900 }],
  terms: [{ from: null, to: '2026-12-01', text: 'Возврат полный' }, { from: '2026-12-02', to: null, text: 'Возврат 50%' }],
  seats_available: true,
};
// Ответ базы подставляется вместо fetch: значение, функция или { fail } (сбой сети)
type Reply = unknown | (() => unknown | Promise<unknown>);
const calls: { url: string; init: RequestInit }[] = [];
function api(reply: Reply, status = 200) {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://fake.supabase');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const v = typeof reply === 'function' ? await (reply as () => unknown)() : reply;
    if (v && typeof v === 'object' && 'fail' in (v as object)) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(v), { status });
  }));
}
const mount = (path: string) => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root') as HTMLElement;
  mountPublicCamp(root, path);
  return root;
};

describe('адрес страницы (условие 57)', () => {
  it('имя из пути: регистр, слэши', () => {
    expect(campSlugFromPath('/camp/zima')).toBe('zima');
    expect(campSlugFromPath('/camp/Zima-2027/')).toBe('zima-2027');
    expect(campSlugFromPath('/camp//zima//')).toBe('zima');
  });
  it('неверное имя: null', () => {
    for (const p of ['/camp', '/camp/', '/camp/ab', '/camp/zima/extra', '/camp/зима', '/camp/a b c', `/camp/${'a'.repeat(61)}`, '/other/zima', '/camp/-zima', '/camp/zima-', '/camp/zi--ma']) {
      expect(campSlugFromPath(p), p).toBeNull();
    }
  });
  it('неверное имя: страница «не найдено», запроса к базе нет', async () => {
    api(camp);
    mount('/camp/ab');
    expect(await screen.findByText('Сбор не найден')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('данные сбора (условия 58, 61)', () => {
  it('один анонимный вызов camp_public с именем; показаны только его поля', async () => {
    api(camp);
    mount('/camp/Zima');
    expect(await screen.findByRole('heading', { name: 'Зимний лагерь' })).toBeInTheDocument();
    // ровно один запрос: анонимный вызов функции базы, только публичный ключ, без токена пользователя и cookie
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://fake.supabase/rest/v1/rpc/camp_public');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ sl: 'zima' });
    expect(calls[0].init.headers).toEqual({ apikey: 'sb_publishable_test', 'Content-Type': 'application/json' });
    expect(calls[0].init.credentials).toBe('omit');
    expect(screen.getByText(/02\.01\.2027 — 09\.01\.2027/)).toBeInTheDocument();
    expect(screen.getByText(/Бакуриани/)).toBeInTheDocument();
    expect(screen.getByText('Футболист: 850 ₾')).toBeInTheDocument();
    expect(screen.getByText('Вратарь: 900 ₾')).toBeInTheDocument();
    expect(screen.getByText(/Бронь 100 ₾ до 01\.12\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/Полная оплата до 20\.12\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/до 01\.12\.2026: Возврат полный/)).toBeInTheDocument();
    expect(screen.getByText(/с 02\.12\.2026: Возврат 50%/)).toBeInTheDocument();
    expect(screen.getByText('Есть места')).toBeInTheDocument();
  });
  it('описание сборов из презентации и обложка; пустые условия отмены блока не дают', async () => {
    api({ ...camp, terms: [] });
    const root = mount('/camp/zima');
    await screen.findByRole('heading', { name: 'Зимний лагерь' });
    const t = root.textContent ?? '';
    for (const x of ['Тренировочная программа', 'Hotel Surami', 'Программа по возрастам', 'U6–7', 'Жизнь команды', 'Для всей семьи', '11 проведённых сборов']) expect(t).toContain(x);
    expect(t).not.toContain('Условия отмены');
    expect(root.querySelector('img.hero')?.getAttribute('src')).toBe('/img/camp-hero.jpg');
  });

  it('мест нет', async () => {
    api({ ...camp, seats_available: false });
    mount('/camp/zima');
    expect(await screen.findByText('Мест нет')).toBeInTheDocument();
    expect(screen.queryByText('Есть места')).not.toBeInTheDocument();
  });
  it('нет брони, сроков и условий: этих строк нет', async () => {
    api({ camp: { ...camp.camp, booking_fee: 0, booking_deadline: null, full_payment_deadline: null }, tariffs: [], terms: [], seats_available: true });
    mount('/camp/zima');
    await screen.findByRole('heading', { name: 'Зимний лагерь' });
    expect(screen.queryByText(/Бронь/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Полная оплата/)).not.toBeInTheDocument();
    expect(screen.queryByText('Условия отмены')).not.toBeInTheDocument();
    expect(screen.queryByText('Тарифы')).not.toBeInTheDocument();
  });
  it('кнопка «Открыть в Telegram» ведёт на deep link; формы записи нет', async () => {
    api(camp);
    mount('/camp/Zima');
    const link = await screen.findByRole('link', { name: 'Открыть в Telegram' });
    expect(link).toHaveAttribute('href', 'https://t.me/kicksapp?startapp=camp_zima');
    expect(telegramLink('zima')).toBe('https://t.me/kicksapp?startapp=camp_zima');
    expect(document.querySelector('form, input, textarea, select')).toBeNull();
  });
});

describe('текст из базы как текст (условие 59)', () => {
  it('разметка в названии, месте, тарифе и условиях не превращается в элементы', async () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    api({
      camp: { ...camp.camp, name: `Лагерь ${evil}`, location: `<b>место</b>` },
      tariffs: [{ name: `<script>window.__xss=2</script>`, price: 1 }],
      terms: [{ from: null, to: null, text: `<a href="javascript:window.__xss=3">x</a>` }],
      seats_available: true,
    });
    const root = mount('/camp/zima');
    await screen.findByRole('heading', { level: 1 });
    expect(root.querySelector('img:not(.hero), script, b')).toBeNull();
    expect(root.querySelectorAll('a')).toHaveLength(1); // только «Открыть в Telegram»
    expect(root.textContent).toContain(evil);
    expect((window as any).__xss).toBeUndefined();
  });
});

describe('пусто, сбои и повтор (условие 60)', () => {
  it('адрес базы не настроен: сообщение и «Повторить», запроса нет', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    mount('/camp/zima');
    expect(await screen.findByText('Страница временно недоступна. Попробуйте позже.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });
  it('ответ базы с ошибкой статуса: сообщение и «Повторить»', async () => {
    api({ message: 'boom' }, 500);
    mount('/camp/zima');
    expect(await screen.findByText(/Не удалось загрузить сбор/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
  it('пусто от базы: «Сбор не найден или запись закрыта»', async () => {
    api(null);
    mount('/camp/zima');
    expect(await screen.findByText('Сбор не найден или запись закрыта')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Открыть в Telegram' })).not.toBeInTheDocument();
  });
  it('ошибка базы: сообщение и «Повторить», после повтора данные', async () => {
    let fail = true;
    api(() => (fail ? { fail: true } : camp));
    mount('/camp/zima');
    expect(await screen.findByText(/Не удалось загрузить сбор/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Зимний лагерь' })).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });
  it('ответ неожиданной формы: сообщение об ошибке, а не падение', async () => {
    api({ camp: 'x' });
    mount('/camp/zima');
    expect(await screen.findByText(/Не удалось загрузить сбор/)).toBeInTheDocument();
  });
  it('повторное нажатие во время запроса не отправляет второй запрос', async () => {
    let n = 0;
    let release: (v: unknown) => void = () => {};
    api(() => (n++ === 0 ? { fail: true } : new Promise(r => { release = r; })));
    mount('/camp/zima');
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    fireEvent.click(retry);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    release(camp);
    await screen.findByRole('heading', { name: 'Зимний лагерь' });
    expect(calls).toHaveLength(2);
  });
});

describe('без следов в браузере (условие 63)', () => {
  it('ничего не пишет в cookie и хранилища', async () => {
    api(camp);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    document.cookie = '';
    mount('/camp/zima');
    await screen.findByRole('heading', { name: 'Зимний лагерь' });
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
    setItem.mockRestore();
  });
});
