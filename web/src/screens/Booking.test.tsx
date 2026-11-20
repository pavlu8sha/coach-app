import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { supabase } from '../lib/supabase';
import Booking from './Booking';

// Подписка на смену пользователя: заглушка Supabase её не содержит, подставляем на время теста (#765, п. 8)
const captured: { cb?: (ev: string, s: unknown) => void } = {};
const auth = (supabase as any).auth;
beforeEach(() => {
  captured.cb = undefined;
  auth.onAuthStateChange = (cb: (ev: string, s: unknown) => void) => { captured.cb = cb; return { data: { subscription: { unsubscribe() { captured.cb = undefined; } } } }; };
});
afterEach(() => { delete auth.onAuthStateChange; });

const start = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
const board = (mine: unknown[] = [], booked: string[] = []) => [{ kind: 'individual', session_id: 's1', starts_at: start, title: 'Индивидуальная тренировка', place: null, capacity: 3, amount: 50, booked, mine }];

describe('Запись на занятия', () => {
  it('родитель видит места и записавшихся и записывает ребёнка', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], ['Боря Второй']);
    fake.rpc.booking_signup = () => null;
    render(<Booking />);
    expect(await screen.findByText('Мест: 2')).toBeInTheDocument();
    expect(screen.getByText('Записаны:')).toBeInTheDocument();
    expect(screen.getByText('Боря Второй').tagName).toBe('LI');
    fireEvent.click(screen.getByRole('button', { name: 'Записать: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('записанный ребёнок: видна оплата, запись можно отменить', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: false, amount: 50 }], ['Аня Первая']);
    fake.rpc.booking_cancel = () => null;
    render(<Booking />);
    expect(await screen.findByText('Не оплачено 50 ₾')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_cancel')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('оплаченную запись можно отменить: оплата сохранится, решит администратор', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: true, amount: 50 }], ['Аня Первая']);
    fake.rpc.booking_cancel = () => null;
    render(<Booking />);
    expect(await screen.findByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText(/Оплата сохранится: администратор решит/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_cancel')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('начавшееся занятие и отмеченная запись: родитель видит понятный отказ', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: false, amount: 50 }], ['Аня Первая']);
    fake.rpc.booking_cancel = () => ({ error: { message: 'session already started' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить запись: Аня Первая' }));
    expect(await screen.findByText(/Занятие уже началось/)).toBeInTheDocument();
    fake.rpc.booking_cancel = () => ({ error: { message: 'attendance marked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' }));
    expect(await screen.findByText(/На занятии уже отмечена посещаемость/)).toBeInTheDocument();
  });

  it('дополнительная тренировка со временем: в карточке видно время начала', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    fake.rpc.booking_board = () => [{ kind: 'extra', session_id: 'x1', starts_at: `${day}T19:00:00`, title: 'Дополнительная тренировка', place: 'Зал', capacity: null, amount: 20, booked: [], mine: [] }];
    render(<Booking />);
    expect(await screen.findByText(/Дополнительная: .*19:00/)).toBeInTheDocument();
  });

  it('дополнительная тренировка с окончанием: в карточке «19:00–20:30»', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    fake.rpc.booking_board = () => [{ kind: 'extra', session_id: 'x1', starts_at: `${day}T19:00:00`, ends_at: `${day}T20:30:00`, title: 'Дополнительная тренировка', place: 'Зал', capacity: null, amount: 20, booked: [], mine: [] }];
    render(<Booking />);
    expect(await screen.findByText(/Дополнительная: .*19:00–20:30/)).toBeInTheDocument();
  });

  it('мест нет: вместо записи кнопка очереди, вставание в очередь уходит в функцию', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => [{ ...board([], ['А', 'Б', 'В'])[0] }];
    fake.rpc.waitlist_board = () => [];
    fake.rpc.waitlist_join = () => null;
    render(<Booking />);
    const card = (await screen.findByText('Мест нет')).closest('section') as HTMLElement;
    expect(within(card).queryByRole('button', { name: 'Записать: Аня Первая' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Встать в очередь: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('waitlist_join')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('в очереди: позиция; при свободном месте можно занять, выйти можно всегда', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => [{ ...board([], ['А', 'Б', 'В'])[0] }];
    fake.rpc.waitlist_board = () => [{ kind: 'individual', session_id: 's1', player_id: 'p1', pos: 2, total: 3, offer: false }];
    fake.rpc.waitlist_leave = () => null;
    render(<Booking />);
    expect(await screen.findByText('В очереди: 2 из 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Занять место: Аня Первая' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из очереди: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('waitlist_leave')).toHaveLength(1));
  });

  it('есть предложение: кнопка «Занять место»; проигравшему гонку понятный текст', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], ['А', 'Б']);
    fake.rpc.waitlist_board = () => [{ kind: 'individual', session_id: 's1', player_id: 'p1', pos: 1, total: 1, offer: true }];
    fake.rpc.waitlist_claim = () => ({ error: { message: 'session full' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Занять место: Аня Первая' }));
    expect(await screen.findByText(/место успел занять другой родитель/)).toBeInTheDocument();
    expect(fake.rpcCalls('waitlist_claim')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]);
  });

  it('пустая доска: понятное пустое состояние', async () => {
    fake.db.player_guardians = [];
    fake.rpc.booking_board = () => [];
    render(<Booking />);
    expect(await screen.findByText('Занятий для записи пока нет')).toBeInTheDocument();
  });

  it('ребёнок не в статусе «Занимается»: понятное сообщение', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], []);
    fake.rpc.booking_signup = () => ({ error: { message: 'player not active' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Записать: Аня Первая' }));
    expect(await screen.findByText(/ребёнок сейчас не в статусе «Занимается»/)).toBeInTheDocument();
  });

  it('дополнительная для целевых групп: кнопка записи только у допущенных детей', async () => {
    fake.db.player_guardians = [
      { user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } },
      { user_id: 'u', consent_revoked_at: null, players: { id: 'p2', full_name: 'Боря Второй' } },
    ];
    fake.rpc.booking_board = () => [{ kind: 'extra', session_id: 'e1', starts_at: start, title: 'Дополнительная тренировка', place: 'Зал', capacity: 5, amount: 20, booked: [], mine: [], eligible: ['p1'] }];
    render(<Booking />);
    expect(await screen.findByRole('button', { name: 'Записать: Аня Первая' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Записать: Боря Второй' })).toBeNull();
  });

  it('«not eligible» объясняется понятным текстом', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], []);
    fake.rpc.booking_signup = () => ({ error: { message: 'not eligible' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Записать: Аня Первая' }));
    expect(await screen.findByText(/не для группы ребёнка/)).toBeInTheDocument();
  });

  it('пересечение: предупреждение перед записью, запись по подтверждению', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board();
    fake.rpc.waitlist_board = () => [];
    fake.rpc.booking_conflicts = () => [{ kind: 'training', label: 'Тренировка группы', starts_at: '2099-01-01T18:30:00', ends_at: null }];
    fake.rpc.booking_signup = () => null;
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Записать: Аня Первая' }));
    expect(await screen.findByText(/уже есть: Тренировка группы \(18:30\)/)).toBeInTheDocument();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Всё равно записать: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toHaveLength(1));
  });

  it('информационный баннер при первом входе: «Понятно» отмечает показанным', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board();
    fake.rpc.booking_info_pending = () => true;
    fake.rpc.booking_info_seen = () => null;
    render(<Booking />);
    expect(await screen.findByText('Запись на тренировки теперь здесь')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    await waitFor(() => expect(fake.rpcCalls('booking_info_seen')).toHaveLength(1));
    expect(screen.queryByText('Запись на тренировки теперь здесь')).toBeNull();
  });
});

const ANYA = { user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } };
const signupBtn = 'Записать: Аня Первая';
const deferred = <T,>() => { let ok!: (v: T) => void; const promise = new Promise<T>(r => { ok = r; }); return { promise, ok }; };
const noActions = () => {
  for (const n of ['Записать: Аня Первая', 'Встать в очередь: Аня Первая', 'Отменить запись: Аня Первая', 'Выйти из очереди: Аня Первая', 'Занять место: Аня Первая']) expect(screen.queryByRole('button', { name: n })).toBeNull();
};

describe('#765: загрузка связанных детей', () => {
  it('1: непустой список: кнопка записи, блока ошибки нет', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = () => board();
    render(<Booking />);
    expect(await screen.findByRole('button', { name: signupBtn })).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить список детей')).toBeNull();
    expect(screen.queryByText(/не привязан ни один ребёнок/)).toBeNull();
  });

  it('2: успешный пустой список: нейтральная строка, без ошибки и кнопок', async () => {
    fake.db.player_guardians = [];
    fake.rpc.booking_board = () => board();
    render(<Booking />);
    expect(await screen.findByText(/К профилю не привязан ни один ребёнок/)).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить список детей')).toBeNull();
    expect(screen.queryByRole('button', { name: /Записать:/ })).toBeNull();
  });

  it('3: ошибка Supabase: ошибка видна, ложного «нет детей» нет, действий нет, занятия видны', async () => {
    fake.rpc.my_children = () => ({ error: { message: 'relation "player_guardians" does not exist (42P01)' } });
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: false, amount: 50 }], ['Аня Первая']);
    render(<Booking />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Не удалось загрузить список детей')).toBeInTheDocument();
    expect(alert.textContent).not.toMatch(/42P01|player_guardians/);
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText(/не привязан ни один ребёнок/)).toBeNull();
    expect(screen.getByText(/Индивидуальная: /)).toBeInTheDocument();
    noActions();
  });

  it('4: rejected promise: то же состояние, «Нет связи»', async () => {
    fake.rpc.my_children = () => Promise.reject(new Error('Failed to fetch'));
    fake.rpc.booking_board = () => board();
    render(<Booking />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Не удалось загрузить список детей')).toBeInTheDocument();
    expect(alert.textContent).toMatch(/Нет связи/);
    expect(screen.queryByText(/не привязан ни один ребёнок/)).toBeNull();
    noActions();
  });

  it('5: повтор после ошибки восстанавливает экран', async () => {
    fake.rpc.my_children = () => ({ error: { message: 'boom' } });
    fake.rpc.booking_board = () => board();
    render(<Booking />);
    const retry = within(await screen.findByRole('alert')).getByRole('button', { name: 'Повторить' });
    delete fake.rpc.my_children;
    fake.db.player_guardians = [ANYA];
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: signupBtn })).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить список детей')).toBeNull();
    expect(fake.rpcCalls('booking_board')).toHaveLength(2);
  });

  it('6: нет пользователя: как на сервере (booking_board → forbidden) полноэкранная ошибка, детей не читаем', async () => {
    fake.user = null;
    fake.rpc.booking_board = () => ({ error: { message: 'forbidden', code: '42501' } }); // контракт миграции 0045: без пользователя forbidden
    render(<Booking />);
    expect(await screen.findByText('Не удалось загрузить занятия')).toBeInTheDocument();
    expect(fake.rpcCalls('booking_board')).toHaveLength(0); // без пользователя запросы не уходят
    expect(fake.rpcCalls('my_children')).toHaveLength(0);
    noActions();
  });

  it('7: устаревший ответ не применяется: поздний успех прежней загрузки не затирает ошибку последней', async () => {
    fake.db.player_guardians = [ANYA];
    const first = deferred<unknown>();
    let n = 0;
    fake.rpc.booking_board = () => (++n === 1 ? first.promise : board());
    render(<Booking />);
    await waitFor(() => expect(n).toBe(1));
    // вторая загрузка (смена пользователя) завершается ошибкой детей
    fake.user = { id: 'u2' };
    fake.rpc.my_children = () => ({ error: { message: 'boom' } });
    captured.cb?.('SIGNED_IN', { user: { id: 'u2' } });
    expect(await screen.findByText('Не удалось загрузить список детей')).toBeInTheDocument();
    first.ok(board());
    await new Promise(r => setTimeout(r, 20));
    expect(screen.getByText('Не удалось загрузить список детей')).toBeInTheDocument();
    noActions();
  });

  it('8: смена пользователя перезагружает; тот же пользователь (токен) не перезагружает; ответ прежнего не применяется', async () => {
    fake.db.player_guardians = [ANYA];
    const old = deferred<unknown>();
    let n = 0;
    fake.rpc.booking_board = () => (++n === 1 ? old.promise : [{ ...board()[0], title: 'Занятие нового пользователя' }]);
    render(<Booking />);
    await waitFor(() => expect(n).toBe(1));
    captured.cb?.('TOKEN_REFRESHED', { user: { id: 'u' } }); // тот же пользователь
    await new Promise(r => setTimeout(r, 10));
    expect(n).toBe(1);
    fake.user = { id: 'u2' };
    fake.db.player_guardians = [{ user_id: 'u2', consent_revoked_at: null, players: { id: 'p9', full_name: 'Новый Ребёнок' } }];
    captured.cb?.('SIGNED_IN', { user: { id: 'u2' } });
    expect(await screen.findByRole('button', { name: 'Записать: Новый Ребёнок' })).toBeInTheDocument();
    old.ok([{ ...board()[0], title: 'Занятие прежнего пользователя' }]);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText(/прежнего пользователя/)).toBeNull();
    expect(screen.getByText(/нового пользователя/)).toBeInTheDocument();
  });

  it('9: booking_board: ошибка и rejected promise дают полноэкранную ошибку с повтором', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = () => ({ error: { message: 'boom' } });
    const { unmount } = render(<Booking />);
    expect(await screen.findByText('Не удалось загрузить занятия')).toBeInTheDocument();
    unmount();
    fake.rpc.booking_board = () => Promise.reject(new TypeError('Failed to fetch'));
    render(<Booking />);
    expect(await screen.findByText('Не удалось загрузить занятия')).toBeInTheDocument();
    expect(screen.getByText(/Нет связи/)).toBeInTheDocument();
  });

  it('11: список детей берётся из my_children() сервера: режим all, consent_revoked_at не участвует', async () => {
    // сервер (parent_access_ok) допускает ребёнка, хотя старое поле отзыва не пустое: прежний клиентский фильтр скрыл бы его
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: '2026-11-01T00:00:00Z', players: { id: 'p9', full_name: 'Не из таблицы' } }];
    fake.rpc.my_children = () => [{ player_id: 'p1', full_name: 'Аня Первая', group_id: null, group_name: null }];
    fake.rpc.booking_board = () => board();
    render(<Booking />);
    expect(await screen.findByRole('button', { name: signupBtn })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Не из таблицы/ })).toBeNull();
    expect(fake.calls.filter(c => c.name === 'player_guardians')).toHaveLength(0); // таблицу связей экран не читает
  });

  it('10: отозванное согласие: ребёнок в список не попадает (доступ не расширен)', async () => {
    fake.db.player_guardians = [ANYA, { user_id: 'u', consent_revoked_at: '2026-11-01T00:00:00Z', players: { id: 'p2', full_name: 'Боря Второй' } }];
    fake.rpc.booking_board = () => board();
    render(<Booking />);
    expect(await screen.findByRole('button', { name: signupBtn })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Записать: Боря Второй' })).toBeNull();
  });
});

describe('#766: очередь ожидания', () => {
  const full = () => [{ ...board([], ['А', 'Б', 'В'])[0] }];
  const wl = (offer: boolean) => [{ kind: 'individual', session_id: 's1', player_id: 'p1', pos: 2, total: 3, offer }];

  it('11: успешная пустая очередь: «Встать в очередь» при отсутствии мест, «Записать» при местах', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.waitlist_board = () => [];
    fake.rpc.booking_board = full;
    const { unmount } = render(<Booking />);
    expect(await screen.findByRole('button', { name: 'Встать в очередь: Аня Первая' })).toBeInTheDocument();
    unmount();
    fake.rpc.booking_board = () => board();
    render(<Booking />);
    expect(await screen.findByRole('button', { name: signupBtn })).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить очередь ожидания')).toBeNull();
  });

  it('12-13: позиция и активное предложение при успехе', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = full;
    fake.rpc.waitlist_board = () => wl(false);
    const { unmount } = render(<Booking />);
    expect(await screen.findByText('В очереди: 2 из 3')).toBeInTheDocument();
    unmount();
    fake.rpc.waitlist_board = () => wl(true);
    render(<Booking />);
    expect(await screen.findByRole('button', { name: 'Занять место: Аня Первая' })).toBeInTheDocument();
  });

  it('14: ошибка waitlist_board: ошибка и повтор, нет «Встать в очередь»/«Записать», join/signup не вызываются', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = full;
    fake.rpc.waitlist_board = () => ({ error: { message: 'permission denied for function waitlist_board' } });
    const { unmount } = render(<Booking />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Не удалось загрузить очередь ожидания')).toBeInTheDocument();
    expect(alert.textContent).not.toMatch(/permission denied|waitlist_board/);
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    noActions();
    unmount();
    // rejected promise и свободные места: «Записать» тоже скрыта
    fake.rpc.booking_board = () => board();
    fake.rpc.waitlist_board = () => Promise.reject(new TypeError('Failed to fetch'));
    render(<Booking />);
    expect(await screen.findByText('Не удалось загрузить очередь ожидания')).toBeInTheDocument();
    noActions();
    expect(fake.rpcCalls('waitlist_join')).toHaveLength(0);
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
  });

  it('14: при ошибке очереди уже записанному ребёнку отмена записи остаётся', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: false, amount: 50 }], ['Аня Первая']);
    fake.rpc.waitlist_board = () => ({ error: { message: 'boom' } });
    render(<Booking />);
    expect(await screen.findByText('Не удалось загрузить очередь ожидания')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' })).toBeInTheDocument();
  });

  it('15: повтор восстанавливает позицию, «Встать в очередь» не появляется', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = full;
    let fail = true;
    fake.rpc.waitlist_board = () => (fail ? { error: { message: 'boom' } } : wl(false));
    render(<Booking />);
    const retry = within(await screen.findByRole('alert')).getByRole('button', { name: 'Повторить' });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText('В очереди: 2 из 3')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить очередь ожидания')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Встать в очередь: Аня Первая' })).toBeNull();
  });

  it('15: повтор после ошибки показывает активное предложение места', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = full;
    let fail = true;
    fake.rpc.waitlist_board = () => (fail ? { error: { message: 'boom' } } : wl(true));
    render(<Booking />);
    const retry = within(await screen.findByRole('alert')).getByRole('button', { name: 'Повторить' });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Занять место: Аня Первая' })).toBeInTheDocument();
    expect(screen.getByText('Есть место')).toBeInTheDocument();
  });

  it('16: функция очереди не установлена: ошибка с повтором, а не «очереди нет»', async () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = full;
    fake.rpc.waitlist_board = () => ({ error: { message: 'Could not find the function public.waitlist_board in the schema cache' } });
    render(<Booking />);
    expect(await screen.findByText('Не удалось загрузить очередь ожидания')).toBeInTheDocument();
    noActions();
  });
});

describe('#767: проверка пересечений', () => {
  const clash = [{ kind: 'training', label: 'Тренировка группы', starts_at: '2099-01-01T18:30:00', ends_at: null }];
  const setup = () => {
    fake.db.player_guardians = [ANYA];
    fake.rpc.booking_board = () => board();
    fake.rpc.waitlist_board = () => [];
    fake.rpc.booking_signup = () => null;
  };
  const failures: [string, () => unknown][] = [
    ['ошибка RPC', () => ({ error: { message: 'boom' } })],
    ['отказ доступа', () => ({ error: { message: 'forbidden', code: '42501' } })],
    ['функция не найдена', () => ({ error: { message: 'Could not find the function public.booking_conflicts' } })],
    ['rejected promise', () => Promise.reject(new TypeError('Failed to fetch'))],
  ];

  it('18: нет пересечений: обычная запись, один вызов', async () => {
    setup();
    fake.rpc.booking_conflicts = () => [];
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: signupBtn }));
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('19: есть пересечение: без подтверждения записи нет, «Не записывать» закрывает, подтверждение даёт один вызов', async () => {
    setup();
    fake.rpc.booking_conflicts = () => clash;
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: signupBtn }));
    expect(await screen.findByText(/уже есть: Тренировка группы \(18:30\)/)).toBeInTheDocument();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Не записывать' }));
    expect(screen.queryByText(/уже есть:/)).toBeNull();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: signupBtn }));
    fireEvent.click(await screen.findByRole('button', { name: 'Всё равно записать: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toHaveLength(1));
  });

  for (const [name, fail] of failures) {
    it(`20: ${name}: записи нет, три действия, технического текста нет`, async () => {
      setup();
      fake.rpc.booking_conflicts = fail;
      render(<Booking />);
      fireEvent.click(await screen.findByRole('button', { name: signupBtn }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/Не удалось проверить, есть ли у Аня Первая другие занятия в это время/);
      expect(alert.textContent).not.toMatch(/boom|42501|booking_conflicts/);
      expect(within(alert).getByRole('button', { name: 'Повторить проверку: Аня Первая' })).toBeInTheDocument();
      expect(within(alert).getByRole('button', { name: 'Продолжить без проверки: Аня Первая' })).toBeInTheDocument();
      expect(within(alert).getByRole('button', { name: 'Не записывать' })).toBeInTheDocument();
      await new Promise(r => setTimeout(r, 20));
      expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    });
  }

  it('21: «Продолжить без проверки»: ровно один вызов записи, повторные нажатия не дублируют', async () => {
    setup();
    fake.rpc.booking_conflicts = () => ({ error: { message: 'boom' } });
    const gate = deferred<null>();
    fake.rpc.booking_signup = () => gate.promise;
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: signupBtn }));
    const go = await screen.findByRole('button', { name: 'Продолжить без проверки: Аня Первая' });
    fireEvent.click(go);
    fireEvent.click(go);
    fireEvent.click(go);
    gate.ok(null);
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
    await new Promise(r => setTimeout(r, 20));
    expect(fake.rpcCalls('booking_signup')).toHaveLength(1);
  });

  it('22: «Не записывать» после ошибки проверки: записи нет', async () => {
    setup();
    fake.rpc.booking_conflicts = () => ({ error: { message: 'boom' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: signupBtn }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не записывать' }));
    expect(screen.queryByText(/Не удалось проверить/)).toBeNull();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    expect(screen.getByRole('button', { name: signupBtn })).toBeInTheDocument();
  });

  it('23: повтор проверки: ошибка → снова три действия; затем без пересечений → запись; с пересечением → предупреждение', async () => {
    setup();
    let mode: 'fail' | 'ok' | 'clash' = 'fail';
    fake.rpc.booking_conflicts = () => (mode === 'fail' ? { error: { message: 'boom' } } : mode === 'ok' ? [] : clash);
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: signupBtn }));
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить проверку: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_conflicts')).toHaveLength(2));
    expect(await screen.findByText(/Не удалось проверить/)).toBeInTheDocument();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    mode = 'clash';
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку: Аня Первая' }));
    expect(await screen.findByText(/уже есть: Тренировка группы/)).toBeInTheDocument();
    expect(screen.queryByText(/Не удалось проверить/)).toBeNull();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Не записывать' }));
    mode = 'fail';
    fireEvent.click(screen.getByRole('button', { name: signupBtn }));
    await screen.findByText(/Не удалось проверить/);
    mode = 'ok';
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toHaveLength(1));
  });

  it('24: двойное нажатие «Записать» во время проверки: одна проверка и одна запись', async () => {
    setup();
    const gate = deferred<unknown>();
    fake.rpc.booking_conflicts = () => gate.promise;
    render(<Booking />);
    const btn = await screen.findByRole('button', { name: signupBtn });
    fireEvent.click(btn);
    fireEvent.click(btn);
    gate.ok([]);
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toHaveLength(1));
    await new Promise(r => setTimeout(r, 20));
    expect(fake.rpcCalls('booking_conflicts')).toHaveLength(1);
    expect(fake.rpcCalls('booking_signup')).toHaveLength(1);
  });

  it('25: ошибка записи после «Продолжить без проверки»: понятный текст', async () => {
    setup();
    fake.rpc.booking_conflicts = () => ({ error: { message: 'boom' } });
    fake.rpc.booking_signup = () => ({ error: { message: 'session in the past' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: signupBtn }));
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить без проверки: Аня Первая' }));
    expect(await screen.findByText('Занятие уже прошло.')).toBeInTheDocument();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(1);
  });
});
