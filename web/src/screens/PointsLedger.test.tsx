import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PointsLedger from './PointsLedger';

const seed = () => {
  fake.db.points_ledger = [
    { id: 'a', player_id: 'p1', status: 'active', event_date: '2026-12-10', points: 5, source_type: 'match', reason_code: 'match', components: { result: 'win', base: 2, goals: 3, best: 2, before_cap: 7, cap: 5 } },
    { id: 'b', player_id: 'p1', status: 'active', event_date: '2026-12-03', points: 1, source_type: 'group_session', reason_code: 'attended', components: { class: 'regular' } },
    { id: 'c', player_id: 'p1', status: 'active', event_date: '2026-11-28', points: 2, source_type: 'manual', reason_code: 'manual', components: { note: 'Старание' } },
    { id: 'd', player_id: 'p1', status: 'cancelled', event_date: '2026-12-05', points: 3, source_type: 'manual', reason_code: 'manual', components: { note: 'Ошибка' } },
    { id: 'e', player_id: 'p2', status: 'active', event_date: '2026-12-05', points: 9, source_type: 'extra', reason_code: 'attended', components: {} },
  ];
  fake.rpc.points_series_info = () => ({ current: 4, record: 6, current_from: '2026-12-03', last_break: null, next_threshold: '6', next_bonus: '1', remaining: 2, finished_runs: [{ length: 6, from: '2026-11-01', to: '2026-11-20' }] });
};

describe('баллы по новым правилам', () => {
  it('без начислений в новом журнале блока нет', async () => {
    fake.db.points_ledger = [];
    const { container } = render(<PointsLedger playerId="p1" />);
    await new Promise(r => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('последний месяц: итог, всего накоплено, пояснения; отменённых и чужих нет', async () => {
    seed();
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText('Декабрь 2026')).toBeInTheDocument();
    expect(screen.getByText(/За месяц:/).textContent).toContain('6');
    expect(screen.getByText(/Всего накоплено: 8/)).toBeInTheDocument();
    expect(screen.getByText('Матч — победа')).toBeInTheDocument();
    expect(screen.getByText(/ограничено максимумом 5 за матч/)).toBeInTheDocument();
    expect(screen.queryByText(/Ошибка/)).toBeNull();
  });

  it('переключение на прошлый месяц показывает его начисления', async () => {
    seed();
    render(<PointsLedger playerId="p1" />);
    await screen.findByText('Декабрь 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(await screen.findByText('Ноябрь 2026')).toBeInTheDocument();
    expect(screen.getByText('От тренера: Старание')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled();
  });

  it('серия: прогресс до бонуса, рекорд и завершённые серии', async () => {
    seed();
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText(/До бонуса за 6 тренировок \(\+1\) осталось 2/)).toBeInTheDocument();
    expect(screen.getByText('Личный рекорд: 6 подряд')).toBeInTheDocument();
    expect(screen.getByText('6 подряд')).toBeInTheDocument();
  });

  it('прерванная серия показана нейтрально, с датой', async () => {
    seed();
    fake.rpc.points_series_info = () => ({ current: 0, record: 6, current_from: null, last_break: '2026-12-12', next_threshold: '6', next_bonus: '1', remaining: 6, finished_runs: [] });
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText(/Серия прервана после пропуска тренировки 12\.12\.2026/)).toBeInTheDocument();
  });
});
