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

  it('функция не установлена: понятное сообщение', async () => {
    fake.rpc.match_staff_list = () => ({ error: { message: 'Could not find the function public.match_staff_list' } });
    render(<StaffGames period={period} admin />);
    expect(await screen.findByText('Функция ещё не установлена в базе (миграция 0043).')).toBeInTheDocument();
  });
});
