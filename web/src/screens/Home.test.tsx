import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useNavStore } from '../nav';
import { afterEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { resetStartParam } from '../lib/startParam';
import Home from './Home';

const kid = (id: string, name: string, group: string | null) => ({ player_id: id, user_id: 'u', consent_revoked_at: null, players: { id, full_name: name, groups: group ? { name: group } : null } });
const led = (player_id: string, points: number, day: number, status = 'active') => ({ id: `l${player_id}${day}${points}${status}`, player_id, points, event_date: `2026-11-${String(day).padStart(2, '0')}`, source_type: 'group_session', reason_code: 'attended', components: { class: 'regular', base: points }, status });

describe('главная родителя', () => {
  it('карточка ребёнка: имя, группа, свои матчи и голы; баллов и истории нет, журнал не читается', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    fake.db.points_ledger = [led('p1', 2, 3), led('p1', 1, 2)];
    fake.errors.points_ledger = 'журнал не должен читаться'; // сбой журнала не мешает главной: она его не читает
    fake.db.match_players = [{ player_id: 'p1', played: true, goals: 2 }, { player_id: 'p1', played: true, goals: 1 }, { player_id: 'p1', played: false, goals: 0 }];
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.getByText('U10-A')).toBeInTheDocument();
    expect(screen.getByText('Матчей сыграно: 2 · голов: 3')).toBeInTheDocument();
    expect(screen.queryByLabelText(/балл/)).toBeNull();
    expect(screen.queryByText(/Всего накоплено/)).toBeNull();
    expect(screen.queryByText('Баллов пока нет')).toBeNull();
  });

  it('несколько детей: заголовок во множественном числе, баллов нет', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', null), kid('p2', 'Мария Петрова', null)];
    fake.db.points_ledger = [led('p1', 2, 3), led('p2', 1, 2)];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Мои дети' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/балл/)).toBeNull();
  });

  it('на главной родителя строки «Сборы» нет: единый вход через «О клубе» → Winter Camp', async () => {
    fake.db.player_guardians = [{ ...kid('p1', 'Алексей Петров', 'U10-A'), players: { id: 'p1', full_name: 'Алексей Петров', club_id: 'club1', status: 'active', groups: { name: 'U10-A' } } }];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Мой ребёнок' })).toBeInTheDocument();
    expect(screen.queryByText('Сборы')).toBeNull();
  });

  it('«Добавить ещё ребёнка»: политика открывается без списка детей над ней', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    render(<Home />);
    fireEvent.click(await screen.findByRole('button', { name: /Добавить ещё одного ребёнка/ }));
    fake.rpc.search_players_for_link = () => [{ player_id: 'p2', full_name: 'Мария Иванова', group_name: 'U9' }];
    fireEvent.change(await screen.findByLabelText('Фамилия или имя ребёнка'), { target: { value: 'Мар' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    fireEvent.click(await screen.findByRole('button', { name: /Мария Иванова/ }));
    expect(screen.getByText('Алексей Петров')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /правилами обработки персональных данных/ }));
    expect(await screen.findByRole('heading', { name: 'Политика конфиденциальности' })).toBeVisible();
    expect(screen.getByText('Алексей Петров')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByLabelText('Фамилия или имя ребёнка')).toHaveValue('Мар');
    expect(screen.getByText('Алексей Петров')).toBeVisible();
  });

  it('«Добавить ещё одного ребёнка» — запись стека: «Назад» возвращает к карточкам, поиск открывается снова (#732)', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    render(<Home />);
    const add = await screen.findByRole('button', { name: /Добавить ещё одного ребёнка/ });
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
    fireEvent.click(add);
    expect(await screen.findByLabelText('Фамилия или имя ребёнка')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.queryByLabelText('Фамилия или имя ребёнка')).toBeNull();
    expect(screen.getByText('Алексей Петров')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Добавить ещё одного ребёнка/ }));
    expect(await screen.findByLabelText('Фамилия или имя ребёнка')).toHaveValue('');
  });

  it('первый ребёнок подтверждён при открытом поиске: запись закрывается, видны карточки (#732)', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'approved', players: { full_name: 'Алексей Петров' } }];
    render(<Home />);
    const open = await screen.findByRole('button', { name: 'Найти другого ребёнка' });
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')]; // доступ появился, пока родитель в поиске
    fireEvent.click(open);
    expect(await screen.findByRole('heading', { name: 'Мой ребёнок' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Фамилия или имя ребёнка')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
  });

  it('одобрение пришло, пока открыт поиск: после «Назад» главная обновляется и показывает ребёнка (#732)', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    render(<Home />);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить другого ребёнка' }));
    expect(await screen.findByLabelText('Фамилия или имя ребёнка')).toBeInTheDocument();
    // администратор одобряет уже после открытия поиска
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'approved', players: { full_name: 'Алексей Петров' } }];
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Мой ребёнок' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Фамилия или имя ребёнка')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Запрос отправлен' })).toBeNull();
  });

  it('первый ребёнок появился при открытой политике поверх поиска: закрывается вся запись поиска, а не только политика (#732)', async () => {
    let store!: ReturnType<typeof useNavStore>;
    const Probe = () => {
      store = useNavStore();
      return null;
    };
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    render(<><Probe /><Home /></>);
    await screen.findByRole('heading', { name: 'Запрос отправлен' });
    act(() => {
      store.push('detached', { screen: 'hm.link' });
      store.push('detached', { screen: 'policy' });
      store.push('detached', { screen: 'hm.status' });
    });
    expect(store.entries('detached').map(e => e.screen)).toEqual(['detached', 'hm.link', 'policy', 'hm.status']);
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    act(() => void store.back('detached')); // закрыли статусы: главная перезагружается и видит ребёнка
    expect(await screen.findByRole('heading', { name: 'Мой ребёнок' })).toBeInTheDocument();
    await waitFor(() => expect(store.entries('detached')).toHaveLength(1)); // сняты и политика, и поиск
  });

  it('нет детей, запрос ждёт подтверждения: поясняет и ведёт к статусу', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    render(<Home />);
    expect(await screen.findByText(/Запрос отправлен/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Статус запросов/ }));
    expect(await screen.findByText('Статус привязки')).toBeInTheDocument();
  });

  it('нет детей и запросов: шаги и «Найти ребёнка», затем форма поиска', async () => {
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Найти ребёнка' }));
    expect(await screen.findByText('Добавить ребёнка')).toBeInTheDocument();
  });

  it('ошибка загрузки: «Повторить»', async () => {
    fake.rpc.my_children = () => ({ error: { message: 'TypeError: Failed to fetch' } });
    render(<Home />);
    expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Failed to fetch');
    delete fake.rpc.my_children;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Найти ребёнка' })).toBeInTheDocument());
  });
});

// Вход по ссылке t.me/kicksapp?startapp=camp_<имя> (Issue #470, условие 62)
describe('вход по ссылке на сбор', () => {
  const start = (v?: string) => { (window as any).Telegram = { WebApp: { initData: 'x', initDataUnsafe: { start_param: v } } }; resetStartParam(); };
  const seedCamps = () => {
    fake.db.player_guardians = [{ ...kid('p1', 'Алексей Петров', null), players: { id: 'p1', full_name: 'Алексей Петров', club_id: 'club1', status: 'active', groups: null } }];
    fake.db.camps = [
      { id: 'c1', club_id: 'club1', slug: 'zima', name: 'Зимний лагерь', location: null, starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 0, booking_deadline: null, full_payment_deadline: null, active: true },
      { id: 'c2', club_id: 'club2', slug: 'chuzhoy', name: 'Чужой сбор', location: null, starts_on: '2027-02-01', ends_on: '2027-02-05', booking_fee: 0, booking_deadline: null, full_payment_deadline: null, active: true },
    ];
  };
  afterEach(() => { delete (window as any).Telegram; resetStartParam(); });

  it('родитель с детьми: открывается карточка сбора из ссылки, «назад» ведёт в список и повторно не открывает', async () => {
    seedCamps();
    start('camp_Zima');
    render(<Home />);
    // «Назад» есть и у списка, поэтому ждём загруженную карточку (экран перерисовывается при загрузке).
    // Заголовок «Зимний лагерь» виден и в заглушке загрузки (role=status), поэтому ждём и её исчезновения: иначе «Назад» ещё нет
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Зимний лагерь' })).toBeInTheDocument();
      expect(screen.queryByRole('status', { name: 'Загрузка' })).not.toBeInTheDocument();
    });
    const back = screen.getByRole('button', { name: 'Назад' });
    fireEvent.click(back);
    expect(await screen.findByText('Зимний лагерь', { selector: '.ks-row-title' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Сборы' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Зимний лагерь' })).not.toBeInTheDocument();
  });
  it('сбор другого клуба или неизвестное имя: список сборов, без ошибок и без чужого сбора', async () => {
    seedCamps();
    start('camp_chuzhoy');
    render(<Home />);
    expect(await screen.findByText('Зимний лагерь', { selector: '.ks-row-title' })).toBeInTheDocument(); // загруженный список
    expect(screen.getByRole('heading', { name: 'Сборы' })).toBeInTheDocument();
    expect(screen.queryByText('Чужой сбор')).not.toBeInTheDocument();
  });
  it('чужой параметр запуска: обычная главная', async () => {
    seedCamps();
    start('link_zima');
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Сборы' })).not.toBeInTheDocument();
  });
  it('без детей параметр игнорируется: привязка ребёнка как раньше', async () => {
    seedCamps();
    fake.db.player_guardians = [];
    start('camp_zima');
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Сборы' })).not.toBeInTheDocument();
  });
});

describe('главная родителя: вход в профиль игрока (#266, П1.1, П1.3)', () => {
  it('у каждого ребёнка своя кнопка; профиль открывается для выбранного, «Назад» возвращает к детям', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A'), kid('p2', 'Мария Петрова', 'U8')];
    fake.db.players = [{ id: 'p1', full_name: 'Алексей Петров', birth_date: null, groups: { name: 'U10-A' } }, { id: 'p2', full_name: 'Мария Петрова', birth_date: '2018-01-01', groups: { name: 'U8' } }];
    fake.rpc.player_training_history = () => [];
    render(<Home />);
    fireEvent.click(await screen.findByRole('button', { name: 'Профиль игрока: Мария Петрова' }));
    expect(await screen.findByRole('heading', { name: 'Мария Петрова' })).toBeInTheDocument();
    expect(screen.getByText('Дата рождения: 01.01.2018')).toBeInTheDocument();
    expect(screen.queryByText('Алексей Петров')).toBeNull();
    expect(fake.rpcCalls('player_training_history')[0].p).toBe('p2');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('heading', { name: 'Мои дети' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Профиль игрока: Алексей Петров' })).toBeInTheDocument();
  });
});

// Условия приёмки: docs/acceptance/link-sync-761-2026-11-28.md
describe('главная родителя: синхронизация привязки (#761)', () => {
  const approved = () => [{ id: 'r1', user_id: 'u', status: 'approved', player_id: 'p1', players: { full_name: 'Алексей Петров' } }];

  it('условие 1: заполненный старый consent_revoked_at не скрывает ребёнка, которого отдаёт сервер', async () => {
    fake.db.player_guardians = [{ ...kid('p1', 'Алексей Петров', 'U10-A'), consent_revoked_at: '2026-10-01T00:00:00Z' }];
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeNull();
  });

  it('условие 2: ребёнок, которого сервер не отдаёт, не показывается, даже если старое поле пустое', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    fake.rpc.my_children = () => [];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    expect(screen.queryByText('Алексей Петров')).toBeNull();
  });

  it('условие 3: сбой запросов при загруженных детях: дети на месте, предупреждение и «Повторить загрузку»', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Мария Иванова' } }];
    fake.errors.link_requests = 'boom';
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    const warn = await screen.findByRole('alert');
    expect(warn).toHaveTextContent('Не удалось загрузить запросы на привязку');
    expect(document.body.textContent).not.toMatch(/boom/);
    expect(screen.queryByRole('button', { name: /Запросы на привязку/ })).toBeNull();
    expect(screen.queryByText('Не удалось загрузить данные')).toBeNull();
    // условие 5: повтор после успеха снимает предупреждение и показывает запросы
    delete fake.errors.link_requests;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    expect(await screen.findByText(/Запросы на привязку/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Алексей Петров')).toBeInTheDocument();
  });

  it('условие 3: отклонённый запрос (сеть) при детях ведёт себя так же', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    fake.rejects.link_requests = 'Failed to fetch';
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Повторить загрузку' })).toBeInTheDocument();
  });

  it('условие 4: сбой запросов без детей: ошибка с повтором, не онбординг', async () => {
    fake.errors.link_requests = 'boom';
    render(<Home />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeNull();
    delete fake.errors.link_requests;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
  });

  it('условие 9: гонка (связи прочитаны до одобрения, запросы после): один повтор чтения связей, ребёнок появляется сам', async () => {
    fake.db.link_requests = approved();
    let calls = 0;
    fake.rpc.my_children = () => (++calls === 1 ? [] : [{ player_id: 'p1', full_name: 'Алексей Петров', group_id: null, group_name: 'U10-A' }]);
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Мой ребёнок' })).toBeInTheDocument();
    expect(screen.getByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ребёнок пока не отображается' })).toBeNull();
    expect(calls).toBe(2);
  });

  it('условие 9: запросы читаются раньше связей', async () => {
    fake.db.link_requests = approved();
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    render(<Home />);
    await screen.findByText('Алексей Петров');
    const order = fake.calls.filter(c => c.kind === 'rpc' && (c.name === 'my_link_requests' || c.name === 'my_children')).map(c => c.name);
    expect(order[0]).toBe('my_link_requests');
    expect(order).not.toContain('auth.signOut');
    expect(order.filter(n => n === 'my_children')).toHaveLength(1); // ребёнок найден с первого раза: повтор не нужен
  });

  it('условие 10 и 11: ребёнка всё ещё нет: «Проверить снова», затем ребёнок появляется без перезапуска', async () => {
    fake.db.link_requests = approved();
    let visible = false;
    fake.rpc.my_children = () => (visible ? [{ player_id: 'p1', full_name: 'Алексей Петров', group_id: null, group_name: null }] : []);
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Ребёнок пока не отображается' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Закройте приложение/);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
    expect(await screen.findByText('Проверили: ребёнок пока не отображается.')).toBeInTheDocument();
    visible = true;
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
    expect(await screen.findByRole('heading', { name: 'Мой ребёнок' })).toBeInTheDocument();
    expect(screen.getByText('Алексей Петров')).toBeInTheDocument();
  });
});
