// Профиль игрока для родителя и ребёнка (#266): условия П1.4–П1.11 и П2.11–П2.14 из docs/PLAYER_PROFILE_ACCEPTANCE.md.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { seasonStart } from '../lib/seasonStats';
import PlayerProfile, { tbilisiToday } from './PlayerProfile';

const anya = { id: 'p1', full_name: 'Аня Петрова', birth_date: '2016-04-02', groups: { name: 'U10-A' } };
const led = (player_id: string, points: number) => ({ id: `l${player_id}${points}`, player_id, points, event_date: '2026-11-03', source_type: 'group_session', reason_code: 'attended', components: { class: 'regular', base: points }, status: 'active' });
const mp = (match_id: string, player_id: string, played: boolean, goals: number, m: Record<string, unknown>) => ({ match_id, player_id, played, goals, matches: { team: 'U10', opponent: null, goals_for: null, goals_against: null, ...m } });
const tr = (day: string, status: string, extra: Record<string, unknown> = {}) => ({ day, starts_at: '15:00:00', kind: 'group', title: 'Групповая тренировка', group_name: 'U10-A', status, ...extra });

const open = (section?: string) => {
  render(<PlayerProfile playerId="p1" onBack={() => {}} />);
  return (async () => {
    expect(await screen.findByRole('heading', { name: 'Аня Петрова' })).toBeInTheDocument();
    if (section) fireEvent.click(screen.getByRole('tab', { name: section }));
  })();
};

describe('профиль игрока: шапка и доступ', () => {
  it('шапка: имя, группа, дата рождения; разделов ровно четыре', async () => {
    fake.db.players = [anya];
    await open();
    expect(screen.getByText('U10-A')).toBeInTheDocument();
    expect(screen.getByText('Дата рождения: 02.04.2016')).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: 'Разделы профиля' })).getAllByRole('tab').map(t => t.textContent);
    expect(tabs).toEqual(['Обзор', 'Матчи', 'Тренировки', 'Баллы']);
    expect(screen.queryByText(/Прогресс|Достижения|Номер|Позиция/)).toBeNull();
  });

  it('без даты рождения строки даты нет', async () => {
    fake.db.players = [{ ...anya, birth_date: null }];
    await open();
    expect(screen.queryByText(/Дата рождения/)).toBeNull();
  });

  it('показывает позицию и действующий номер текущей команды и сезона', async () => {
    fake.db.players = [{ ...anya, player_profiles: { first_name: 'Аня', last_name: 'Петрова', primary_position: 'Нападающий', jersey_number: 10, jersey_team: 'U10', jersey_season_start: seasonStart(tbilisiToday()) } }];
    await open();
    expect(screen.getByText('Позиция: Нападающий')).toBeInTheDocument();
    expect(screen.getByText('Номер: 10')).toBeInTheDocument();
  });

  it('не показывает номер другой команды или другого сезона', async () => {
    fake.db.players = [{ ...anya, player_profiles: { first_name: 'Аня', last_name: 'Петрова', primary_position: null, jersey_number: 10, jersey_team: 'U11', jersey_season_start: seasonStart(tbilisiToday()) } }];
    await open();
    expect(screen.queryByText(/Номер: 10/)).toBeNull();
    fake.db.players = [{ ...anya, player_profiles: { first_name: 'Аня', last_name: 'Петрова', primary_position: null, jersey_number: 10, jersey_team: 'U10', jersey_season_start: '2020-09-01' } }];
    await open();
    expect(screen.queryByText(/Номер: 10/)).toBeNull();
  });

  it('игрок не отдан сервером: «Профиль недоступен» без сведений', async () => {
    fake.db.players = [];
    render(<PlayerProfile playerId="p1" onBack={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Профиль недоступен' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(fake.rpcCalls('player_training_history')).toEqual([]);
  });

  it('ошибка загрузки: сообщение и повтор', async () => {
    fake.db.players = [anya];
    fake.errors.players = 'сбой сети';
    render(<PlayerProfile playerId="p1" onBack={() => {}} />);
    expect(await screen.findByText('Не удалось загрузить профиль')).toBeInTheDocument();
    delete fake.errors.players;
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByRole('heading', { name: 'Аня Петрова' })).toBeInTheDocument();
  });

  it('в Telegram экранной «Назад» нет: работает кнопка Telegram (скриншот 24.11, две стрелки назад)', async () => {
    fake.db.players = [anya];
    const w = window as unknown as { Telegram?: unknown };
    w.Telegram = { WebApp: { initData: 'query_id=1', BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, themeParams: {} } };
    try {
      await open();
      expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
    } finally { delete w.Telegram; }
  });

  it('«Назад» вызывает возврат', async () => {
    fake.db.players = [anya];
    let back = 0;
    render(<PlayerProfile playerId="p1" onBack={() => back++} />);
    await screen.findByRole('heading', { name: 'Аня Петрова' });
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(back).toBe(1);
  });
});

describe('профиль игрока: обзор и матчи', () => {
  it('обзор: свои сыгранные матчи и голы, баллы, последняя тренировка; чужие строки не считаются', async () => {
    fake.db.players = [anya];
    fake.db.match_players = [mp('m1', 'p1', true, 2, { played_on: '2026-10-10' }), mp('m2', 'p1', true, 0, { played_on: '2026-10-12' }), mp('m3', 'p1', false, 0, { played_on: '2026-10-14' }), mp('m4', 'p2', true, 5, { played_on: '2026-10-10' })];
    fake.db.points_ledger = [led('p1', 3), led('p2', 9)];
    fake.rpc.player_training_history = () => [tr('2026-11-05', 'unmarked'), tr('2026-11-03', 'present'), tr('2026-11-01', 'absent')];
    await open();
    expect(screen.getByText('2 · голов: 2')).toBeInTheDocument();
    expect(screen.getByText('3 балла')).toBeInTheDocument();
    expect(await screen.findByText('03.11.2026')).toBeInTheDocument();
  });

  it('обзор без матчей и посещений: слова, а не нули', async () => {
    fake.db.players = [anya];
    fake.rpc.player_training_history = () => [];
    await open();
    expect(screen.getByText('Пока нет отмеченных матчей')).toBeInTheDocument();
    expect(await screen.findByText('За 90 дней посещений не отмечено')).toBeInTheDocument();
  });

  it('К1, К3, О2: матчи команды с пометками «Играл / Не играл», голами и счётом; новые сверху', async () => {
    fake.db.players = [anya];
    fake.db.match_players = [
      mp('m1', 'p1', true, 2, { played_on: '2026-10-10', opponent: 'Динамо', goals_for: 3, goals_against: 1 }),
      mp('m2', 'p1', true, 0, { played_on: '2026-10-12', opponent: 'Локо' }),
      mp('m3', 'p1', false, 0, { played_on: '2026-10-14', opponent: 'Торпедо', goals_for: 0, goals_against: 2 }),
      mp('m4', 'p2', true, 5, { played_on: '2026-10-10', opponent: 'Чужой' }),
    ];
    fake.db.matches = [
      { id: 'm5', team: 'U10', played_on: '2026-10-20', opponent: 'Урожай', goals_for: 2, goals_against: 2 }, // записи ребёнка нет, матч позже первой записи: не играл
      { id: 'm0', team: 'U10', played_on: '2026-09-01', opponent: 'Давний', goals_for: 1, goals_against: 0 }, // до первой записи: ребёнка в команде не было
    ];
    await open('Матчи');
    const list = screen.getByRole('region', { name: 'Матчи' });
    expect(within(list).getAllByText(/^(Динамо|Локо|Торпедо|Урожай)$/).map(e => e.textContent)).toEqual(['Урожай', 'Торпедо', 'Локо', 'Динамо']);
    expect(within(list).queryByText('Давний')).toBeNull();
    expect(within(list).queryByText('Чужой')).toBeNull();
    const row = (t: string) => within(list).getByText(t).closest('.ks-mres') as HTMLElement;
    expect(row('Динамо')).toHaveTextContent('10.10.2026 · U10');
    expect(row('Динамо')).toHaveTextContent('Играл · голы: 2');
    expect(row('Динамо')).toHaveTextContent('3:1');
    expect(row('Динамо')).toHaveClass('w');
    expect(row('Торпедо')).toHaveTextContent('Не играл');
    expect(row('Торпедо')).toHaveClass('l');
    expect(row('Урожай')).toHaveTextContent('Не играл');
    expect(row('Урожай')).toHaveClass('d');
    expect(row('Локо')).toHaveTextContent('Без счёта');
    expect(row('Локо')).toHaveClass('n');
  });

  it('К2, О6: плитки «матчей команды / играл / голов» и побед, ничьих, поражений; форма В/Н/П', async () => {
    fake.db.players = [anya];
    fake.db.match_players = [
      mp('m1', 'p1', true, 2, { played_on: '2026-10-10', opponent: 'А', goals_for: 3, goals_against: 1 }),
      mp('m3', 'p1', false, 0, { played_on: '2026-10-14', opponent: 'Б', goals_for: 0, goals_against: 2 }),
    ];
    fake.db.matches = [{ id: 'm5', team: 'U10', played_on: '2026-10-20', opponent: 'В', goals_for: 2, goals_against: 2 }];
    await open('Матчи');
    const sum = screen.getByLabelText('Итоги ребёнка');
    expect(within(sum).getByText('матчей команды').parentElement).toHaveTextContent('3');
    expect(within(sum).getByText('играл').parentElement).toHaveTextContent('1');
    expect(within(sum).getByText('голов (его)').parentElement).toHaveTextContent('2');
    const t = within(sum).getByRole('group', { name: 'Результаты матчей' });
    for (const k of ['побед', 'ничьих', 'поражений']) expect(within(t).getByText(k).parentElement).toHaveTextContent('1');
    expect(within(sum).getAllByRole('listitem').map(e => e.getAttribute('aria-label'))).toEqual(['Ничья', 'Поражение', 'Победа']);
  });

  it('О4, О5: оценка, баллы и «★ Лучший» у сыгравшего; без оценки и у «Не играл» ничего нет', async () => {
    fake.db.players = [anya];
    const withRating = (id: string, played: boolean, rating: number | null, best: boolean, m: Record<string, unknown>) => ({ ...mp(id, 'p1', played, 0, m), best, performance_rating: rating });
    fake.db.match_players = [
      withRating('m1', true, 3, false, { played_on: '2026-12-05', opponent: 'Три', goals_for: 0, goals_against: 5 }),
      withRating('m2', true, 5, true, { played_on: '2026-12-04', opponent: 'Пять', goals_for: 1, goals_against: 5 }),
      withRating('m3', true, null, false, { played_on: '2026-12-03', opponent: 'Нет', goals_for: 1, goals_against: 0 }),
      withRating('m4', false, null, false, { played_on: '2026-12-02', opponent: 'Скамейка', goals_for: 1, goals_against: 0 }),
    ];
    await open('Матчи');
    const list = screen.getByRole('region', { name: 'Матчи' });
    const row = (t: string) => within(list).getByText(t).closest('.ks-mres') as HTMLElement;
    expect(within(row('Три')).getByRole('img', { name: 'Оценка 3 из 5' })).toBeInTheDocument();
    expect(row('Три')).toHaveTextContent('+3 б.');
    expect(row('Три')).not.toHaveTextContent('Лучший');
    expect(within(row('Пять')).getByRole('img', { name: 'Оценка 5 из 5' })).toBeInTheDocument();
    expect(row('Пять')).toHaveTextContent('★ Лучший');
    expect(row('Пять')).toHaveTextContent('+6 б.');
    expect(within(row('Нет')).queryByRole('img', { name: /Оценка/ })).toBeNull();
    expect(row('Нет')).not.toHaveTextContent('б.');
    expect(within(row('Скамейка')).queryByRole('img', { name: /Оценка/ })).toBeNull();
    expect(row('Скамейка')).not.toHaveTextContent('Лучший');
  });

  it('К1: матчи месяцами, свежий месяц открыт, прошлые свёрнуты', async () => {
    fake.db.players = [anya];
    fake.db.match_players = [
      mp('m1', 'p1', true, 0, { played_on: '2026-10-10', opponent: 'А', goals_for: 3, goals_against: 1 }),
      mp('m2', 'p1', true, 0, { played_on: '2026-11-10', opponent: 'Б', goals_for: 1, goals_against: 1 }),
    ];
    await open('Матчи');
    const groups = screen.getByRole('region', { name: 'Матчи' }).querySelectorAll('details');
    expect([...groups].map(g => g.hasAttribute('open'))).toEqual([true, false]);
    expect(groups[0]).toHaveTextContent('11.2026');
    expect(groups[0]).toHaveTextContent('1 матч');
  });

  it('К4, К5: без записей об участии пустое состояние, плиток нет; обзор не меняется', async () => {
    fake.db.players = [anya];
    fake.db.matches = [{ id: 'm5', team: 'U10', played_on: '2026-10-20', opponent: 'В', goals_for: 2, goals_against: 2 }];
    await open('Матчи');
    expect(screen.getByText('Отмеченных матчей пока нет')).toBeInTheDocument();
    expect(screen.queryByLabelText('Итоги ребёнка')).toBeNull();
  });

  it('матчей нет: пустое состояние с подсказкой', async () => {
    fake.db.players = [anya];
    await open('Матчи');
    expect(screen.getByText('Отмеченных матчей пока нет')).toBeInTheDocument();
  });

  it('баллы: существующий журнал', async () => {
    fake.db.players = [anya];
    fake.db.points_ledger = [led('p1', 3)];
    await open('Баллы');
    expect(await screen.findByText('Всего накоплено: 3 балла')).toBeInTheDocument();
  });
});

describe('профиль игрока: тренировки', () => {
  it('первая порция: последние 90 дней по Тбилиси, статусы словами', async () => {
    fake.db.players = [anya];
    fake.rpc.player_training_history = () => [
      tr('2026-11-05', 'unmarked'),
      tr('2026-11-03', 'present'),
      tr('2026-11-01', 'absent'),
      tr('2026-10-30', 'excused'),
      { day: '2026-10-29', starts_at: null, kind: 'extra', title: 'Дополнительная тренировка', group_name: null, status: 'present' },
    ];
    await open('Тренировки');
    const call = fake.rpcCalls('player_training_history')[0];
    expect(call.p).toBe('p1');
    expect(call.p_to).toBe(tbilisiToday());
    const days = (Date.parse(call.p_to) - Date.parse(call.p_from)) / 86400000;
    expect(days).toBe(89);
    const sec = screen.getByRole('region', { name: 'Тренировки' });
    for (const w of ['Был', 'Не был', 'Уважительная причина', 'Нет отметки']) expect(within(sec).getAllByText(w).length).toBeGreaterThan(0);
    expect(within(sec).getByText('05.11.2026 · 15:00 · U10-A')).toBeInTheDocument();
    expect(within(sec).getByText('29.10.2026')).toBeInTheDocument();
    expect(within(sec).getByText(/«Нет отметки» значит, что тренер не отметил посещение/)).toBeInTheDocument();
  });

  it('пусто: понятное состояние', async () => {
    fake.db.players = [anya];
    fake.rpc.player_training_history = () => [];
    await open('Тренировки');
    expect(await screen.findByText('Отмеченных тренировок за этот период нет')).toBeInTheDocument();
  });

  it('«Показать ещё»: следующая порция старше, без пропуска дня; не глубже 360 дней', async () => {
    fake.db.players = [anya];
    fake.rpc.player_training_history = () => [];
    await open('Тренировки');
    for (let i = 0; i < 3; i++) {
      fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё 90 дней' }));
      await waitFor(() => expect(fake.rpcCalls('player_training_history').length).toBe(i + 2));
    }
    const calls = fake.rpcCalls('player_training_history');
    for (let i = 1; i < calls.length; i++) expect(Date.parse(calls[i - 1].p_from) - Date.parse(calls[i].p_to)).toBe(86400000);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Показать ещё 90 дней' })).toBeNull());
    expect((Date.parse(tbilisiToday()) - Date.parse(calls[3].p_from)) / 86400000).toBe(359);
  });

  it('ошибка ленты: сообщение и повтор, профиль остаётся', async () => {
    fake.db.players = [anya];
    fake.rpc.player_training_history = () => ({ error: { message: 'forbidden' } });
    await open('Тренировки');
    expect(await screen.findByText(/Не удалось загрузить тренировки/)).toBeInTheDocument();
    fake.rpc.player_training_history = () => [tr('2026-11-03', 'present')];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Был')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Аня Петрова' })).toBeInTheDocument();
  });
});

describe('профиль игрока: смена вкладки без мигания (правка 24.11)', () => {
  it('В1–В2: разделы в одной обёртке, она не пересоздаётся и держит высоту', async () => {
    fake.db.players = [anya];
    await open();
    const wrap = screen.getByLabelText('Обзор').parentElement as HTMLElement;
    expect(wrap.classList.contains('ks-prof-body')).toBe(true);
    expect(wrap.parentElement?.classList.contains('page')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Матчи' }));
    const wrap2 = screen.getByLabelText('Матчи').parentElement as HTMLElement;
    expect(wrap2).toBe(wrap);
    expect(wrap2.style.minHeight).not.toBe('');
  });
});
