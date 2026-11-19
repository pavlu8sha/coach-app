import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import Sessions, { groupExtraRoster, groupRoster } from './Sessions';
import { DirtyGuardHost, dirtyGuard } from '../nav';

const groups = [{ id: 'g1', name: 'U9' }];
beforeEach(() => { localStorage.clear(); dirtyGuard.reset(); });
function seed() {
  fake.db.weekly_schedule = [1, 2, 3, 4, 5, 6, 7].map(w => ({ group_id: 'g1', weekday: w, starts_at: '18:00:00', location: 'Стадион', kind: 'Групповая' }));
  fake.db.players = [
    { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
    { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
  ];
  fake.db.sessions = [];
  fake.db.attendance = [];
  fake.rpc.open_session = () => 'sid-1';
}

describe('«Занятия»', () => {
  it('тренер отмечает всех и сохраняет: сначала открывается занятие, затем уходят отметки', async () => {
    seed();
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    fireEvent.click(await screen.findByText('Все были'));
    fireEvent.click(screen.getByText('Сохранить отметки'));
    await waitFor(() => expect(fake.rpcCalls('mark_attendance')).toHaveLength(1));
    expect(fake.rpcCalls('open_session')).toEqual([{ g: 'g1', d: today() }]);
    expect(fake.rpcCalls('mark_attendance')[0]).toEqual({
      s: 'sid-1',
      marks: [{ player_id: 'p1', status: 'present' }, { player_id: 'p2', status: 'present' }],
    });
    expect(await screen.findByText(/Отметки сохранены/)).toBeInTheDocument();
  });

  it('прежние отметки подгружаются, сохранять без изменений нельзя', async () => {
    seed();
    fake.db.sessions = [{ id: 'sid-1', group_id: 'g1', source_key: `ATT|${today()}` }];
    fake.db.attendance = [{ session_id: 'sid-1', player_id: 'p1', status: 'excused' }];
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    await screen.findByText('Иванов Пётр');
    expect(screen.getByText('Сохранить отметки')).toBeDisabled();
    expect(fake.rpcCalls('open_session')).toHaveLength(0); // просмотр занятие не создаёт
  });

  it('вернувшийся позже этой даты в список отметок не попадает', async () => {
    seed();
    fake.db.player_status_log = [
      { player_id: 'p2', status: 'inactive', on_date: '2020-01-01' },
      { player_id: 'p2', status: 'active', on_date: '2999-01-01' },
    ];
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    expect(screen.queryByText('Сидоров Ян')).not.toBeInTheDocument();
    fake.db.player_status_log = [];
  });

  it('если нет занятий в расписании, показывает пустое состояние', async () => {
    fake.db.weekly_schedule = [];
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
    fake.db.sessions = [];
    fake.db.attendance = [];
    render(<Sessions groups={groups} />);
    expect(await screen.findByText('Нет занятий в расписании')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Другая группа/ }));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument(); // доп. или перенесённая тренировка
  });

  it('сохранить можно, только когда отмечены все дети', async () => {
    seed();
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    fireEvent.click(within(screen.getByRole('group', { name: 'Посещаемость: Иванов Пётр' })).getByRole('button', { name: 'Был' }));
    expect(screen.getByText('Сохранить отметки')).toBeDisabled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Посещаемость: Сидоров Ян' })).getByRole('button', { name: 'Не был' }));
    expect(screen.getByText('Сохранить отметки')).toBeEnabled();
  });

  it('ошибку базы переводит в понятный текст', async () => {
    seed();
    fake.rpc.mark_attendance = () => ({ error: { message: 'player not in group' } });
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    fireEvent.click(await screen.findByText('Все были'));
    fireEvent.click(screen.getByText('Сохранить отметки'));
    expect(await screen.findByText('Игрок не из этой группы.')).toBeInTheDocument();
  });
});

const markOf = (n: string, label: 'Был' | 'Не был') => fireEvent.click(within(screen.getByRole('group', { name: `Посещаемость: ${n}` })).getByRole('button', { name: label }));

describe('«Отметки»: компактная сводка (UI-016)', () => {
  it('полоса, счётчики и кнопки собраны в закреплённый блок', async () => {
    seed();
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    const bar = screen.getByRole('button', { name: 'Все были' }).closest('.ks-sumbar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(within(bar).getByText('осталось')).toBeInTheDocument();
    expect(bar.querySelector('.ks-progress')).not.toBeNull();
    expect(within(bar).getByRole('button', { name: 'Сбросить' })).toBeDisabled();
    markOf('Иванов Пётр', 'Был');
    expect(within(bar).getByRole('button', { name: 'Сбросить' })).toBeEnabled();
    expect(within(bar).getByText('были').querySelector('b')?.textContent).toBe('1');
    fireEvent.click(within(bar).getByRole('button', { name: 'Сбросить' }));
    expect(within(bar).getByText('осталось').querySelector('b')?.textContent).toBe('2');
  });

  it('«Другая группа» — кнопка с aria-pressed, доступна и со списком, и без занятий', async () => {
    seed();
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    const b = screen.getByRole('button', { name: /Другая группа/ });
    expect(b).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(b);
    expect(await screen.findByRole('button', { name: 'Только группы по расписанию' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('пустое состояние ссылается на кнопку «Другая группа»', async () => {
    fake.db.weekly_schedule = [];
    fake.db.players = [];
    render(<Sessions groups={groups} />);
    const t = await screen.findByText(/Другая группа \(доп\. или перенос\)…/, { selector: 'p' });
    expect(t).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Другая группа/ })).toBeInTheDocument();
  });
});

describe('«Отметки»: несохранённые отметки (UI-016)', () => {
  beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); }); // окно подтверждения возвращает прокрутку; в jsdom метода нет

  it('после отметки включён guard, после сохранения снят', async () => {
    seed();
    render(<Sessions groups={groups} />);
    await screen.findByText('Иванов Пётр');
    expect(dirtyGuard.isDirty()).toBe(false);
    markOf('Иванов Пётр', 'Был');
    expect(dirtyGuard.isDirty()).toBe(true);
    markOf('Сидоров Ян', 'Был');
    fireEvent.click(screen.getByText('Сохранить отметки'));
    await screen.findByText(/Отметки сохранены/);
    expect(dirtyGuard.isDirty()).toBe(false);
  });

  it('смена вкладки при несохранённых отметках: «Отмена» оставляет всё, «Уйти» меняет', async () => {
    seed();
    fake.rpc.ind_roster_list = () => [];
    fake.rpc.extra_roster_list = () => [];
    render(<><Sessions groups={groups} /><DirtyGuardHost /></>);
    await screen.findByText('Иванов Пётр');
    markOf('Иванов Пётр', 'Был');
    fireEvent.click(screen.getByRole('tab', { name: 'Индивидуальные' }));
    expect(await screen.findByRole('dialog', { name: 'Уйти без сохранения?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Группы' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('group', { name: 'Посещаемость: Иванов Пётр' })).getByRole('button', { name: 'Был' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Индивидуальные' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Уйти' }));
    expect(await screen.findByText('Индивидуальных занятий нет')).toBeInTheDocument();
    expect(dirtyGuard.isDirty()).toBe(false);
  });

  it('смена даты и режима «Другая группа» тоже спрашивают; без правок — без вопроса', async () => {
    seed();
    render(<><Sessions groups={groups} /><DirtyGuardHost /></>);
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByRole('button', { name: /Другая группа/ })); // без правок: сразу
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Только группы по расписанию' })).toBeInTheDocument();
    markOf('Иванов Пётр', 'Был');
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-01-05' } });
    expect(await screen.findByRole('dialog', { name: 'Уйти без сохранения?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((screen.getByLabelText('Дата') as HTMLInputElement).value).toBe(today());
    fireEvent.click(screen.getByRole('button', { name: 'Только группы по расписанию' }));
    expect(await screen.findByRole('dialog', { name: 'Уйти без сохранения?' })).toBeInTheDocument();
  });
});

describe('«Отметки»: вкладка «Индивидуальные»', () => {
  it('показывает занятия выбранной даты, отметка идёт в ind_set_attended', async () => {
    const t = today();
    seed();
    fake.db.individual_sessions = [];
    fake.rpc.ind_roster_list = () => [
      { session_id: 's1', starts_at: `${t}T19:00:00`, topic: 'Дриблинг', goalkeepers: true, player_id: 'p1', full_name: 'Иванов Пётр', attended: null },
      { session_id: 's1', starts_at: `${t}T19:00:00`, topic: 'Дриблинг', goalkeepers: true, player_id: 'p2', full_name: 'Сидоров Ян', attended: false },
    ];
    fake.rpc.extra_roster_list = () => [];
    fake.rpc.ind_set_attended = () => null;
    render(<Sessions groups={groups} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Индивидуальные' }));
    fireEvent.click(await screen.findByText('Записано: 2'));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Посещаемость: Иванов Пётр' })).getByRole('button', { name: 'Был' }));
    fireEvent.click(screen.getByText('Сохранить отметки'));
    await waitFor(() => expect(fake.rpcCalls('ind_set_attended')).toEqual([{ s: 's1', p: 'p1', was: true }]));
  });

  it('если занятий на дату нет, говорит об этом', async () => {
    seed();
    fake.rpc.ind_roster_list = () => [];
    fake.rpc.extra_roster_list = () => [];
    render(<Sessions groups={groups} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Индивидуальные' }));
    expect(await screen.findByText('Индивидуальных занятий нет')).toBeInTheDocument();
  });

  it('сбой загрузки не выдаётся за «занятий нет»: показывает ошибку и повтор', async () => {
    seed();
    fake.rpc.ind_roster_list = () => ({ data: null, error: { message: 'boom' } });
    fake.rpc.extra_roster_list = () => [];
    render(<Sessions groups={groups} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Индивидуальные' }));
    expect(await screen.findByText('Не удалось загрузить занятия')).toBeInTheDocument();
    expect(screen.queryByText('Индивидуальных занятий нет')).toBeNull();
    fake.rpc.ind_roster_list = () => [];
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByText('Индивидуальных занятий нет')).toBeInTheDocument();
  });
});
