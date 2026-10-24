import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('вход из браузера: виджет Telegram', () => {
  it('без имени бота вход из браузера выключен', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_TG_BOT_USERNAME', '');
    const m = await import('./BrowserLogin');
    expect(m.browserLoginEnabled).toBe(false);
  });

  it('с именем бота встраивает скрипт виджета и передаёт пользователя дальше', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_TG_BOT_USERNAME', '@kickstart_bot');
    const m = await import('./BrowserLogin');
    expect(m.browserLoginEnabled).toBe(true);
    const got: unknown[] = [];
    const { container, unmount } = render(<m.default onUser={u => got.push(u)} />);
    const s = container.querySelector('script[data-telegram-login]') as HTMLScriptElement;
    expect(s.getAttribute('data-telegram-login')).toBe('kickstart_bot'); // «@» убран
    expect(s.src).toContain('telegram-widget.js');
    expect(s.getAttribute('data-onauth')).toBe('__tgLogin(user)');
    (window as unknown as { __tgLogin: (u: unknown) => void }).__tgLogin({ id: 5 });
    expect(got).toEqual([{ id: 5 }]);
    unmount();
    expect((window as unknown as Record<string, unknown>).__tgLogin).toBeUndefined(); // обработчик снят
  });
});
