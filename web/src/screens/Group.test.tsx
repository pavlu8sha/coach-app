import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Group from './Group';

const groups = [{ id: 'g1', name: 'U9' }];
function seed() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
  fake.db.point_events = [
    { id: 'e1', player_id: 'p1', points: 1, explanation: 'Пришёл на тренировку', occurred_on: '2026-10-19', source_type: 'session' },
    { id: 'e2', player_id: 'p1', points: 3, explanation: 'Отлично играл', occurred_on: '2026-10-20', source_type: 'coach' },
  ];
  fake.rpc.group_parents = () => [{ player_id: 'p1', parent_name: 'Мама Пети', telegram_id: 4242 }];
  fake.rpc.award_bonus = () => 'e3';
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
    expect(screen.getByText(/Всего: 4 балла/)).toBeInTheDocument();
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
    await waitFor(() => expect(fake.rpcCalls('award_bonus')).toEqual([{ p: 'p1', pts: 3, note: ' Отлично в защите ' }]));
    expect(await screen.findByText('Баллы начислены.')).toBeInTheDocument();
  });

  it('ошибку функции показывает по-русски', async () => {
    seed();
    fake.rpc.award_bonus = () => ({ error: { message: 'note required' } });
    await open();
    fireEvent.change(screen.getByLabelText(/За что/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    expect(await screen.findByText('Напишите, за что баллы.')).toBeInTheDocument();
  });

  it('отменить можно только ручное начисление, и только после подтверждения', async () => {
    seed();
    await open();
    const cancels = screen.getAllByRole('button', { name: 'Отменить' });
    expect(cancels).toHaveLength(1); // у автоначисления кнопки нет
    fireEvent.click(cancels[0]);
    expect(fake.rpcCalls('revoke_bonus')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить начисление' }));
    await waitFor(() => expect(fake.rpcCalls('revoke_bonus')).toEqual([{ e: 'e2' }]));
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

  it('пока правила не действуют, работает прежнее начисление', async () => {
    seed();
    fake.rpc.points_manual_status = () => ({ active: false });
    await open();
    expect(screen.getByRole('tab', { name: '+5' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/За что/), { target: { value: 'Тест' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    await waitFor(() => expect(fake.rpcCalls('award_bonus')).toHaveLength(1));
    expect(fake.rpcCalls('points_manual_award')).toHaveLength(0);
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
    expect(fake.rpcCalls('award_bonus')).toHaveLength(0);
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
  it('игроки идут по убыванию баллов с местом и суммой', async () => {
    seed();
    fake.db.players = [
      { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
      { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
    ];
    fake.db.point_events.push({ id: 'e9', player_id: 'p2', points: 10, explanation: 'x', occurred_on: '2026-10-21', source_type: 'coach' });
    render(<Group groups={groups} />);
    expect(await screen.findByText('Место 1 по баллам')).toBeInTheDocument();
    const names = screen.getAllByText(/Сидоров Ян|Иванов Пётр/).map(n => n.textContent);
    expect(names).toEqual(['Сидоров Ян', 'Иванов Пётр']);
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
