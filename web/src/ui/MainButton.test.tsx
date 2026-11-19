import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMainButton } from './nav';

function Btn() {
  useMainButton({ text: 'Сохранить', visible: true, enabled: true, onClick: () => {} });
  return null;
}
const mk = (withParams: boolean) => ({
  initData: 'x', themeParams: { button_color: '#2481cc', button_text_color: '#ffffff' },
  MainButton: { setText: vi.fn(), show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn(), enable: vi.fn(), disable: vi.fn(), showProgress: vi.fn(), hideProgress: vi.fn(), ...(withParams ? { setParams: vi.fn() } : {}) },
});
type W = { Telegram?: { WebApp?: unknown } };

beforeEach(() => {
  document.documentElement.style.setProperty('--ks-primary', '#25335a');
  document.documentElement.style.setProperty('--ks-on-primary', '#ffffff');
});
afterEach(() => { delete (window as unknown as W).Telegram; document.documentElement.removeAttribute('style'); });

describe('useMainButton: цвет клуба', () => {
  it('при показе красит кнопку цветами клуба, при скрытии возвращает цвета Telegram', () => {
    const app = mk(true);
    (window as unknown as W).Telegram = { WebApp: app };
    const { unmount } = render(<Btn />);
    expect(app.MainButton.setParams).toHaveBeenCalledWith({ color: '#25335a', text_color: '#ffffff' });
    unmount();
    expect(app.MainButton.setParams).toHaveBeenLastCalledWith({ color: '#2481cc', text_color: '#ffffff' });
  });

  it('старый клиент без setParams не ломает кнопку', () => {
    const app = mk(false);
    (window as unknown as W).Telegram = { WebApp: app };
    const { unmount } = render(<Btn />);
    expect(app.MainButton.show).toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });

  it('ошибка setParams не ломает кнопку', () => {
    const app = mk(true);
    app.MainButton.setParams!.mockImplementation(() => { throw new Error('old'); });
    (window as unknown as W).Telegram = { WebApp: app };
    expect(() => render(<Btn />)).not.toThrow();
    expect(app.MainButton.show).toHaveBeenCalled();
  });
});
