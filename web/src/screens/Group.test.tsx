import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Group, { competitionPlaces } from './Group';

const groups = [{ id: 'g1', name: 'U9' }];
function seed() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
  fake.db.points_ledger = [
    { id: 'l1', player_id: 'p1', points: 1, event_date: '2026-11-03', source_type: 'group_session', reason_code: 'attended', components: { class: 'regular', base: 1 }, status: 'active', created_at: '2026-11-03T10:00:00Z' },
    { id: 'l2', player_id: 'p1', points: 3, event_date: '2026-11-04', source_type: 'manual', reason_code: 'manual', components: { note: 'Отлично играл' }, status: 'active', created_at: '2026-11-04T10:00:00Z' },
  ];
  fake.rpc.group_parents = () => [{ player_id: 'p1', parent_name: 'Мама Пети', telegram_id: 4242 }];
  fake.rpc.points_manual_status = () => ({ active: true, remaining: { '1': 3, '2': 2, '3': 1 }, month_total: 3, month_cap: 10 });
  fake.rpc.points_manual_award = () => 'l9';
}
const open = async () => {
  render(<Group groups={groups} />);
  fireEvent.click(await screen.findByText('Иванов Пётр'));
  await screen.findByText('Ручные баллы');
};

describe('карточка игрока', () => {
  it('показывает сумму баллов и контакт родителя со ссылкой на Telegram', async () => {
    seed();
    await open();
    expect(screen.getByText(/Всего: 4 балла · начислений: 2/)).toBeInTheDocument();
    expect(await screen.findByText('Мама Пети')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Написать в Telegram' })).toHaveAttribute('href', 'tg://user?id=4242');
  });

  it('если функции контактов нет или нет прав, контакты не показываются', async () => {
    seed();
    fake.rpc.group_parents = () => ({ error: { message: 'forbidden' } });
    await open();
    expect(await screen.findByText('Контакты недоступны.')).toBeInTheDocument();
  });

  it('ручные баллы: без комментария нельзя, с комментарием уходит выбранное число', async () => {
    seed();
    await open();
    expect(screen.getByRole('button', { name: 'Начислить' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: '+3' }));
    fireEvent.change(screen.getByLabelText(/За что/), { target: { value: ' Отлично в защите ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    await waitFor(() => expect(fake.rpcCalls('points_manual_award')).toHaveLength(1));
    expect(fake.rpcCalls('points_manual_award')[0]).toMatchObject({ p: 'p1', pts: 3, note: ' Отлично в защите ' });
    expect(await screen.findByText('Баллы начислены.')).toBeInTheDocument();
  });

  it('ошибку функции показывает по-русски', async () => {
    seed();
    fake.rpc.points_manual_award = () => ({ error: { message: 'note required' } });
    await open();
    fireEvent.change(screen.getByLabelText(/За что/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    expect(await screen.findByText('Напишите, за что баллы.')).toBeInTheDocument();
  });
});

describe('ручные баллы по новым правилам', () => {
  const activate = () => {
    fake.rpc.points_manual_status = () => ({ active: true, remaining: { '1': 3, '2': 2, '3': 1 }, month_total: 0, month_cap: 10 });
    fake.db.points_ledger = [
      { id: 'l1', player_id: 'p1', source_type: 'manual', points: 1, event_date: '2026-12-02', status: 'active', cancel_reason: null, created_at: '2026-12-02T10:00:00Z', components: { note: 'Старание' } },
      { id: 'l2', player_id: 'p1', source_type: 'manual', points: 2, event_date: '2026-12-01', status: 'cancelled', cancel_reason: 'Ошибся', created_at: '2026-12-01T10:00:00Z', components: { note: 'Помощь' } },
    ];
  };

  it('пока правила не действуют, формы ручных баллов нет', async () => {
    seed();
    fake.rpc.points_manual_status = () => ({ active: false });
    render(<Group groups={groups} />);
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    expect(await screen.findByText('Ручные баллы доступны, когда действуют правила баллов.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начислить' })).toBeNull();
  });

  it('показывает +1/+2/+3 и остаток лимитов, начисляет с идентификатором заявки', async () => {
    seed();
    activate();
    fake.rpc.points_manual_award = () => 'l9';
    await open();
    expect(await screen.findByText(/Осталось в этом месяце: \+1 — 3, \+2 — 2, \+3 — 1/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '+5' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '+2' }));
    fireEvent.change(screen.getByLabelText(/За что/), { target: { value: 'Лидер' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    await waitFor(() => expect(fake.rpcCalls('points_manual_award')).toHaveLength(1));
    const a = fake.rpcCalls('points_manual_award')[0];
    expect(a).toMatchObject({ p: 'p1', pts: 2, note: 'Лидер' });
    expect(typeof a.req).toBe('string');
  });

  it('отмена требует причину и уходит в базу; отменённое показано с причиной', async () => {
    seed();
    activate();
    fake.rpc.points_manual_cancel = () => null;
    await open();
    expect(await screen.findByText(/отменено: Ошибся/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Отменить' })[0]);
    const confirm = await screen.findByRole('button', { name: 'Подтвердить отмену' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Не тот ребёнок' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fake.rpcCalls('points_manual_cancel')).toEqual([{ entry: 'l1', reason: 'Не тот ребёнок' }]));
  });

  it('ошибку лимита показывает по-русски', async () => {
    seed();
    activate();
    fake.rpc.points_manual_award = () => ({ error: { message: 'monthly limit reached for this value' } });
    await open();
    fireEvent.change(await screen.findByLabelText(/За что/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    expect(await screen.findByText(/уже использовано максимальное число раз/)).toBeInTheDocument();
  });
});

describe('рейтинг по группе', () => {
  it('старые баллы point_events в итогах не участвуют', async () => {
    seed();
    fake.db.point_events = [{ id: 'old', player_id: 'p1', points: 50, explanation: 'старое', occurred_on: '2026-10-01', source_type: 'coach' }];
    render(<Group groups={groups} />);
    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(screen.queryByText('54')).toBeNull();
  });

  it('игроки идут по убыванию баллов с местом и суммой', async () => {
    seed();
    fake.db.players = [
      { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
      { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
    ];
    fake.db.points_ledger.push({ id: 'l9', player_id: 'p2', points: 10, event_date: '2026-11-04', source_type: 'manual', reason_code: 'manual', components: {}, status: 'active', created_at: '2026-11-04T10:00:00Z' });
    render(<Group groups={groups} />);
    expect(await screen.findByText('Место 1 по баллам')).toBeInTheDocument();
    const names = screen.getAllByText(/Сидоров Ян|Иванов Пётр/).map(n => n.textContent);
    expect(names).toEqual(['Сидоров Ян', 'Иванов Пётр']);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('при равных баллах место одинаковое, следующее пропускается (1, 1, 1, 4)', async () => {
    expect(competitionPlaces([5, 5, 5, 4, 3, 3])).toEqual([1, 1, 1, 4, 5, 5]);
    seed();
    fake.db.players = ['A', 'B', 'C', 'D'].map((n, k) => ({ id: 'q' + k, full_name: n + ' Игрок', group_id: 'g1', status: 'active' }));
    fake.db.points_ledger = [5, 5, 5, 4].map((pt, k) => ({ id: 'z' + k, player_id: 'q' + k, points: pt, event_date: '2026-11-04', source_type: 'manual', reason_code: 'manual', components: {}, status: 'active', created_at: '2026-11-04T10:00:00Z' }));
    render(<Group groups={groups} />);
    expect(await screen.findAllByText('Место 1 по баллам')).toHaveLength(3);
    expect(screen.getByText('Место 4 по баллам')).toBeInTheDocument();
  });
});
