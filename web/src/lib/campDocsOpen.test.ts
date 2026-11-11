import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCampDoc } from './campDocs';

// Открытие документа сбора (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условие 65)
const link = (url = 'https://files.test/d1?token=1', status = 200) => vi.fn(async () => new Response(JSON.stringify(status === 200 ? { url } : { error: 'forbidden' }), { status }));
const fakeWin = () => ({ opener: {} as unknown, location: { href: '' }, close: vi.fn() });
afterEach(() => { delete (window as any).Telegram; });

describe('вне Telegram', () => {
  it('окно открывается сразу по нажатию, до ответа сервера; потом ему подставляется адрес, opener обнулён', async () => {
    const win = fakeWin();
    const open = vi.fn(() => win);
    vi.stubGlobal('open', open);
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>(r => { release = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const p = openCampDoc('d1');
    expect(open).toHaveBeenCalledTimes(1); // ещё до ответа сервера
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(win.opener).toBeNull();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // запрос ссылки уходит уже после открытия окна
    expect(win.location.href).toBe('');
    release(new Response(JSON.stringify({ url: 'https://files.test/d1?token=1' }), { status: 200 }));
    expect(await p).toEqual({ ok: true, fallbackUrl: null });
    expect(win.location.href).toBe('https://files.test/d1?token=1');
    expect(win.close).not.toHaveBeenCalled();
  });
  it('ссылку получить не удалось: пустое окно закрывается, ошибка возвращается', async () => {
    const win = fakeWin();
    vi.stubGlobal('open', vi.fn(() => win));
    vi.stubGlobal('fetch', link(undefined, 403));
    expect(await openCampDoc('d1')).toEqual({ ok: false, error: 'forbidden' });
    expect(win.close).toHaveBeenCalledTimes(1);
  });
  it('окно заблокировано: возвращается адрес для видимой ссылки', async () => {
    vi.stubGlobal('open', vi.fn(() => null));
    vi.stubGlobal('fetch', link());
    expect(await openCampDoc('d1')).toEqual({ ok: true, fallbackUrl: 'https://files.test/d1?token=1' });
  });
});

describe('внутри Telegram', () => {
  it('открывается через Telegram.WebApp.openLink, window.open не вызывается', async () => {
    const openLink = vi.fn();
    (window as any).Telegram = { WebApp: { initData: 'x', openLink } };
    const open = vi.fn();
    vi.stubGlobal('open', open);
    vi.stubGlobal('fetch', link());
    expect(await openCampDoc('d1')).toEqual({ ok: true, fallbackUrl: null });
    expect(openLink).toHaveBeenCalledWith('https://files.test/d1?token=1');
    expect(open).not.toHaveBeenCalled();
  });
  it('ошибка ссылки: openLink не вызывается', async () => {
    const openLink = vi.fn();
    (window as any).Telegram = { WebApp: { initData: 'x', openLink } };
    vi.stubGlobal('fetch', link(undefined, 403));
    expect(await openCampDoc('d1')).toEqual({ ok: false, error: 'forbidden' });
    expect(openLink).not.toHaveBeenCalled();
  });
  it('Telegram без openLink (старый клиент): как вне Telegram', async () => {
    (window as any).Telegram = { WebApp: { initData: 'x' } };
    const win = fakeWin();
    vi.stubGlobal('open', vi.fn(() => win));
    vi.stubGlobal('fetch', link());
    expect(await openCampDoc('d1')).toEqual({ ok: true, fallbackUrl: null });
    expect(win.location.href).toBe('https://files.test/d1?token=1');
  });
});
