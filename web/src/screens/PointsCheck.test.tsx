import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PointsCheck from './PointsCheck';

const report = (over = {}) => ({ fix: false, checked: 12, changes: 0, drift: [], exceptions: [], ...over });

beforeEach(() => fake.reset());

describe('Сверка баллов (#18, этап 11)', () => {
  it('показывает, что расхождений нет', async () => {
    fake.rpc.points_consistency = () => ({ data: report() });
    render(<PointsCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(await screen.findByText('Расхождений нет')).toBeInTheDocument();
    expect(fake.rpcCalls('points_consistency')).toEqual([{ fix: false }]);
  });

  it('показывает расхождения и исключения, исправление требует подтверждения', async () => {
    fake.rpc.points_consistency = (a: { fix: boolean }) => ({ data: a.fix ? report({ fix: true, changes: 1 }) : report({ changes: 1, drift: [{ source_type: 'group_session', source_id: 's1', changes: 1 }], exceptions: [{ kind: 'match_without_score', source_id: 'm1', event_date: '2026-12-05' }] }) });
    render(<PointsCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(await screen.findByText('Расхождений: 1')).toBeInTheDocument();
    expect(screen.getByText('Групповое занятие: изменений 1')).toBeInTheDocument();
    expect(screen.getByText(/Матч без счёта/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Исправить журнал' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Исправить' }));
    await waitFor(() => expect(screen.getByText('Исправлено записей: 1. Проверено источников: 12.')).toBeInTheDocument());
    expect(fake.rpcCalls('points_consistency')).toEqual([{ fix: false }, { fix: true }]);
  });

  it('объясняет, если нет прав', async () => {
    fake.rpc.points_consistency = () => ({ error: { message: 'forbidden' } });
    render(<PointsCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(await screen.findByText(/только администратору/)).toBeInTheDocument();
  });
});
