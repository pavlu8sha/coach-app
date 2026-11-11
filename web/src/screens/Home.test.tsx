import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { resetStartParam } from '../lib/startParam';
import Home from './Home';

const kid = (id: string, name: string, group: string | null) => ({ player_id: id, user_id: 'u', consent_revoked_at: null, players: { id, full_name: name, groups: group ? { name: group } : null } });
const led = (player_id: string, points: number, day: number, status = 'active') => ({ id: `l${player_id}${day}${points}${status}`, player_id, points, event_date: `2026-11-${String(day).padStart(2, '0')}`, source_type: 'group_session', reason_code: 'attended', components: { class: 'regular', base: points }, status });

describe('главная родителя', () => {
  it('карточка ребёнка: баллы по новому журналу, история, свои матчи и голы; без рейтингов', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    fake.db.points_ledger = [led('p1', 2, 3), led('p1', 1, 2), led('p1', 5, 1, 'cancelled')];
    fake.db.point_events = [{ player_id: 'p1', points: 40, explanation: 'Старое', occurred_on: '2026-10-01' }];
    fake.db.match_players = [{ player_id: 'p1', played: true, goals: 2 }, { player_id: 'p1', played: true, goals: 1 }, { player_id: 'p1', played: false, goals: 0 }];
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.getByText('U10-A')).toBeInTheDocument();
    expect(screen.getByLabelText('3 балла')).toBeInTheDocument();
    expect(await screen.findByText('Всего накоплено: 3 балла')).toBeInTheDocument();
    expect(screen.queryByText('Старое')).toBeNull();
    expect(screen.getByText('Матчей сыграно: 2 · голов: 3')).toBeInTheDocument();
  });

  it('нет баллов: пустое состояние в карточке', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    render(<Home />);
    expect(await screen.findByText('Баллов пока нет')).toBeInTheDocument();
    expect(screen.getByLabelText('0 баллов')).toBeInTheDocument();
  });

  it('несколько детей: заголовок во множественном числе, у каждого свои баллы', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', null), kid('p2', 'Мария Петрова', null)];
    fake.db.points_ledger = [led('p1', 2, 3), led('p2', 1, 2)];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Мои дети' })).toBeInTheDocument();
    expect(screen.getByLabelText('2 балла')).toBeInTheDocument();
    expect(screen.getByLabelText('1 балл')).toBeInTheDocument();
  });

  it('строки «Сборы» на главной нет, вход в «О клубе» (условие 67 #470)', async () => {
    fake.db.player_guardians = [{ ...kid('p1', 'Алексей Петров', 'U10-A'), players: { id: 'p1', full_name: 'Алексей Петров', club_id: 'club1', status: 'active', groups: { name: 'U10-A' } } }];
    render(<Home />);
    await screen.findByText('Алексей Петров');
    expect(screen.queryByText('Сборы')).not.toBeInTheDocument();
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
    fake.errors.player_guardians = 'нет связи';
    render(<Home />);
    expect(await screen.findByText('нет связи')).toBeInTheDocument();
    delete fake.errors.player_guardians;
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
    const back = await screen.findByRole('button', { name: '← Сборы' }); // кнопка есть только у загруженной карточки сбора
    expect(screen.getByRole('heading', { name: 'Зимний лагерь' })).toBeInTheDocument();
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

