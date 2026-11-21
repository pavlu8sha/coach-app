import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import About from './About';
import Home from './Home';
import Link from './Link';
import LinkStatus from './LinkStatus';
import Schedule from './Schedule';
import TrialForm from './TrialForm';

// Условия приёмки: docs/acceptance/link-screens-2026-11-21.md (С10-С15)
const YEAR = new Date().getFullYear();
type W = { Telegram?: { WebApp?: unknown } };
const tgApp = () => ({
  initData: 'x', themeParams: {},
  MainButton: { setText: vi.fn(), show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn(), enable: vi.fn(), disable: vi.fn(), showProgress: vi.fn(), hideProgress: vi.fn(), setParams: vi.fn() },
});
const kid = (id: string, name: string) => ({ player_id: id, user_id: 'u', consent_revoked_at: null, players: { id, full_name: name, groups: null } });

beforeEach(() => fake.reset());
afterEach(() => { delete (window as unknown as W).Telegram; });

describe('С10: имя ребёнка в запросе', () => {
  it('«Статус привязки» показывает имя из my_link_requests(), когда прямой выбор отдаёт players = null', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: null }];
    fake.rpc.my_link_requests = () => [{ id: 'r1', status: 'pending', player_id: 'p1', full_name: 'Starostenko Timofey', group_name: 'U10-A' }];
    render(<LinkStatus onBack={() => undefined} />);
    expect(await screen.findByText('Starostenko Timofey')).toBeInTheDocument();
    expect(screen.queryByText('Игрок')).toBeNull();
  });

  it('функции в базе ещё нет: экран работает прежним выбором, без ошибки пользователю', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    fake.rpc.my_link_requests = () => ({ error: { message: 'Could not find the function public.my_link_requests', code: 'PGRST202' } });
    render(<LinkStatus onBack={() => undefined} />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('С11: согласие после подтверждения', () => {
  const pending = [{ player_id: 'p1', full_name: 'Starostenko Timofey', group_name: 'U10-A', version_id: 'v1', version: 'syn-v1' }];

  it('запрос подтверждён, а доступ закрыт согласием: экран «Примите согласие», кнопка активна только с галочкой, принятие открывает ребёнка', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'approved', players: null }];
    let accepted = false;
    fake.rpc.my_pending_consents = () => (accepted ? [] : pending);
    fake.rpc.accept_consent = () => { accepted = true; fake.db.player_guardians = [kid('p1', 'Starostenko Timofey')]; return { changed: true }; };
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Примите согласие' })).toBeInTheDocument();
    expect(screen.getByText('Starostenko Timofey')).toBeInTheDocument();
    expect(screen.queryByText('Ребёнок пока не отображается')).toBeNull();
    const accept = screen.getByRole('button', { name: 'Принять согласие' });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(accept).toBeEnabled();
    fireEvent.click(accept);
    expect(await screen.findByRole('heading', { name: 'Мой ребёнок' })).toBeInTheDocument();
    expect(fake.rpcCalls('accept_consent')).toEqual([{ p: 'p1', t: 'data_processing', ver: 'v1' }]);
  });

  it('сбой принятия: понятное сообщение, кнопка не зависает, технического текста нет', async () => {
    fake.rpc.my_pending_consents = () => pending;
    fake.rpc.accept_consent = () => ({ error: { message: 'consent version changed SQLSTATE 23514' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Home />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Принять согласие' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SQLSTATE|23514|consent version/);
    expect(screen.getByRole('button', { name: 'Принять согласие' })).toBeEnabled();
    spy.mockRestore();
  });

  it('функции нет в базе или нечего принимать: прежний экран «Ребёнок пока не отображается»', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'approved', players: null }];
    fake.rpc.my_pending_consents = () => ({ error: { message: 'Could not find the function public.my_pending_consents', code: 'PGRST202' } });
    render(<Home />);
    expect(await screen.findByText('Ребёнок пока не отображается')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Примите согласие' })).toBeNull();
  });

  it('RPC вернул обычную ошибку (права, 500): ошибка загрузки с повтором, не онбординг', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'approved', players: null }];
    fake.rpc.my_pending_consents = () => ({ error: { message: 'permission denied for function my_pending_consents', code: '42501' } });
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(screen.queryByText('Ребёнок пока не отображается')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/permission denied|42501/);
  });

  it('RPC выбросил rejected Promise (сбой сети): ошибка загрузки, не пустой список', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'approved', players: null }];
    fake.rpc.my_pending_consents = () => Promise.reject(new Error('Failed to fetch'));
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.queryByText('Ребёнок пока не отображается')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Failed to fetch/);
  });

  it('повтор после ошибки: при успешном ответе показывается экран согласия', async () => {
    let fail = true;
    fake.rpc.my_pending_consents = () => (fail ? { error: { message: 'boom', code: '500' } } : pending);
    render(<Home />);
    fireEvent.click(await screen.findByRole('button', { name: /Повторить/ }));
    fail = false;
    expect(await screen.findByRole('heading', { name: 'Примите согласие' })).toBeInTheDocument();
  });

  it('успешный пустой массив: обычный онбординг', async () => {
    fake.rpc.my_pending_consents = () => [];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить данные')).toBeNull();
  });

  it('нативная кнопка Telegram «Принять согласие» показывается только после галочки', async () => {
    const app = tgApp();
    (window as unknown as W).Telegram = { WebApp: app };
    fake.rpc.my_pending_consents = () => pending;
    render(<Home />);
    fireEvent.click(await screen.findByRole('checkbox'));
    await waitFor(() => expect(app.MainButton.show).toHaveBeenCalled());
    expect(app.MainButton.setText).toHaveBeenCalledWith('Принять согласие');
  });
});

describe('С16: второй ребёнок ждёт согласия при уже видимом первом', () => {
  it('карточка первого ребёнка и блок «Примите согласие» для второго; после принятия блок исчезает', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров')];
    let accepted = false;
    fake.rpc.my_pending_consents = () => (accepted ? [] : [{ player_id: 'p2', full_name: 'Мария Петрова', group_name: null, version_id: 'v1', version: 'syn-v1' }]);
    fake.rpc.accept_consent = () => { accepted = true; fake.db.player_guardians = [kid('p1', 'Алексей Петров'), kid('p2', 'Мария Петрова')]; return { changed: true }; };
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Примите согласие' })).toBeInTheDocument();
    expect(screen.getByText('Мария Петрова')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Принять согласие' }));
    expect(await screen.findByRole('heading', { name: 'Мои дети' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Примите согласие' })).toBeNull();
    expect(fake.rpcCalls('accept_consent')).toEqual([{ p: 'p2', t: 'data_processing', ver: 'v1' }]);
  });
  it('сбой проверки при уже видимом ребёнке: ошибка загрузки с повтором, а не молчаливое отсутствие блока', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров')];
    fake.rpc.my_pending_consents = () => ({ error: { message: 'boom', code: '500' } });
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
  });
});

describe('С17: ошибка загрузки запросов на привязку не скрывается на главной', () => {
  it('RPC 42501/500: ошибка загрузки с повтором, даже когда ребёнок уже виден; технического текста нет', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров')];
    fake.rpc.my_link_requests = () => ({ error: { message: 'permission denied for function my_link_requests', code: '42501' } });
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/permission denied|42501/);
  });

  it('rejected Promise: ошибка загрузки, не пустой блок запросов', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    fake.rpc.my_link_requests = () => Promise.reject(new Error('Failed to fetch'));
    fake.rejects.link_requests = 'Failed to fetch'; // прямой выбор тоже не отвечает: сети нет
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeNull();
  });

  it('RPC выбросил rejected Promise, а прямой SELECT link_requests успешен: fallback не маскирует сбой, Failure с повтором', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    fake.rpc.my_link_requests = () => Promise.reject(new Error('Failed to fetch')); // прямой выбор НЕ падает
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Запрос отправлен' })).toBeNull();
  });

  it('общая ошибка «schema cache» без PGRST202 и без имени функции не считается отсутствием функции', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    fake.rpc.my_link_requests = () => ({ error: { message: 'schema cache is being reloaded', code: 'PGRST000' } });
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
  });

  it('повтор после ошибки: запросы показываются', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    let fail = true;
    fake.rpc.my_link_requests = () => (fail ? { error: { message: 'boom', code: '500' } } : [{ id: 'r1', status: 'pending', player_id: 'p1', full_name: 'Алексей Петров', group_name: null }]);
    render(<Home />);
    fireEvent.click(await screen.findByRole('button', { name: /Повторить/ }));
    fail = false;
    expect(await screen.findByRole('heading', { name: 'Запрос отправлен' })).toBeInTheDocument();
  });

  it('PGRST202 (функции ещё нет): прежний выбор, ошибки нет; успешный пустой ответ: обычный онбординг', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    fake.rpc.my_link_requests = () => ({ error: { message: 'Could not find the function', code: 'PGRST202' } });
    const first = render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Запрос отправлен' })).toBeInTheDocument();
    first.unmount();
    fake.db.link_requests = [];
    fake.rpc.my_link_requests = () => [];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить данные')).toBeNull();
  });
});

describe('С12: поиск ребёнка', () => {
  const found = [{ player_id: 'p1', full_name: 'Starostenko Timofey', group_name: 'U10-A' }];
  const pick = async () => {
    fake.rpc.search_players_for_link = () => found;
    fireEvent.change(screen.getByLabelText('Фамилия или имя ребёнка'), { target: { value: 'star' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    fireEvent.click(await screen.findByRole('button', { name: /Starostenko Timofey/ }));
  };

  it('выбранная строка отмечена (aria-pressed), плашки «Выбрано» под группой нет', async () => {
    render(<Link />);
    await pick();
    expect(screen.getByRole('button', { name: /Starostenko Timofey/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Выбрано')).toBeNull();
  });

  it('нативная кнопка Telegram «Отправить запрос» не показывается без галочки, с галочкой появляется, после снятия скрывается', async () => {
    const app = tgApp();
    (window as unknown as W).Telegram = { WebApp: app };
    render(<Link />);
    await pick();
    expect(app.MainButton.show).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(app.MainButton.show).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(app.MainButton.hide).toHaveBeenCalled());
  });
});

describe('С13: «Расписание» без детей', () => {
  it('гость, ребёнок и любой экран «все группы» без групп: без слов про подтверждение связи', async () => {
    fake.db.groups = [];
    render(<Schedule all editable={false} />);
    expect(await screen.findByText('Расписание групп пока не опубликовано. Загляните позже.')).toBeInTheDocument();
    expect(screen.queryByText(/подтвердит связь/)).toBeNull();
  });

  it('родитель без привязанных детей: прежний текст про связь остаётся', async () => {
    fake.db.player_guardians = [];
    render(<Schedule />);
    expect(await screen.findByText(/подтвердит связь с ребёнком/)).toBeInTheDocument();
  });
});

describe('С14: «О клубе»', () => {
  it('роль «Ребёнок»: кнопки «Написать администратору» нет', () => {
    render(<About role="child" onChangeRole={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Написать администратору' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Филиалы/ })).toBeInTheDocument();
  });
  it('гость остаётся с кнопкой', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    expect(screen.getByRole('link', { name: 'Написать администратору' })).toBeInTheDocument();
  });
});

describe('С15: заявка на пробную тренировку', () => {
  const t = (p: string, v: string) => fireEvent.change(screen.getByPlaceholderText(p), { target: { value: v } });
  it('год 2003: сказано, какой год нужен, кнопка неактивна; с верным годом подсказка исчезает и кнопка активна', () => {
    render(<TrialForm startOpen />);
    t('Ваше имя', 'Павел'); t('Имя и фамилия ребёнка', 'Ivan Petrov'); t('Год рождения ребёнка', '2003'); t('Телефон', '+79779518241');
    fireEvent.click(screen.getByRole('checkbox'));
    const btn = screen.getByRole('button', { name: 'Отправить заявку' });
    expect(btn).toBeDisabled();
    expect(screen.getByText(new RegExp(`год рождения ребёнка от ${YEAR - 18} до ${YEAR - 2}`))).toBeInTheDocument();
    t('Год рождения ребёнка', String(YEAR - 8));
    expect(btn).toBeEnabled();
    expect(screen.queryByText(/год рождения ребёнка от/)).toBeNull();
  });
  it('пустая форма: перечислено, чего не хватает, в том числе согласие', () => {
    render(<TrialForm startOpen />);
    expect(screen.getByText(/Чтобы отправить заявку/)).toHaveTextContent(/имя родителя/);
    expect(screen.getByText(/Чтобы отправить заявку/)).toHaveTextContent(/согласие/);
  });
});
