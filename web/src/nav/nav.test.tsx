import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, NavRoot, useActiveRoot, useNav, useNavScope, useNavState, useResetNav, useRestoreScroll } from '.';
import { BackNav } from '../ui/nav';

function Counter({ label }: { label: string }) {
  const [n, setN] = useNavState('n', 0);
  const [q, setQ] = useNavState('q', '');
  return (
    <div>
      <button onClick={() => setN(n + 1)}>{label}:{n}</button>
      <input aria-label={`q-${label}`} value={q} onChange={e => setQ(e.target.value)} />
    </div>
  );
}

function Host({ scope }: { scope?: string }) {
  const [tab, select] = useActiveRoot<'a' | 'b'>('a');
  useNavScope(scope ?? null);
  const reset = useResetNav();
  return (
    <>
      <button onClick={() => select('a')}>to-a</button>
      <button onClick={() => select('b')}>to-b</button>
      <button onClick={reset}>reset</button>
      <NavRoot root={tab}>
        <Counter label={tab} />
      </NavRoot>
    </>
  );
}

// Общий стек страницы один; даём jsdom доиграть откаты истории от предыдущих тестов
beforeEach(() => new Promise<void>(r => setTimeout(r, 30)));

describe('слой навигации в React', () => {
  it('состояние раздела возвращается при переключении вкладок туда-обратно', () => {
    render(<NavProvider initial="a"><Host /></NavProvider>);
    fireEvent.click(screen.getByText('a:0'));
    fireEvent.change(screen.getByLabelText('q-a'), { target: { value: 'иван' } });
    fireEvent.click(screen.getByText('to-b'));
    expect(screen.getByText('b:0')).toBeInTheDocument(); // у раздела b своё состояние
    fireEvent.click(screen.getByText('to-a'));
    expect(screen.getByText('a:1')).toBeInTheDocument();
    expect(screen.getByLabelText('q-a')).toHaveValue('иван');
  });

  it('смена пользователя очищает состояние, чужое не показывается', () => {
    const { rerender } = render(<NavProvider initial="a"><Host scope="u1:real" /></NavProvider>);
    fireEvent.click(screen.getByText('a:0'));
    expect(screen.getByText('a:1')).toBeInTheDocument();
    rerender(<NavProvider initial="a"><Host scope="u2:real" /></NavProvider>);
    expect(screen.getByText('a:0')).toBeInTheDocument();
  });

  it('выход из аккаунта сбрасывает состояние', () => {
    render(<NavProvider initial="a"><Host scope="u1:real" /></NavProvider>);
    fireEvent.click(screen.getByText('a:0'));
    fireEvent.click(screen.getByText('reset'));
    expect(screen.getByText('a:0')).toBeInTheDocument();
  });
});

function Section() {
  const nav = useNav();
  const [tab, setTab] = useNavState('tab', 'one');
  if (nav.top.screen === 'inner') {
    return (
      <>
        <p>inner {nav.top.params.id}</p>
        <button onClick={() => nav.back()}>closeInner</button>
      </>
    );
  }
  return (
    <>
      <p>list tab={tab}</p>
      <button onClick={() => setTab('two')}>setTab</button>
      <button onClick={() => nav.push('inner', { id: 'p1' })}>open</button>
    </>
  );
}

describe('вложенные экраны и системная «Назад»', () => {
  it('push → back восстанавливает состояние списка; системная «Назад» ведёт по внутренней истории', async () => {
    const hist = vi.spyOn(window.history, 'pushState');
    render(<NavProvider initial="m"><NavRoot root="m"><Section /></NavRoot></NavProvider>);
    fireEvent.click(screen.getByText('setTab'));
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('inner p1')).toBeInTheDocument();
    expect(hist).toHaveBeenCalledTimes(1); // вложенный экран = запись истории
    // системная «Назад»
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByText('list tab=two')).toBeInTheDocument();
  });

  it('кнопка «Назад» на экране возвращает тем же путём', async () => {
    render(<NavProvider initial="m"><NavRoot root="m"><Section /></NavRoot></NavProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('closeInner'));
    expect(screen.getByText('list tab=one')).toBeInTheDocument();
  });
});

describe('BackNav: совместимая оболочка', () => {
  it('в браузере рисует кнопку, и её вызывает системная «Назад»', async () => {
    const onBack = vi.fn();
    const { unmount } = render(<BackNav onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(onBack).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe('восстановление прокрутки', () => {
  function Scroller({ ready }: { ready: boolean }) {
    useRestoreScroll(ready);
    return <div />;
  }
  it('возвращает сохранённую позицию только когда экран готов', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    function App2() {
      const [tab, select] = useActiveRoot<'a' | 'b'>('a');
      return (
        <>
          <button onClick={() => select(tab === 'a' ? 'b' : 'a')}>sw</button>
          <NavRoot root={tab} manualScroll>
            <Scroller ready={true} />
          </NavRoot>
        </>
      );
    }
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
    render(<NavProvider initial="a"><App2 /></NavProvider>);
    fireEvent.click(screen.getByText('sw')); // уходим: запоминается 640
    scrollTo.mockClear();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    fireEvent.click(screen.getByText('sw')); // возвращаемся
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
  });
});

describe('«Ещё» у администратора в приложении', () => {
  it('подраздел сохраняется при переключении вкладок и при повторном нажатии «Ещё»; «Назад» возвращает в каталог', async () => {
    const { fake } = await import('../test/fakeSupabase');
    const { Shell } = await import('../App');
    fake.db.users = [{ id: 'u', is_admin: true, chosen_role: null }];
    fake.db.player_guardians = [];
    fake.db.coach_groups = [];
    fake.db.groups = [];
    fake.db.link_requests = [];
    fake.db.data_requests = [];
    render(<Shell />);
    const nav = await screen.findByRole('navigation', { name: 'Разделы' });
    const bar = (name: string | RegExp) => Array.from(nav.querySelectorAll('button')).find(b => (typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? '')))!;
    fireEvent.click(bar(/Ещё/));
    expect(await screen.findByRole('heading', { name: 'Ещё' })).toBeInTheDocument();
    // открыть первый подраздел каталога
    const firstRow = document.querySelector('.ks-menu button')!;
    fireEvent.click(firstRow);
    await waitFor(() => expect(document.querySelector('.ks-back')).not.toBeNull()); // ссылка «Ещё» вверху подраздела
    // повторное нажатие «Ещё» не сбрасывает подраздел
    fireEvent.click(bar(/Ещё/));
    expect(screen.queryByRole('heading', { name: 'Ещё' })).toBeNull();
    // уходим на другую вкладку и возвращаемся
    fireEvent.click(nav.querySelectorAll('button')[0]);
    fireEvent.click(bar(/Ещё/));
    expect(screen.queryByRole('heading', { name: 'Ещё' })).toBeNull();
    // «Назад» (ссылка вверху) возвращает в каталог
    fireEvent.click(document.querySelector('.ks-back')!);
    expect(await screen.findByRole('heading', { name: 'Ещё' })).toBeInTheDocument();
  });
});
