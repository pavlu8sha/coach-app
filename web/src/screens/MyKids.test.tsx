import { Profiler, StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fake, supabase } from '../test/fakeSupabase';
import MyKids from './MyKids';

const kid = (id: string, name: string) => ({ user_id: 'u', consent_revoked_at: null, players: { id, full_name: name, groups: { name: 'U9' } } });
const realGetUser = supabase.auth.getUser;
const row = (name: string) => screen.getByText(name).closest('div')!.parentElement!; // блок ребёнка: строка и действия под ней
const CODE = 'Код для ребёнка';
const UNLINK = 'Отвязать аккаунт ребёнка';
const RETRY = 'Повторить проверку';

// ответ child_linked под управлением теста
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};

describe('«Мои дети»: статус привязки ребёнка (#735)', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.player_guardians = [kid('p1', 'Иван Петров')];
  });
  afterEach(() => { supabase.auth.getUser = realGetUser; });

  it('пока статус неизвестен: ни «Код для ребёнка», ни «Отвязать», есть «Проверяю…»; нажать нечего', async () => {
    const d = deferred<boolean>();
    fake.rpc.child_linked = () => d.promise;
    render(<MyKids onBack={() => {}} />);
    await screen.findByText('Иван Петров');
    await waitFor(() => expect(fake.rpcCalls('child_linked')).toEqual([{ p: 'p1' }]));
    expect(screen.getByRole('status')).toHaveTextContent('Проверяю привязку аккаунта');
    expect(screen.queryByRole('button', { name: CODE })).toBeNull();
    expect(screen.queryByRole('button', { name: UNLINK })).toBeNull();
    expect(fake.rpcCalls('create_child_code')).toHaveLength(0);
    await act(async () => d.resolve(false));
    expect(await screen.findByRole('button', { name: CODE })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('linked: только «Отвязать аккаунт ребёнка»', async () => {
    fake.rpc.child_linked = () => true;
    render(<MyKids onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: UNLINK })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CODE })).toBeNull();
  });

  it('не привязан: только «Код для ребёнка», код создаётся и показывается', async () => {
    fake.rpc.child_linked = () => false;
    fake.rpc.create_child_code = () => 'ABC123';
    render(<MyKids onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: CODE }));
    expect(screen.queryByRole('button', { name: UNLINK })).toBeNull();
    expect(await screen.findByText('ABC123')).toBeInTheDocument();
    expect(fake.rpcCalls('create_child_code')).toEqual([{ p: 'p1' }]);
  });

  it('ошибка RPC: безопасное сообщение без техтекста, действий нет, ошибка не равна «не привязан»', async () => {
    fake.rpc.child_linked = () => ({ error: { message: 'JWT expired: relation child_links 42P01' } });
    render(<MyKids onBack={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить привязку аккаунта ребёнка');
    expect(document.body.textContent).not.toMatch(/JWT|42P01|child_links/);
    expect(screen.queryByRole('button', { name: CODE })).toBeNull();
    expect(screen.queryByRole('button', { name: UNLINK })).toBeNull();
    expect(screen.getByRole('button', { name: RETRY })).toBeInTheDocument();
    expect(fake.rpcCalls('create_child_code')).toHaveLength(0);
  });

  it('ответ без ошибки, но не true/false (null): тоже ошибка проверки, а не «не привязан»', async () => {
    fake.rpc.child_linked = () => null;
    render(<MyKids onBack={() => {}} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CODE })).toBeNull();
  });

  it('повтор после ошибки: заново child_linked для ребёнка, затем действие по ответу', async () => {
    let n = 0;
    fake.rpc.child_linked = () => (++n === 1 ? { error: { message: 'сеть' } } : true);
    render(<MyKids onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: RETRY }));
    expect(await screen.findByRole('button', { name: UNLINK })).toBeInTheDocument();
    expect(fake.rpcCalls('child_linked')).toEqual([{ p: 'p1' }, { p: 'p1' }]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: CODE })).toBeNull();
  });

  it('несколько детей: состояния независимы (linked, ещё грузится, ошибка)', async () => {
    fake.db.player_guardians = [kid('p1', 'Иван Петров'), kid('p2', 'Мария Иванова'), kid('p3', 'Олег Сидоров')];
    const pending = deferred<boolean>();
    fake.rpc.child_linked = ({ p }: { p: string }) => (p === 'p1' ? true : p === 'p2' ? pending.promise : { error: { message: 'сбой' } });
    render(<MyKids onBack={() => {}} />);
    await within(await findRow('Иван Петров')).findByRole('button', { name: UNLINK });
    await within(row('Олег Сидоров')).findByRole('alert');
    const p2 = row('Мария Иванова');
    expect(within(p2).getByRole('status')).toBeInTheDocument();
    expect(within(p2).queryByRole('button', { name: CODE })).toBeNull();
    expect(within(p2).queryByRole('button', { name: UNLINK })).toBeNull();
    expect(within(row('Иван Петров')).queryByRole('button', { name: CODE })).toBeNull();
    expect(within(row('Олег Сидоров')).queryByRole('button', { name: CODE })).toBeNull();
    await act(async () => pending.resolve(false));
    await within(row('Мария Иванова')).findByRole('button', { name: CODE });
    // повтор у третьего не трогает остальных
    fake.calls.length = 0;
    fake.rpc.child_linked = () => false;
    fireEvent.click(within(row('Олег Сидоров')).getByRole('button', { name: RETRY }));
    await within(row('Олег Сидоров')).findByRole('button', { name: CODE });
    expect(fake.rpcCalls('child_linked')).toEqual([{ p: 'p3' }]);
  });

  it('устаревший ответ проверки не затирает более новый (перезагрузка списка после отзыва другого ребёнка)', async () => {
    fake.db.player_guardians = [kid('p1', 'Иван Петров'), kid('p2', 'Мария Иванова')];
    const first = deferred<boolean>();
    let calls = 0;
    fake.rpc.child_linked = ({ p }: { p: string }) => (p === 'p1' && ++calls === 1 ? first.promise : p === 'p1' ? true : false);
    fake.rpc.revoke_consent = () => null;
    render(<MyKids onBack={() => {}} />);
    await within(await findRow('Мария Иванова')).findByRole('button', { name: CODE });
    // первая проверка p1 ещё висит; отзыв p2 перезагружает список и запускает вторую проверку p1
    fireEvent.click(within(row('Мария Иванова')).getByRole('button', { name: 'Отозвать согласие' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отозвать согласие' }));
    await within(await findRow('Иван Петров')).findByRole('button', { name: UNLINK });
    await act(async () => first.resolve(false)); // устаревший ответ «не привязан» приходит последним
    expect(within(row('Иван Петров')).getByRole('button', { name: UNLINK })).toBeInTheDocument();
    expect(within(row('Иван Петров')).queryByRole('button', { name: CODE })).toBeNull();
  });

  it('начало перезагрузки списка: уже в первом коммите после запуска старых действий нет (окно до эффекта закрыто)', async () => {
    fake.db.player_guardians = [kid('p1', 'Иван Петров'), kid('p2', 'Мария Иванова')];
    fake.rpc.child_linked = ({ p }: { p: string }) => p === 'p1';
    let recording = false;
    const commits: string[][] = []; // кнопки действий в каждом коммите после ответа revoke_consent (там же запускается перезагрузка)
    fake.rpc.revoke_consent = () => { recording = true; return null; };
    render(
      <Profiler id="kids" onRender={() => { if (recording) commits.push([...document.querySelectorAll('button')].map(b => b.textContent ?? '').filter(t => t === CODE || t === UNLINK)); }}>
        <MyKids onBack={() => {}} />
      </Profiler>,
    );
    await within(await findRow('Иван Петров')).findByRole('button', { name: UNLINK });
    await within(row('Мария Иванова')).findByRole('button', { name: CODE });
    const gate = deferred<void>(); // новая загрузка списка не завершается: статусы не должны вернуться
    supabase.auth.getUser = async () => { await gate.promise; return realGetUser(); };
    fireEvent.click(within(row('Иван Петров')).getByRole('button', { name: 'Отозвать согласие' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отозвать согласие' }));
    await waitFor(() => expect(commits.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(2));
    expect(commits.flat(), 'в коммитах после запуска перезагрузки не должно быть кнопок действий').toEqual([]);
    await act(async () => gate.resolve());
  });

  it('StrictMode (повторный запуск эффектов): проверка доходит до linked и free', async () => {
    fake.db.player_guardians = [kid('p1', 'Иван Петров'), kid('p2', 'Мария Иванова')];
    fake.rpc.child_linked = ({ p }: { p: string }) => p === 'p1';
    render(<StrictMode><MyKids onBack={() => {}} /></StrictMode>);
    await within(await findRow('Иван Петров')).findByRole('button', { name: UNLINK });
    await within(row('Мария Иванова')).findByRole('button', { name: CODE });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('повторная загрузка списка: прежние linked/free сразу недействительны, действий нет, RPC не вызывается', async () => {
    fake.db.player_guardians = [kid('p1', 'Иван Петров'), kid('p2', 'Мария Иванова')];
    fake.rpc.child_linked = ({ p }: { p: string }) => p === 'p1';
    fake.rpc.revoke_consent = () => null;
    render(<MyKids onBack={() => {}} />);
    await within(await findRow('Иван Петров')).findByRole('button', { name: UNLINK });
    await within(row('Мария Иванова')).findByRole('button', { name: CODE });
    // перезагрузка списка «зависает» на получении пользователя: новая проверка ещё не началась
    const gate = deferred<void>();
    supabase.auth.getUser = async () => { await gate.promise; return realGetUser(); };
    fireEvent.click(within(row('Иван Петров')).getByRole('button', { name: 'Отозвать согласие' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отозвать согласие' }));
    await waitFor(() => expect(fake.rpcCalls('revoke_consent')).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(2)); // у обоих снова «Проверяю…»
    expect(screen.queryByRole('button', { name: UNLINK })).toBeNull();
    expect(screen.queryByRole('button', { name: CODE })).toBeNull();
    expect(fake.rpcCalls('create_child_code')).toHaveLength(0);
    expect(fake.rpcCalls('unlink_child')).toHaveLength(0);
    supabase.auth.getUser = realGetUser;
    await act(async () => gate.resolve());
    await within(await findRow('Мария Иванова')).findByRole('button', { name: CODE });
  });

  it('«Отозвать согласие» доступно всегда, в том числе пока статус неизвестен и при ошибке', async () => {
    const d = deferred<boolean>();
    fake.rpc.child_linked = () => d.promise;
    render(<MyKids onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Отозвать согласие' })).toBeInTheDocument();
    await act(async () => d.resolve(true));
  });
});

const findRow = async (name: string) => {
  await screen.findByText(name);
  return row(name);
};
