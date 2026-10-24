import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomeScreenPrompt from './HomeScreenPrompt';

const setTelegram = (status: string | null, withMethods = true) => {
  (window as any).Telegram = {
    WebApp: { initData: 'x', ...(withMethods ? { addToHomeScreen: vi.fn(), checkHomeScreenStatus: (cb: (s: string) => void) => status && cb(status) } : {}) },
  };
  return (window as any).Telegram.WebApp;
};
afterEach(() => { delete (window as any).Telegram; });

describe('ярлык на экран «Домой»', () => {
  it('предлагает добавить и вызывает системное окно Telegram', async () => {
    const app = setTelegram('missed');
    render(<HomeScreenPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить на экран «Домой»' }));
    expect(app.addToHomeScreen).toHaveBeenCalledTimes(1);
  });
  it('не показывается, если ярлык уже добавлен', async () => {
    setTelegram('added');
    render(<HomeScreenPrompt />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('не показывается на клиенте без поддержки и вне Telegram', async () => {
    setTelegram(null, false);
    const { unmount } = render(<HomeScreenPrompt />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    delete (window as any).Telegram;
    render(<HomeScreenPrompt />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
