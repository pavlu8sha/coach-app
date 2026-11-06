import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavProvider, NavRoot, useNav } from '.';
import DirtyGuardHost from './DirtyGuardHost';
import { dirtyGuard, useDirtyGuard } from './dirtyGuard';
import { BottomNav } from '../ui/components';
import { BackNav } from '../ui/nav';

const tg = { enable: vi.fn(), disable: vi.fn() };

function Form({ dirty }: { dirty: boolean }) {
  useDirtyGuard(dirty);
  return <p>форма</p>;
}

describe('dirtyGuard', () => {
  it('без правок уход не спрашивает', () => {
    const go = vi.fn();
    dirtyGuard.leave(go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('с правками спрашивает: «Отмена» остаёт на месте, «Уйти» пускает', async () => {
    render(<><Form dirty /><DirtyGuardHost /></>);
    const go = vi.fn();
    dirtyGuard.leave(go);
    expect(await screen.findByRole('dialog', { name: 'Уйти без сохранения?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(go).not.toHaveBeenCalled();
    dirtyGuard.leave(go);
    fireEvent.click(await screen.findByRole('button', { name: 'Уйти' }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  });

  it('отметка снимается, когда форма закрыта или правок больше нет', () => {
    const { rerender, unmount } = render(<Form dirty />);
    expect(dirtyGuard.isDirty()).toBe(true);
    rerender(<Form dirty={false} />);
    expect(dirtyGuard.isDirty()).toBe(false);
    rerender(<Form dirty />);
    unmount();
    expect(dirtyGuard.isDirty()).toBe(false);
  });

  it('beforeunload: браузер предупреждает только пока есть правки', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { rerender } = render(<Form dirty />);
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    rerender(<Form dirty={false} />);
    expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });

  it('Telegram: подтверждение закрытия включается на время правок и выключается после', () => {
    vi.stubGlobal('Telegram', { WebApp: { initData: 'query_id=1', ready() {}, expand() {}, themeParams: {}, enableClosingConfirmation: tg.enable, disableClosingConfirmation: tg.disable } });
    tg.enable.mockClear();
    tg.disable.mockClear();
    const { rerender } = render(<Form dirty />);
    expect(tg.enable).toHaveBeenCalledTimes(1);
    rerender(<Form dirty={false} />);
    expect(tg.disable).toHaveBeenCalledTimes(1);
  });

  it('смена вкладки спрашивает; повторное нажатие на активную вкладку не спрашивает', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Form dirty />
        <DirtyGuardHost />
        <BottomNav label="Разделы" value="a" onChange={onChange} items={[{ value: 'a', label: 'А', icon: 'user' }, { value: 'b', label: 'Б', icon: 'user' }]} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'А' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Б' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Уйти' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('b'));
  });

  function Screens({ dirty }: { dirty: boolean }) {
    const nav = useNav();
    if (nav.top.screen === 'child') {
      return (
        <main>
          <BackNav onBack={() => nav.back()} managed />
          <Form dirty={dirty} />
        </main>
      );
    }
    return <button onClick={() => nav.push('child')}>открыть</button>;
  }
  const app = (dirty: boolean) => (
    <NavProvider initial="r">
      <NavRoot root="r"><Screens dirty={dirty} /></NavRoot>
      <DirtyGuardHost />
    </NavProvider>
  );

  it('кнопка «Назад» и системная «Назад» с правками спрашивают; отказ оставляет форму и историю', async () => {
    render(app(true));
    fireEvent.click(screen.getByText('открыть'));
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('форма')).toBeInTheDocument();
    // системная «Назад»
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Уйти' }));
    expect(await screen.findByText('открыть')).toBeInTheDocument();
    expect(screen.queryByText('форма')).not.toBeInTheDocument();
  });

  it('без правок «Назад» уходит сразу', async () => {
    render(app(false));
    fireEvent.click(screen.getByText('открыть'));
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('открыть')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
