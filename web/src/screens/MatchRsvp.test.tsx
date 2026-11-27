import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Matches from './Matches';
import { RsvpDetail } from './CoachRsvp';
import { CreateFlow, idOf } from '../test/rsvpHarness';

window.scrollTo = (() => {}) as typeof window.scrollTo;
const future = new Date(Date.now() + 5 * 86400000).toISOString();
const row = (o: Record<string, unknown> = {}) => ({
  match_id: 'r1', lifecycle_status: 'published', kind: 'friendly', team: 'U9', opponent: 'Олимп', starts_at: future, venue: 'Стадион', address: null, notes: null,
  rescheduled: false, player_id: 'p1', player_name: 'Иванов Пётр', response: null, responded_by_name: null, responded_at: null, answer_until: future, can_answer: true, ...o,
});
function seedParent(rows: unknown[]) {
  fake.user = { id: 'u1' } as any;
  fake.db.player_guardians = [{ user_id: 'u1', consent_revoked_at: null, players: { id: 'p1', full_name: 'Иванов Пётр', groups: { name: 'U9' } } }];
  fake.db.match_players = [];
  fake.db.matches = [];
  fake.rpc.match_tournaments = () => [];
  fake.rpc.my_tournaments = () => [];
  fake.rpc.match_rsvp_my_matches = () => rows;
}

describe('«Матчи» родителя: подтверждение участия', () => {
  it('родитель отвечает «Будет» за ребёнка', async () => {
    seedParent([row()]);
    render(<Matches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Иванов Пётр: Будет' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_answer')).toEqual([{ m: 'r1', p_player: 'p1', p_response: 'yes' }]));
  });

  it('когда приём ответов закрыт, кнопок нет', async () => {
    seedParent([row({ can_answer: false, response: 'no' })]);
    render(<Matches />);
    expect(await screen.findByText(/Приём ответов закрыт/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Иванов Пётр: Будет' })).toBeNull();
  });

  it('пустой успешный результат: ошибки нет, пустое состояние как раньше (#737, условие 2)', async () => {
    seedParent([]);
    render(<Matches />);
    expect(await screen.findByText('Матчей пока нет')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('«Матчи» родителя: ошибка загрузки подтверждений (#737)', () => {
  const failing = () => ({ error: { message: 'boom: secret technical text' } });

  it('ошибка RPC: понятное сообщение без технического текста, пустое состояние не выдаётся за «нет матчей»', async () => {
    seedParent([]);
    fake.rpc.match_rsvp_my_matches = failing;
    render(<Matches />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить подтверждения участия');
    expect(alert).not.toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText('Матчей пока нет')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Предстоящие' }));
    expect(screen.queryByText('Нет ближайших матчей')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Прошедшие' }));
    expect(screen.queryByText('Нет результатов')).toBeNull();
  });

  it('ошибка RSVP не скрывает независимо загруженный общий список матчей', async () => {
    seedParent([]);
    fake.db.matches = [{ id: 'm1', team: 'U9', played_on: '2026-10-01', opponent: 'Олимп', goals_for: 3, goals_against: 1 }];
    fake.rpc.match_rsvp_my_matches = failing;
    render(<Matches />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить подтверждения участия');
    expect(screen.getByText('Олимп')).toBeInTheDocument();
    expect(screen.getByLabelText('Итоги команды')).toBeInTheDocument();
  });

  it('повтор: второй вызов RPC, после успеха блока нет, карточка подтверждения показана', async () => {
    seedParent([]);
    let fail = true;
    fake.rpc.match_rsvp_my_matches = () => (fail ? failing() : [row()]);
    render(<Matches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    fail = false;
    expect(await screen.findByRole('button', { name: 'Иванов Пётр: Будет' })).toBeInTheDocument();
    expect(fake.rpcCalls('match_rsvp_my_matches').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('повтор может снова не удаться: блок остаётся', async () => {
    seedParent([]);
    fake.rpc.match_rsvp_my_matches = failing;
    render(<Matches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_my_matches').length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить подтверждения участия');
  });

  it('на время повторной загрузки кнопка отключена и показывает выполнение', async () => {
    seedParent([]);
    let release: (v: unknown) => void = () => {};
    let n = 0;
    fake.rpc.match_rsvp_my_matches = () => (++n === 1 ? failing() : new Promise(r => { release = r; }));
    render(<Matches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    const busy = await screen.findByRole('button', { name: 'Загружаю…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(fake.rpcCalls('match_rsvp_my_matches')).toHaveLength(2);
    release([row()]);
    expect(await screen.findByRole('button', { name: 'Иванов Пётр: Будет' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('два перекрывающихся запроса, завершённых в обратном порядке: итог соответствует последнему запущенному', async () => {
    seedParent([row()]);
    const pending: ((v: unknown) => void)[] = [];
    let n = 0;
    fake.rpc.match_rsvp_my_matches = () => (++n === 1 ? [row()] : new Promise(r => { pending.push(r); }));
    render(<Matches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Иванов Пётр: Будет' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Иванов Пётр: Не будет' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]([row({ response: 'no' })]); // новый запрос отвечает успешно
    await waitFor(() => expect(screen.getByRole('button', { name: 'Иванов Пётр: Не будет' })).toBeInTheDocument());
    pending[0]({ error: { message: 'stale boom' } }); // старый запрос заканчивается позже ошибкой
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Иванов Пётр: Не будет' })).toBeInTheDocument();
  });

  it('успешная загрузка: блока ошибки нет', async () => {
    seedParent([row()]);
    render(<Matches />);
    expect(await screen.findByRole('button', { name: 'Иванов Пётр: Будет' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ребёнок без группы: RPC не вызывается, блока ошибки нет', async () => {
    seedParent([]);
    fake.db.player_guardians = [{ user_id: 'u1', consent_revoked_at: null, players: { id: 'p1', full_name: 'Иванов Пётр', groups: null } }];
    fake.rpc.match_rsvp_my_matches = failing;
    render(<Matches />);
    expect(await screen.findByText('Группа ещё не назначена')).toBeInTheDocument();
    expect(fake.rpcCalls('match_rsvp_my_matches')).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('«Матчи» родителя: статус прошедшего матча', () => {
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  it('прошедший матч без результата не помечается как «Идёт или прошёл»', async () => {
    seedParent([row({ match_id: 'r2', starts_at: ago(48), can_answer: false, response: null })]);
    render(<Matches />);
    expect(await screen.findByText('Прошёл, результат не внесён')).toBeInTheDocument();
    expect(screen.queryByText('Идёт или прошёл')).toBeNull();
  });

  it('матч, начавшийся час назад, и без результата показывается как «Идёт»', async () => {
    seedParent([row({ match_id: 'r4', starts_at: ago(1), can_answer: false, response: null })]);
    render(<Matches />);
    expect(await screen.findByText('Идёт')).toBeInTheDocument();
  });

  it('общая длительность матча из настроек клуба продлевает «Идёт»', async () => {
    seedParent([row({ match_id: 'r6', starts_at: ago(2), can_answer: false, response: null })]);
    fake.rpc.match_duration_minutes = () => [{ team: '', value: '150' }];
    render(<Matches />);
    expect(await screen.findByText('Идёт')).toBeInTheDocument();
  });

  it('длительность команды важнее общей', async () => {
    seedParent([row({ match_id: 'r7', team: 'U9', starts_at: ago(1), can_answer: false, response: null })]);
    fake.rpc.match_duration_minutes = () => [{ team: '', value: '150' }, { team: 'U9', value: '40' }];
    render(<Matches />);
    expect(await screen.findByText('Прошёл, результат не внесён')).toBeInTheDocument();
    expect(screen.queryByText('Идёт')).toBeNull();
  });

  it('если настройка не читается или недопустима, действует 90 минут', async () => {
    seedParent([row({ match_id: 'r8', starts_at: ago(1), can_answer: false, response: null }), row({ match_id: 'r9', opponent: 'Динамо', starts_at: ago(2), can_answer: false, response: null })]);
    fake.rpc.match_duration_minutes = () => ({ data: null, error: { message: 'function does not exist' } });
    render(<Matches />);
    expect(await screen.findByText('Идёт')).toBeInTheDocument();
    expect(screen.getByText('Прошёл, результат не внесён')).toBeInTheDocument();
  });

  it('недопустимое значение настройки не ломает экран: действует 90 минут', async () => {
    seedParent([row({ match_id: 'r10', starts_at: ago(2), can_answer: false, response: null })]);
    fake.rpc.match_duration_minutes = () => [{ team: '', value: 'abc' }, { team: 'U9', value: '100000' }];
    render(<Matches />);
    expect(await screen.findByText('Прошёл, результат не внесён')).toBeInTheDocument();
  });

  it('отменённый и перенесённый матч не зависят от длительности', async () => {
    seedParent([
      row({ match_id: 'r12', opponent: 'Отмена', lifecycle_status: 'cancelled', starts_at: ago(1), can_answer: false }),
      row({ match_id: 'r13', opponent: 'Перенос', rescheduled: true, starts_at: ago(1), can_answer: false }),
    ]);
    fake.rpc.match_duration_minutes = () => [{ team: '', value: '300' }];
    render(<Matches />);
    expect(await screen.findByText('Отменён')).toBeInTheDocument();
    expect(screen.getByText('Перенесён')).toBeInTheDocument();
    expect(screen.queryByText('Идёт')).toBeNull();
  });

  it('название команды в настройке без учёта регистра: «u8» действует для «U8»', async () => {
    seedParent([row({ match_id: 'r14', team: 'U8', starts_at: ago(1), can_answer: false, response: null })]);
    fake.rpc.match_duration_minutes = () => [{ team: '', value: '300' }, { team: 'u8', value: '30' }];
    render(<Matches />);
    expect(await screen.findByText('Прошёл, результат не внесён')).toBeInTheDocument();
  });

  it('счёт внесён: матч не «Идёт», даже если длительность ещё не истекла', async () => {
    seedParent([row({ match_id: 'r11', starts_at: ago(1), can_answer: false, response: 'yes' })]);
    fake.db.matches = [{ id: 'r11', team: 'U9', played_on: new Date().toISOString().slice(0, 10), opponent: 'Олимп', goals_for: 0, goals_against: 0 }];
    fake.rpc.match_duration_minutes = () => [{ team: '', value: '300' }];
    render(<Matches />);
    expect((await screen.findAllByText('0:0')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Идёт')).toBeNull();
  });

  it('через 2 часа после начала матч без результата уже не «Идёт» (окно 1,5 часа)', async () => {
    seedParent([row({ match_id: 'r5', starts_at: ago(2), can_answer: false, response: null })]);
    render(<Matches />);
    expect(await screen.findByText('Прошёл, результат не внесён')).toBeInTheDocument();
    expect(screen.queryByText('Идёт')).toBeNull();
  });
});

describe('«Матчи» родителя: матч с подтверждением и счётом попадает в результаты', () => {
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  it('со счётом: в «Результатах» и итогах команды, а из секции «Отменённые и начавшиеся» ушёл', async () => {
    seedParent([row({ match_id: 'q1', opponent: 'Динамо', starts_at: ago(48), can_answer: false, response: 'yes' })]);
    fake.db.matches = [{ id: 'q1', team: 'U9', played_on: today, opponent: 'Динамо', goals_for: 2, goals_against: 1 }];
    render(<Matches />);
    // счёт виден и в строке результата, и в итогах команды (разность голов), поэтому ищем все
    expect((await screen.findAllByText('2:1')).length).toBeGreaterThan(0);
    expect(screen.getByText('Динамо')).toBeInTheDocument();
    expect(screen.getByText('Результаты')).toBeInTheDocument();
    expect(screen.queryByText('Отменённые и начавшиеся')).toBeNull();
    expect(screen.queryByText('Идёт')).toBeNull();
    expect(screen.queryByText('Прошёл, результат не внесён')).toBeNull();
  });

  it('без счёта: остаётся карточкой с подтверждением и не попадает в «Результаты»', async () => {
    seedParent([row({ match_id: 'q2', opponent: 'Динамо', starts_at: ago(48), can_answer: false, response: 'yes' })]);
    fake.db.matches = [{ id: 'q2', team: 'U9', played_on: today, opponent: 'Динамо', goals_for: null, goals_against: null }];
    render(<Matches />);
    expect(await screen.findByText('Прошёл, результат не внесён')).toBeInTheDocument();
    expect(screen.getAllByText('Динамо')).toHaveLength(1);
    expect(screen.queryByText('Результаты')).toBeNull();
  });

  it('отменённый матч остаётся в своей секции, даже если в базе есть счёт', async () => {
    seedParent([row({ match_id: 'q3', opponent: 'Динамо', lifecycle_status: 'cancelled', starts_at: ago(48), can_answer: false })]);
    fake.db.matches = [{ id: 'q3', team: 'U9', played_on: today, opponent: 'Динамо', goals_for: 2, goals_against: 1 }];
    render(<Matches />);
    expect(await screen.findByText('Отменён')).toBeInTheDocument();
    expect(screen.queryByText('2:1')).toBeNull();
    expect(screen.queryByText('Результаты')).toBeNull();
  });

  it('предстоящий матч с подтверждением не дублируется в общем списке', async () => {
    seedParent([row({ match_id: 'q4', opponent: 'Динамо' })]);
    fake.db.matches = [{ id: 'q4', team: 'U9', played_on: today, opponent: 'Динамо', goals_for: null, goals_against: null }];
    render(<Matches />);
    expect(await screen.findByText('Предстоит')).toBeInTheDocument();
    expect(screen.getAllByText('Динамо')).toHaveLength(1);
  });
});

describe('Карточка матча родителя: оформление', () => {
  it('ссылка в адресе кликабельна, заметка и место подписаны', async () => {
    seedParent([row({ venue: 'Isani', address: 'https://maps.app.goo.gl/abc', notes: 'Форма синяя' })]);
    render(<Matches />);
    const link = await screen.findByRole('link', { name: 'Открыть на карте' });
    expect(link).toHaveAttribute('href', 'https://maps.app.goo.gl/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Где играем')).toBeInTheDocument();
    expect(screen.getByText('От тренера')).toBeInTheDocument();
  });
});

describe('Тренер: матчи с подтверждением', () => {
  const groups = [{ id: 'g1', name: 'U9' }] as any;
  it('создаёт черновик с временем по Тбилиси', async () => {
    fake.db.matches = [matchRow({ id: 'new1', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new1';
    render(<CreateFlow groups={groups} onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Соперник'), { target: { value: 'Динамо' } });
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_create_draft')).toHaveLength(1));
    expect(fake.rpcCalls('match_rsvp_create_draft')[0]).toMatchObject({ p_club: 'c1', p_kind: 'friendly', p_team: 'U9', p_opponent: 'Динамо', p_starts_at: '2026-11-20T11:00:00+04:00', p_tournament: null });
    // состав добавляется сразу: у команды одна группа, берём её
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'new1', p_group: 'g1' }]));
    expect(await screen.findByText(/Черновик создан, но в выбранных группах нет активных игроков/)).toBeInTheDocument();
  });

  it('если состав не добавился, тренер видит понятную ошибку на экране матча', async () => {
    fake.db.matches = [matchRow({ id: 'new4', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new4';
    fake.rpc.match_rsvp_seed = () => ({ data: null, error: { message: 'forbidden' } });
    render(<CreateFlow groups={groups} onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    expect(await screen.findByText(/Черновик создан, но состав не добавлен: Нет доступа/)).toBeInTheDocument();
  });

  it('после автозаполнения показывается число добавленных игроков', async () => {
    fake.db.matches = [matchRow({ id: 'new5', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new5';
    fake.rpc.match_rsvp_seed = () => 12;
    render(<CreateFlow groups={groups} onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    expect(await screen.findByText('Черновик создан, в состав добавлено игроков: 12')).toBeInTheDocument();
  });

  it('товарищеский матч: можно выбрать группу U9-B, команда матча «U9-B», состав только из неё', async () => {
    fake.db.matches = [matchRow({ id: 'new2', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new2';
    fake.rpc.match_rsvp_seed = () => 3;
    const two = [{ id: 'g1', name: 'U9-A' }, { id: 'g2', name: 'U9-B' }] as any;
    render(<CreateFlow groups={two} onBack={() => {}} />);
    const opts = [...screen.getByLabelText('Команда').querySelectorAll('option')].map(o => o.value);
    expect(opts).toEqual(['U9', 'U9-A', 'U9-B']);
    fireEvent.change(screen.getByLabelText('Команда'), { target: { value: 'U9-B' } });
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'new2', p_group: 'g2' }]));
    expect(fake.rpcCalls('match_rsvp_create_draft')[0]).toMatchObject({ p_team: 'U9-B' });
  });

  it('товарищеский матч команды «U9» целиком: команда без буквы, состав из всех групп', async () => {
    fake.db.matches = [matchRow({ id: 'new2', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new2';
    fake.rpc.match_rsvp_seed = () => 3;
    const two = [{ id: 'g1', name: 'U9-A' }, { id: 'g2', name: 'U9-B' }] as any;
    render(<CreateFlow groups={two} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'new2', p_group: 'g1' }, { m: 'new2', p_group: 'g2' }]));
    expect(fake.rpcCalls('match_rsvp_create_draft')[0]).toMatchObject({ p_team: 'U9' });
  });

  it('матч чемпионата с выбранным событием: состав берётся из списка события', async () => {
    fake.db.matches = [matchRow({ id: 'new3', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', title: 'Кубок', kind: 'tournament', status: 'active' }];
    fake.rpc.match_rsvp_create_draft = () => 'new3';
    fake.rpc.match_rsvp_seed = () => 5;
    render(<CreateFlow groups={groups} onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Тип'), { target: { value: 'game' } });
    await waitFor(() => expect(screen.getByLabelText('Чемпионат или фестиваль').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Чемпионат или фестиваль'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'new3' }]));
  });

  describe('матч чемпионата: события как в «Добавить матч»', () => {
    const setup = (events: unknown[], g: unknown[]) => {
      fake.db.matches = [matchRow({ id: 'newc', lifecycle_status: 'draft' })];
      fake.db.clubs = [{ id: 'c1' }];
      fake.rpc.event_list = () => events;
      fake.rpc.match_rsvp_create_draft = () => 'newc';
      fake.rpc.match_rsvp_seed = () => 5;
      return render(<CreateFlow groups={g as any} onBack={() => {}} />);
    };
    const pick = async (label: string) => {
      fireEvent.change(await screen.findByLabelText('Тип'), { target: { value: 'game' } });
      await waitFor(() => expect(screen.getByLabelText('Чемпионат или фестиваль').querySelectorAll('option').length).toBeGreaterThan(1));
      fireEvent.change(screen.getByLabelText('Чемпионат или фестиваль'), { target: { value: label } });
      fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    };

    it('событие команды с буквой (U9-B) доступно, команда матча берётся из события', async () => {
      setup([{ id: 'e2', team: 'U9-B', kind: 'championship', name: 'Championship 2', status: 'active' }], [{ id: 'g1', name: 'U9-A' }, { id: 'g2', name: 'U9-B' }]);
      await pick('e2');
      await waitFor(() => expect(fake.rpcCalls('match_rsvp_create_draft')).toHaveLength(1));
      expect(fake.rpcCalls('match_rsvp_create_draft')[0]).toMatchObject({ p_kind: 'game', p_team: 'U9-B', p_tournament: 'e2' });
      await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'newc' }]));
    });

    it('событие U13-A доступно тренеру группы U13-A', async () => {
      setup([{ id: 'e3', team: 'U13-A', kind: 'championship', name: 'Championship 2', status: 'active' }], [{ id: 'g3', name: 'U13-A' }]);
      await pick('e3');
      await waitFor(() => expect(fake.rpcCalls('match_rsvp_create_draft')[0]).toMatchObject({ p_team: 'U13-A', p_tournament: 'e3' }));
    });

    it('события чужих команд и завершённые не предлагаются, название показывает команду', async () => {
      setup([
        { id: 'e1', team: 'U9', kind: 'championship', name: 'Чемпионат', status: 'active' },
        { id: 'e5', team: 'U13-A', kind: 'championship', name: 'Чужой', status: 'active' },
        { id: 'e6', team: 'U9', kind: 'festival', name: 'Старый', status: 'finished' },
      ], [{ id: 'g1', name: 'U9' }]);
      fireEvent.change(await screen.findByLabelText('Тип'), { target: { value: 'game' } });
      await waitFor(() => expect(screen.getByLabelText('Чемпионат или фестиваль').querySelectorAll('option').length).toBe(2));
      expect(screen.getByRole('option', { name: 'Чемпионат · U9' })).toBeInTheDocument();
    });

    it('администратор и тренер всех команд видят события любых команд', async () => {
      fake.db.matches = [];
      fake.db.clubs = [{ id: 'c1' }];
      fake.rpc.event_list = () => [{ id: 'e5', team: 'U13-A', kind: 'championship', name: 'Чужой', status: 'active' }];
      render(<CreateFlow groups={[{ id: 'g1', name: 'U9' }] as any} all onBack={() => {}} />);
      fireEvent.change(await screen.findByLabelText('Тип'), { target: { value: 'game' } });
      await waitFor(() => expect(screen.getByLabelText('Чемпионат или фестиваль').querySelectorAll('option').length).toBe(2));
    });
  });

  it('в карточке опубликованного матча видны сводка и состав, можно отметить за родителя', async () => {
    fake.db.matches = [{ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: null, address: null, notes: null, tournament_id: null }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 2, yes: 1, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [
      { player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', status: 'invited', response: 'yes', responded_by_name: 'Мама', responded_by_coach: false, responded_at: null, answer_until: future },
      { player_id: 'p2', full_name: 'Сидоров Иван', group_name: 'U9', status: 'invited', response: null, responded_by_name: null, responded_by_coach: false, responded_at: null, answer_until: future },
    ];
    render(<RsvpDetail id={idOf('U9 · Олимп')} groups={groups} onBack={() => {}} />);
    const sum = await screen.findByLabelText('Сводка ответов');
    expect(within(sum).getByText(/Приглашено: 2 · Будут: 1 · Не будут: 0 · Не ответили: 1/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Сидоров Иван: Не будет' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_coach_set')).toEqual([{ m: 'm1', p_player: 'p2', p_response: 'no' }]));
  });

  it('напоминание требует подтверждения', async () => {
    fake.db.matches = [{ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: null, address: null, notes: null, tournament_id: null }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [];
    fake.rpc.match_rsvp_remind_unanswered = () => [{ queued: 1, skipped: 0 }];
    render(<RsvpDetail id={idOf('U9 · Олимп')} groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить не ответившим' }));
    expect(fake.rpcCalls('match_rsvp_remind_unanswered')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_remind_unanswered')).toHaveLength(1));
    expect(await screen.findByText(/Поставлено в очередь: 1/)).toBeInTheDocument();
  });

  const matchRow = (o: Record<string, unknown> = {}) => ({ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: 'Стадион', address: null, notes: null, tournament_id: null, ...o });
  const rosterRows = [
    { player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', status: 'invited', response: null, responded_by_name: null, responded_by_coach: false, responded_at: null, answer_until: future },
    { player_id: 'p9', full_name: 'Убранный Игрок', group_name: 'U9', status: 'removed', response: null, responded_by_name: null, responded_by_coach: false, responded_at: null, answer_until: future },
  ];
  const openMatch = async () => {
    render(<RsvpDetail id={idOf('U9 · Олимп')} groups={groups} onBack={() => {}} />);
  };

  it('правка данных матча отправляет только изменённые поля', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    fireEvent.change(await screen.findByLabelText('Соперник'), { target: { value: 'Динамо' } });
    fireEvent.change(screen.getByLabelText('Адрес или ссылка на карту'), { target: { value: 'https://maps.app.goo.gl/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_update')).toEqual([{ m: 'm1', p: { opponent: 'Динамо', address: 'https://maps.app.goo.gl/x' } }]));
  });

  it('исключённые игроки в составе не показываются, активного можно убрать', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText('Убранный Игрок')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из состава: Иванов Пётр' }));
    expect(fake.rpcCalls('match_rsvp_remove')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_remove')).toEqual([{ m: 'm1', p_players: ['p1'] }]));
  });

  it('игрока можно найти по фамилии и добавить в состав', async () => {
    fake.db.matches = [matchRow()];
    fake.db.players = [{ id: 'p5', full_name: 'Сидоров Иван' }, { id: 'p1', full_name: 'Иванов Пётр' }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    fireEvent.change(await screen.findByLabelText('Добавить игрока в состав'), { target: { value: 'ван' } });
    // Иванов уже в составе: предлагается только Сидоров
    const card = await screen.findByLabelText('Добавить игрока');
    fireEvent.click(await within(card).findByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_invite')).toEqual([{ m: 'm1', p_players: ['p5'] }]));
  });

  it('состав черновика товарищеского матча берётся из групп команды', async () => {
    fake.db.matches = [matchRow({ lifecycle_status: 'draft' })];
    fake.rpc.match_rsvp_summary = () => [{ invited: 0, yes: 0, no: 0, unanswered: 0, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [];
    fake.rpc.match_rsvp_seed = () => 7;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Заполнить состав команды' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'm1', p_group: 'g1' }]));
    expect(await screen.findByText('Добавлено игроков: 7')).toBeInTheDocument();
  });

  it('состав матча чемпионата берётся из списка события', async () => {
    fake.db.matches = [matchRow({ lifecycle_status: 'draft', kind: 'game', tournament_id: 't1' })];
    fake.rpc.match_rsvp_summary = () => [{ invited: 0, yes: 0, no: 0, unanswered: 0, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [];
    fake.rpc.match_rsvp_seed = () => 5;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Заполнить состав из события' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'm1' }]));
  });

  it('начавшийся опубликованный матч можно отменить и перенести, но не править состав и не напоминать', async () => {
    const started = new Date(Date.now() - 3600_000).toISOString();
    fake.db.matches = [matchRow({ starts_at: started })];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    render(<RsvpDetail id={idOf('U9 · Олимп')} groups={groups} admin onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Отменить матч' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перенести матч' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Напомнить не ответившим' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить данные матча' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Убрать из состава/ })).toBeNull();
  });

  it('тренер не видит «Перенести матч» и «Отменить матч», время опубликованного матча в правке закрыто (0227)', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Перенести матч' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить матч' })).toBeNull();
    expect(screen.getByText(/Перенос и отмену матча выполняет администратор/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить данные матча' }));
    await screen.findByLabelText('Соперник');
    expect(screen.queryByLabelText(/Дата и время/)).toBeNull();
  });

  it('администратор видит «Перенести матч» и «Отменить матч» и время в правке', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    render(<RsvpDetail id={idOf('U9 · Олимп')} groups={groups} admin onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Перенести матч' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отменить матч' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить данные матча' }));
    expect(await screen.findByLabelText(/Дата и время/)).toBeInTheDocument();
  });

  it('ошибка сервера «только администратор» показывается по-русски', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    fake.rpc.match_rsvp_cancel = () => ({ data: null, error: { message: 'only admin can cancel or reschedule' } });
    render(<RsvpDetail id={idOf('U9 · Олимп')} groups={groups} admin onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить матч' }));
    const btns = await screen.findAllByRole('button', { name: 'Отменить матч' });
    fireEvent.click(btns[btns.length - 1]);
    expect(await screen.findByText('Отменять и переносить матч может только администратор')).toBeInTheDocument();
  });

  it('фильтр сводки показывает только выбранную группу', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 2, yes: 1, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [
      { ...rosterRows[0], response: 'yes' },
      { ...rosterRows[0], player_id: 'p2', full_name: 'Сидоров Иван', response: null },
    ];
    await openMatch();
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Не ответили \(1\)/ }));
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
    expect(screen.getByText('Сидоров Иван')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Не будут \(0\)/ }));
    expect(screen.getByText('В этой группе никого нет.')).toBeInTheDocument();
  });

  it('блок «Приглашённые»: фильтр одной сеткой из 4 кнопок с числами, игроки одним списком без вложенных карточек, статус пилюлей', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 2, yes: 1, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [
      { ...rosterRows[0], response: 'yes' },
      { ...rosterRows[0], player_id: 'p2', full_name: 'Сидоров Иван', response: null },
    ];
    await openMatch();
    await screen.findByText('Иванов Пётр');
    const filter = screen.getByRole('group', { name: 'Фильтр по ответам' });
    expect(filter.className).toContain('ks-rsvp-filter');
    expect(within(filter).getAllByRole('button')).toHaveLength(4);
    expect(within(filter).getByRole('button', { name: 'Все (2)' })).toHaveAttribute('aria-pressed', 'true');
    const list = document.querySelector('.ks-rsvp-list')!;
    expect(list.querySelectorAll('.ks-rsvp-item')).toHaveLength(2);
    expect(list.querySelector('.ks-card, .ks-row')).toBeNull(); // без карточки в карточке
    expect(list.querySelectorAll('.ks-pill')).toHaveLength(2);
  });

  it('история действий показывается по кнопке', async () => {
    fake.db.matches = [matchRow()];
    fake.db.match_activity = [{ id: 1, match_id: 'm1', action: 'published', created_at: future }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Показать историю действий' }));
    expect(await screen.findByText(/Матч опубликован/)).toBeInTheDocument();
  });

  it('после переноса с отметками можно вернуть отметки из снимка', async () => {
    fake.db.matches = [matchRow()];
    fake.db.match_mark_snapshots = [{ id: 's1', match_id: 'm1', restored_at: null, taken_at: future }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    fake.rpc.match_rsvp_restore_marks = () => null;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть отметки до переноса' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_restore_marks')).toEqual([{ p_snapshot: 's1' }]));
  });
});
