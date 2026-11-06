import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import { DirtyGuardHost, NavProvider, NavRoot, useActiveRoot } from '../nav';
import CashDesk from './CashDesk';
import Camps from './Camps';
import Equipment from './Equipment';
import Extra from './Extra';
import CoachMatches from './CoachMatches';
import Group from './Group';
import Stats from './Stats';
import Money from './Money';
import Players from './Players';
import Sessions from './Sessions';
import More from './More';
import Coaches from './Coaches';
import Leads from './Leads';
import About from './About';
import TrialForm from './TrialForm';
import ParentSchedule from './ParentSchedule';
import ChildMatches from './ChildMatches';
import AdminArticles from './AdminArticles';

const month = today().slice(0, 7) + '-01';
const inApp = (root: string, ui: React.ReactNode) => (
  <NavProvider initial={root}>
    <NavRoot root={root}>{ui}</NavRoot>
    <DirtyGuardHost />
  </NavProvider>
);
function seedPlayers() {
  fake.db.groups = [{ id: 'g1', name: 'U10-B', club_id: 'c1' }, { id: 'g2', name: 'U7-A', club_id: 'c1' }];
  fake.db.players = [
    { id: 'p1', full_name: 'Amodeo Nolan', group_id: 'g1', birth_date: '2016-09-05', status: 'active', external_id: 'KS-0002' },
    { id: 'p2', full_name: 'Andreev Boris', group_id: 'g2', birth_date: '2020-02-15', status: 'active', external_id: 'KS-0004' },
    { id: 'p3', full_name: 'Старый Игрок', group_id: 'g2', birth_date: null, status: 'inactive', external_id: 'KS-0009' },
  ];
  fake.db.prices = [{ group_id: null, amount: 165, valid_from: '2026-01-01', valid_to: null, kind: 'subscription' }];
  fake.db.payments = [{ player_id: 'p1', amount: 165, paid_on: month }];
  fake.db.subscriptions = [];
}

describe('«Игроки»: возврат из карточки и правки', () => {
  it('поиск и фильтры списка сохраняются после «Назад» из карточки', async () => {
    seedPlayers();
    render(inApp('players', <Players />));
    fireEvent.change(await screen.findByLabelText('Поиск игроков'), { target: { value: 'andr' } });
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'all' } });
    const push = vi.spyOn(window.history, 'pushState');
    fireEvent.click(await screen.findByText('Andreev Boris'));
    expect(await screen.findByRole('button', { name: 'Изменить данные' })).toBeInTheDocument();
    expect(push).toHaveBeenCalledTimes(1); // карточка = одна запись истории, «Назад» не дублируется
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByLabelText('Поиск игроков')).toHaveValue('andr');
    expect(screen.getByLabelText('Статус')).toHaveValue('all');
    expect(screen.getByText('Andreev Boris')).toBeInTheDocument();
    expect(screen.queryByText('Amodeo Nolan')).not.toBeInTheDocument();
  });

  it('вкладка карточки сохраняется после «Назад» из правки; из правки нового игрока «Отмена» ведёт в список', async () => {
    seedPlayers();
    render(inApp('players', <Players />));
    fireEvent.click(await screen.findByText('Amodeo Nolan'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить данные' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
    await screen.findByRole('button', { name: 'Изменить данные' });
    expect(screen.getByRole('tab', { name: 'Матчи' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Добавить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
    expect(await screen.findByText('Amodeo Nolan')).toBeInTheDocument();
  });

  it('позиция прокрутки списка возвращается после «Назад»', async () => {
    seedPlayers();
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
    render(inApp('players', <Players />));
    fireEvent.click(await screen.findByText('Amodeo Nolan')); // уходим: запоминается 640
    await screen.findByRole('button', { name: 'Изменить данные' });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await screen.findByLabelText('Поиск игроков');
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});

describe('«Занятия»: возврат из индивидуальной отметки', () => {
  it('вкладка «Индивидуальные» и дата сохраняются после «Назад»', async () => {
    const t = today();
    fake.db.weekly_schedule = [1, 2, 3, 4, 5, 6, 7].map(w => ({ group_id: 'g1', weekday: w, starts_at: '18:00:00', location: 'Стадион', kind: 'Групповая' }));
    fake.db.players = [];
    fake.rpc.ind_roster_list = () => [{ session_id: 's1', starts_at: `${t}T19:00:00`, topic: 'Дриблинг', goalkeepers: true, player_id: 'p1', full_name: 'Иванов Пётр', attended: null }];
    fake.rpc.extra_roster_list = () => [];
    render(inApp('sessions', <Sessions groups={[{ id: 'g1', name: 'U9' }]} />));
    fireEvent.click(await screen.findByRole('tab', { name: 'Индивидуальные' }));
    fireEvent.click(await screen.findByText('Записано: 1'));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Записано: 1')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Индивидуальные' })).toHaveAttribute('aria-selected', 'true');
  });
});

// Раздел → другой раздел → обратно: экран монтируется заново, состояние берётся из стека раздела
function TwoTabs({ children }: { children: React.ReactNode }) {
  const [tab, select] = useActiveRoot<'money' | 'other'>('money');
  return (
    <>
      <button onClick={() => select('other')}>to-other</button>
      <button onClick={() => select('money')}>to-money</button>
      <NavRoot root={tab}>{tab === 'money' ? children : <p>other</p>}</NavRoot>
    </>
  );
}

describe('«Оплаты»: возврат на вкладку', () => {
  it('подраздел, месяц, поиск и фильтр «Только должники» сохраняются после ухода в другой раздел', async () => {
    seedPlayers();
    fake.db.club_settings = [];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <Money />
        </TwoTabs>
      </NavProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'По месяцам' }));
    fireEvent.change(await screen.findByLabelText('Поиск по ФИ'), { target: { value: 'andr' } });
    fireEvent.click(screen.getByLabelText('Только должники'));
    fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: screen.getByLabelText('Месяц').querySelectorAll('option')[1].getAttribute('value') } });
    const month = (screen.getByLabelText('Месяц') as HTMLSelectElement).value;
    fireEvent.click(screen.getByText('to-other'));
    expect(screen.getByText('other')).toBeInTheDocument();
    fireEvent.click(screen.getByText('to-money'));
    expect(await screen.findByRole('tab', { name: 'По месяцам' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Поиск по ФИ')).toHaveValue('andr');
    expect(screen.getByLabelText('Только должники')).toBeChecked();
    expect((screen.getByLabelText('Месяц') as HTMLSelectElement).value).toBe(month);
  });
});

describe('«Приём оплат»: выбранный игрок', () => {
  it('остаётся выбранным после ухода в другой раздел; «Сменить» сбрасывает выбор', async () => {
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' } }];
    fake.db.prices = [{ group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null }];
    for (const t of ['payments', 'subscriptions', 'equipment_orders', 'individual_bookings', 'extra_bookings', 'camp_participants', 'camp_payments']) fake.db[t] = [];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <CashDesk />
        </TwoTabs>
      </NavProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('button', { name: /Иванов Пётр/ }));
    await screen.findByRole('button', { name: 'Сменить' });
    fireEvent.click(screen.getByText('to-other'));
    fireEvent.click(screen.getByText('to-money'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сменить' }));
    expect(await screen.findByLabelText(/^Игрок/)).toBeInTheDocument();
  });
});

describe('Матчи, группа, статистика, учёт', () => {
  it('«Матчи»: фильтр команды остаётся после «Назад» из матча', async () => {
    fake.db.matches = [
      { id: 'm1', team: 'U9', played_on: '2026-10-10', opponent: 'Олимп', goals_for: 3, goals_against: 1 },
      { id: 'm2', team: 'U11', played_on: '2026-10-09', opponent: 'Динамо', goals_for: 1, goals_against: 1 },
    ];
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
    fake.db.match_players = [];
    const groups = [{ id: 'g1', name: 'U9' }, { id: 'g2', name: 'U11' }];
    const push = vi.spyOn(window.history, 'pushState');
    render(inApp('cmatches', <CoachMatches groups={groups} admin />));
    fireEvent.change(await screen.findByLabelText('Команда'), { target: { value: 'U11' } });
    fireEvent.click(await screen.findByText('Динамо'));
    await screen.findByDisplayValue('Динамо');
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByLabelText('Команда')).toHaveValue('U11');
    expect(push).toHaveBeenCalledTimes(1); // матч = одна запись истории
  });

  it('«Группа»: «Назад» из карточки игрока возвращает к списку', async () => {
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
    fake.db.points_ledger = [];
    fake.rpc.group_parents = () => [];
    fake.rpc.points_manual_status = () => ({ active: true, remaining: { '1': 3 }, month_total: 0, month_cap: 10 });
    render(inApp('points', <Group groups={[{ id: 'g1', name: 'U9' }]} />));
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    await screen.findByText('Ручные баллы');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('heading', { name: 'Группа' })).toBeInTheDocument();
  });

  it('«Статистика»: вкладка и период остаются после ухода в другой раздел', async () => {
    fake.rpc.attendance_stats = () => [];
    fake.rpc.match_stats = () => [];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <Stats />
        </TwoTabs>
      </NavProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Прошлый' }));
    fireEvent.click(screen.getByText('to-other'));
    fireEvent.click(screen.getByText('to-money'));
    expect(await screen.findByRole('tab', { name: 'Матчи', selected: true })).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: 'Прошлый', selected: true }).length).toBeGreaterThan(0);
  });
});

describe('Экипировка, сборы, дополнительные', () => {
  it('«Экипировка»: фильтр списка остаётся после «Назад» из заказа и из «Каталога»', async () => {
    const order = (id: string, name: string, total: number, paid: number) => ({
      id, ordered_on: '2026-09-10', total, paid, installment: false, number: '7', inscription: null, location: 'Зал',
      players: { full_name: name },
      equipment_order_lines: [{ id: `${id}-f`, kit: 'Форма', size: '128', quantity: 1 }],
      equipment_issues: [],
    });
    fake.db.equipment_orders = [order('o1', 'Иванов Пётр', 160, 160), order('o2', 'Сидоров Ян', 160, 60)];
    fake.db.equipment_catalog = [{ kit: 'Форма', price: 100, valid_from: '2026-08-01' }];
    fake.db.players = [];
    render(inApp('equip', <Equipment />));
    fireEvent.click(await screen.findByRole('tab', { name: 'Не оплачены' }));
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('tab', { name: 'Не оплачены', selected: true })).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Каталог' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('tab', { name: 'Не оплачены', selected: true })).toBeInTheDocument();
  });

  it('«Сборы»: «Назад» из участника возвращает к сбору, затем к списку', async () => {
    fake.db.camps = [{ id: 'c1', name: 'Зимний лагерь', location: 'Бакуриани', starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 100, booking_deadline: null, full_payment_deadline: null, active: true }];
    fake.db.camp_tariffs = [{ id: 't1', camp_id: 'c1', name: 'Футболист', price: 850, active: true }];
    fake.db.camp_participants = [{
      id: 'cp1', camp_id: 'c1', player_id: 'p1', tariff_id: 't1', amount: 850, tshirt_size: 'M', comment: null, status: 'registered',
      players: { full_name: 'Иванов Пётр', groups: { name: 'U9-A' } }, camp_tariffs: { name: 'Футболист' }, camp_payments: [],
    }];
    const push = vi.spyOn(window.history, 'pushState');
    render(inApp('camps', <Camps />));
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    expect(push).toHaveBeenCalledTimes(2); // сбор и участник: по записи истории
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('heading', { name: 'Зимний лагерь' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('heading', { name: 'Сборы' })).toBeInTheDocument();
  });

  it('«Дополнительные»: вкладка списка остаётся после «Назад» из новой тренировки', async () => {
    fake.db.extra_sessions = [];
    fake.db.extra_bookings = [];
    render(inApp('extra', <Extra />));
    fireEvent.click(await screen.findByRole('tab', { name: 'Прошедшие' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Новая тренировка' }));
    expect(await screen.findByRole('heading', { name: 'Новая тренировка' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('tab', { name: 'Прошедшие', selected: true })).toBeInTheDocument();
  });
});

describe('Разделы внутри «Ещё»', () => {
  it('вложенный экран раздела не подменяется каталогом «Ещё»; «Назад» идёт по шагам', async () => {
    fake.db.equipment_orders = [];
    fake.db.equipment_catalog = [{ kit: 'Форма', price: 100, valid_from: '2026-08-01' }];
    fake.db.players = [];
    render(inApp('more', <More groups={[]} bar={[]} onMenuChanged={() => {}} />));
    fireEvent.click(await screen.findByText('Экипировка'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Каталог' }));
    expect(screen.queryByRole('heading', { name: 'Ещё' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('tab', { name: 'Все' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    expect(await screen.findByRole('heading', { name: 'Ещё' })).toBeInTheDocument();
  });
});

describe('Разделы администратора: тренеры, заявки, статьи', () => {
  it('«Тренеры»: поиск остаётся после «Назад» из карточки тренера', async () => {
    fake.db.users = [
      { id: 'u1', telegram_id: 1, display_name: 'Анна Тренер', chosen_role: null, is_admin: false },
      { id: 'u2', telegram_id: 2, display_name: 'Борис Другой', chosen_role: null, is_admin: false },
    ];
    fake.db.groups = [{ id: 'g1', name: 'U9-A' }];
    fake.db.coach_groups = [];
    const push = vi.spyOn(window.history, 'pushState');
    render(inApp('coaches', <Coaches />));
    fireEvent.change(await screen.findByLabelText('Найти пользователя'), { target: { value: 'анна' } });
    fireEvent.click(await screen.findByText('Анна Тренер'));
    expect(await screen.findByRole('heading', { name: 'Анна Тренер' })).toBeInTheDocument();
    expect(push).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByLabelText('Найти пользователя')).toHaveValue('анна');
    expect(screen.queryByText('Борис Другой')).not.toBeInTheDocument();
  });

  it('«Заявки»: фильтр остаётся после ухода в другой раздел', async () => {
    fake.db.trials = [{ id: 't1', full_name: 'Старая Заявка', phone: null, parent_name: null, username: null, birth_year: 2016, status: 'joined', note: null, created_at: '2026-10-01T10:00:00Z', source: null }];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <Leads />
        </TwoTabs>
      </NavProvider>,
    );
    expect(screen.queryByText(/Старая Заявка/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('tab', { name: 'Все' }));
    expect(await screen.findByText(/Старая Заявка/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('to-other'));
    fireEvent.click(screen.getByText('to-money'));
    expect(await screen.findByRole('tab', { name: 'Все', selected: true })).toBeInTheDocument();
    expect(await screen.findByText(/Старая Заявка/)).toBeInTheDocument();
  });

  it('«Статьи клуба»: «Назад» из редактора возвращает в тот же раздел списка', async () => {
    fake.db.users = [{ id: 'u', is_admin: true }];
    fake.db.club_articles = [];
    const push = vi.spyOn(window.history, 'pushState');
    render(inApp('content', <AdminArticles />));
    fireEvent.click(await screen.findByRole('tab', { name: /Новости|Публикации/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать публикацию' }));
    expect(push).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('button', { name: 'Создать публикацию' })).toBeInTheDocument();
  });
});

describe('Родитель, ребёнок, гость', () => {
  const art = { id: 'a1', slug: null, title: 'Правила клуба', body: 'Текст', audience: 'both', status: 'published', sort_order: 1, author_id: 'u', author_name: 'Admin', editor_id: 'u', editor_name: 'Admin', link_url: null, link_label: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', published_at: '2026-11-01T10:00:00Z', section: 'news' };

  it('«О клубе»: материалы и статья открываются шагами, «Назад» идёт обратно по одному', async () => {
    fake.db.club_articles = [art];
    const push = vi.spyOn(window.history, 'pushState');
    render(inApp('about', <About role="guest" onChangeRole={() => {}} />));
    fireEvent.click(await screen.findByText('Новости клуба'));
    fireEvent.click(await screen.findByText('Правила клуба'));
    expect(await screen.findByRole('heading', { name: 'Правила клуба' })).toBeInTheDocument();
    expect(push).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Правила клуба')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Материалы клуба')).toBeInTheDocument();
  });

  it('«Пробная»: введённое в форму остаётся после просмотра политики и «Назад»', async () => {
    render(inApp('about', <TrialForm startOpen />));
    fireEvent.change(screen.getByPlaceholderText('Ваше имя'), { target: { value: 'Мария' } });
    fireEvent.click(screen.getByRole('button', { name: 'Политике конфиденциальности' }));
    expect(await screen.findByRole('heading', { name: 'Политика конфиденциальности' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByPlaceholderText('Ваше имя')).toHaveValue('Мария');
  });

  it('«Расписание» родителя: вкладка остаётся после ухода в другой раздел', async () => {
    fake.db.player_guardians = [];
    fake.db.groups = [];
    fake.db.sessions = [];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <ParentSchedule />
        </TwoTabs>
      </NavProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Группы' }));
    fireEvent.click(screen.getByText('to-other'));
    fireEvent.click(screen.getByText('to-money'));
    expect(await screen.findByRole('tab', { name: 'Группы', selected: true })).toBeInTheDocument();
  });

  it('«Матчи» ребёнка: фильтр остаётся после ухода в другой раздел', async () => {
    fake.db.match_players = [];
    fake.db.matches = [];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <ChildMatches player={{ id: 'p1', full_name: 'Иванов', group: 'U9-A' } as never} />
        </TwoTabs>
      </NavProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Результаты' }));
    fireEvent.click(screen.getByText('to-other'));
    fireEvent.click(screen.getByText('to-money'));
    expect(await screen.findByRole('tab', { name: 'Результаты', selected: true })).toBeInTheDocument();
  });
});

describe('Предупреждение о несохранённом в формах', () => {
  it('«Пробная»: политика открывается без вопроса, а «Назад» из формы с введённым спрашивает', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    render(inApp('about', <About role="guest" onChangeRole={() => {}} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Записаться на пробную' }));
    fireEvent.change(await screen.findByLabelText('Ваше имя'), { target: { value: 'Мария' } });
    fireEvent.click(screen.getByRole('button', { name: 'Политике конфиденциальности' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Назад' })).at(-1)!); // кнопка политики
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Ваше имя')).toHaveValue('Мария');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('dialog', { name: 'Уйти без сохранения?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Мария');
    expect(push).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Уйти' }));
    expect(await screen.findByText('Новости клуба')).toBeInTheDocument();
  });

  it('«Статьи клуба»: незаполненный редактор закрывается сразу, с правками — после подтверждения', async () => {
    fake.db.users = [{ id: 'u', is_admin: true }];
    fake.db.club_articles = [];
    render(inApp('content', <AdminArticles />));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать статью' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('button', { name: 'Создать статью' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать статью' }));
    fireEvent.change(await screen.findByLabelText('Заголовок'), { target: { value: 'Черновик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('dialog', { name: 'Уйти без сохранения?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Уйти' }));
    expect(await screen.findByRole('button', { name: 'Создать статью' })).toBeInTheDocument();
  });
});
