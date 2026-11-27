import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { StaffGames, StaffStats } from './TrainerStaff';

const period = { f: '2026-10-01', t: '2026-10-31' };
const game = { match_id: 'm1', played_on: '2026-10-03', team: 'U9', opponent: 'Динамо', goals_for: 2, goals_against: 1, staff: [{ coach: 'Павел', role: 'Тренер', reg: true }, { coach: 'Соприк', role: 'Оператор', reg: false }] };

describe('Штат матча и статистика тренеров', () => {
  it('админ видит штат и сохраняет изменённый', async () => {
    fake.db.training_log = [{ coach: 'Павел', held_on: '2026-10-01' }, { coach: 'Цотне', held_on: '2026-10-02' }];
    fake.rpc.match_staff_list = () => [game];
    fake.rpc.match_staff_set = () => null;
    render(<StaffGames period={period} admin />);
    const card = (await screen.findByText('03.10 · U9')).closest('.ks-card') as HTMLElement;
    expect(within(card).getByText('Павел (Тренер)')).toBeInTheDocument();
    expect(within(card).getByText('регламент не выполнен')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Изменить' }));
    fireEvent.change(within(card).getAllByLabelText('Сотрудник')[1], { target: { value: 'Цотне' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('match_staff_set')).toHaveLength(1));
    expect(fake.rpcCalls('match_staff_set')[0]).toEqual({ m: 'm1', staff: [{ coach: 'Павел', role: 'Тренер', reg: true }, { coach: 'Цотне', role: 'Оператор', reg: false }] });
  });

  it('тренеру правка недоступна', async () => {
    fake.rpc.match_staff_list = () => [game];
    render(<StaffGames period={period} admin={false} />);
    expect(await screen.findByText('Соприк (Оператор)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
  });

  it('статистика: тренировки, игры как тренер и оператор, процент регламента', async () => {
    fake.rpc.trainer_stats = () => [{ coach: 'Павел', trainings: 5, hours: 4.8, as_coach: 2, as_operator: 1, parts: 3, reg_pct: 67 }];
    render(<StaffStats period={period} />);
    expect(await screen.findByText('Павел')).toBeInTheDocument();
    expect(screen.getByText(/Тренировок: 5 \(4.8 ч\) · игр как тренер: 2 · как оператор: 1/)).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('тренер: часы не показываются', async () => {
    fake.rpc.trainer_stats = () => [{ coach: 'Павел', trainings: 5, hours: null, as_coach: 0, as_operator: 0, parts: 0, reg_pct: null }];
    render(<StaffStats period={period} />);
    expect(await screen.findByText('Тренировок: 5 · игр как тренер: 0 · как оператор: 0')).toBeInTheDocument();
  });

  it('тренер раскрывается в список проведённых тренировок по датам; часы только у администратора', async () => {
    fake.db.training_log = [
      { id: 't2', coach: 'Павел', held_on: '2026-10-05', group_label: 'U11', starts_at: '17:00', hours: 1.5, held: true },
      { id: 't1', coach: 'Павел', held_on: '2026-10-01', group_label: 'U10-A/B', starts_at: '17:00', hours: 1, held: true },
      { id: 't3', coach: 'Павел', held_on: '2026-10-02', group_label: 'U9', starts_at: '17:00', hours: 1, held: false },
      { id: 't4', coach: 'Павел', held_on: '2026-11-02', group_label: 'U7', starts_at: '17:00', hours: 1, held: true },
      { id: 't5', coach: 'Цотне', held_on: '2026-10-03', group_label: 'U7', starts_at: '17:00', hours: 1, held: true },
    ];
    fake.rpc.trainer_stats = () => [
      { coach: 'Павел', trainings: 2, hours: 2.5, as_coach: 0, as_operator: 0, parts: 0, reg_pct: null },
      { coach: 'Игры', trainings: 0, hours: 0, as_coach: 1, as_operator: 0, parts: 1, reg_pct: 100 },
    ];
    render(<StaffStats period={period} />);
    const row = (await screen.findByText('Павел')).closest('details') as HTMLElement;
    fireEvent.click(within(row).getByText('Павел'));
    expect(await within(row).findByText('01.10 · U10-A/B')).toBeInTheDocument();
    const items = within(row).getAllByRole('listitem').map(e => e.textContent);
    expect(items).toEqual(['01.10 · U10-A/B1 ч', '05.10 · U11' + '1,5 ч']);
    expect(screen.getByText('Игры').closest('details')).toBeNull(); // без проведённых тренировок раскрытия нет
  });

  it('тренер: список тренировок без часов', async () => {
    fake.db.training_log = [{ id: 't1', coach: 'Павел', held_on: '2026-10-01', group_label: 'U10-A/B', starts_at: '17:00', hours: 1, held: true }];
    fake.rpc.trainer_stats = () => [{ coach: 'Павел', trainings: 1, hours: null, as_coach: 0, as_operator: 0, parts: 0, reg_pct: null }];
    render(<StaffStats period={period} />);
    const row = (await screen.findByText('Павел')).closest('details') as HTMLElement;
    fireEvent.click(within(row).getByText('Павел'));
    expect(await within(row).findByText('01.10 · U10-A/B')).toBeInTheDocument();
    expect(within(row).queryByText(/ ч$/)).toBeNull();
  });

  it('смена периода при раскрытом тренере перечитывает список: только даты нового периода', async () => {
    fake.db.training_log = [
      { id: 'a', coach: 'Павел', held_on: '2026-10-05', group_label: 'U11', starts_at: '17:00', hours: 1, held: true },
      { id: 'b', coach: 'Павел', held_on: '2026-11-05', group_label: 'U9', starts_at: '17:00', hours: 1, held: true },
    ];
    fake.rpc.trainer_stats = () => [{ coach: 'Павел', trainings: 1, hours: 1, as_coach: 0, as_operator: 0, parts: 0, reg_pct: null }];
    const { rerender } = render(<StaffStats period={period} />);
    fireEvent.click(await screen.findByText('Павел'));
    expect(await screen.findByText('05.10 · U11')).toBeInTheDocument();
    rerender(<StaffStats period={{ f: '2026-11-01', t: '2026-11-30' }} />);
    expect(await screen.findByText('05.11 · U9')).toBeInTheDocument();
    expect(screen.queryByText('05.10 · U11')).toBeNull();
  });

  it('карточка тренера: длинный текст переносится внутри, у раскрытия есть aria-expanded, правый элемент не сжимается', async () => {
    fake.db.training_log = [{ id: 'a', coach: 'Павел', held_on: '2026-10-08', group_label: 'Группа Спартак-Юниор 2014 г.р. (первая команда)', starts_at: '17:00', hours: null, held: true }];
    fake.rpc.trainer_stats = () => [
      { coach: 'Павел', trainings: 1, hours: null, as_coach: 0, as_operator: 0, parts: 0, reg_pct: null },
      { coach: 'Без тренировок', trainings: 0, hours: null, as_coach: 0, as_operator: 0, parts: 0, reg_pct: null },
    ];
    render(<StaffStats period={period} />);
    const summary = (await screen.findByText('Павел')).closest('summary') as HTMLElement;
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    const li = (await screen.findByText(/Спартак-Юниор/)).closest('li') as HTMLElement;
    expect((li.firstElementChild as HTMLElement).style.minWidth).toBe('0'); // текст сжимается и переносится
    expect((li.firstElementChild as HTMLElement).style.overflowWrap).toBe('anywhere');
    const txt = screen.getByText('Без тренировок').parentElement as HTMLElement;
    expect(txt.style.minWidth).toBe('0');
    expect(txt.style.overflowWrap).toBe('anywhere');
    expect(screen.getByText('Без тренировок').closest('details')).toBeNull();
  });

  it('функция не установлена: понятное сообщение', async () => {
    fake.rpc.match_staff_list = () => ({ error: { message: 'Could not find the function public.match_staff_list' } });
    render(<StaffGames period={period} admin />);
    expect(await screen.findByText('Функция ещё не установлена в базе (миграция 0043).')).toBeInTheDocument();
  });
});
