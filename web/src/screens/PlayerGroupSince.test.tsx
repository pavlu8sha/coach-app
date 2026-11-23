import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PlayerEdit, { type PlayerForm } from './PlayerEdit';

// Условия: docs/acceptance/group-since-2026-11-21.md, П1-П5.
const groups = [{ id: 'g1', name: 'U9-B' }, { id: 'g2', name: 'Индивидуальные / Вратарские' }];
const initial: PlayerForm = { id: 'p1', full_name: 'Синтетик Игрок', first_name: null, last_name: null, primary_position: null, jersey_number: null, jersey_team: null, jersey_season_start: null, birth_date: null, group_id: 'g1', status: 'active' };
const hist = [
  { player_id: 'p1', group_id: 'g1', valid_from: '2026-11-21', valid_to: null },
  { player_id: 'p1', group_id: 'g2', valid_from: '1970-01-01', valid_to: '2026-11-21' },
];
const open = (init = initial) => render(<PlayerEdit initial={init} groups={groups} clubId="c1" onDone={vi.fn()} onCancel={() => {}} />);
const preview = { from: '2026-11-21', to: '2026-11-01', prev_group_id: 'g2', group_id: 'g1', ledger_rows: 2, manual_rows: 1, changed: 0 };
const setDate = (v: string) => fireEvent.change(screen.getByLabelText('Перенести начало на более раннюю дату'), { target: { value: v } });

describe('Перенос начала группы (0219)', () => {
  beforeEach(() => { fake.db.player_group_history = hist; });

  it('П1: у игрока с предыдущей группой виден блок с границами', async () => {
    open();
    expect(await screen.findByText('В группе U9-B с 21.11.2026')).toBeInTheDocument();
    const input = screen.getByLabelText('Перенести начало на более раннюю дату') as HTMLInputElement;
    expect(input.min).toBe('1970-01-02');
    expect(input.max).toBe('2026-11-21');
  });
  it('П1: у игрока без предыдущей группы блока нет', async () => {
    fake.db.player_group_history = [{ player_id: 'p1', group_id: 'g1', valid_from: '1970-01-01', valid_to: null }];
    open();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument());
    expect(screen.queryByText(/Перенести начало/)).toBeNull();
  });
  it('П1: у нового игрока блока нет', () => {
    open({ ...initial, id: undefined });
    expect(screen.queryByText(/Перенести начало/)).toBeNull();
  });
  it('П2: «Перенести» есть только после предпросмотра этой даты; предпросмотр ничего не меняет', async () => {
    fake.rpc.player_group_since = () => preview;
    open();
    await screen.findByText('В группе U9-B с 21.11.2026');
    expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull();
    setDate('2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: 'Показать, что изменится' }));
    expect(await screen.findByText(/Пересчитается начислений: 2\. Ручных начислений, которые останутся в прежней группе: 1\./)).toBeInTheDocument();
    expect(fake.rpcCalls('player_group_since')).toEqual([{ p: 'p1', d: '2026-11-01', apply: false }]);
    setDate('2026-11-02');
    expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull();
  });
  it('П3: «Перенести» вызывает функцию с apply = true и показывает «Готово»', async () => {
    fake.rpc.player_group_since = (a: { apply: boolean }) => ({ ...preview, changed: a.apply ? 2 : 0 });
    open();
    await screen.findByText('В группе U9-B с 21.11.2026');
    setDate('2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: 'Показать, что изменится' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Перенести' }));
    expect(await screen.findByText(/Готово/)).toBeInTheDocument();
    expect(fake.rpcCalls('player_group_since')).toEqual([{ p: 'p1', d: '2026-11-01', apply: false }, { p: 'p1', d: '2026-11-01', apply: true }]);
  });
  it('П3: сбой применения показывает понятный текст, кнопка не зависает', async () => {
    fake.rpc.player_group_since = (a: { apply: boolean }) => (a.apply ? { error: { message: 'boom secret', code: 'XX000' } } : preview);
    open();
    await screen.findByText('В группе U9-B с 21.11.2026');
    setDate('2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: 'Показать, что изменится' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(document.querySelector('p.error')).not.toBeNull());
    expect(screen.queryByText(/boom secret/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Перенести' })).not.toBeDisabled();
  });
  it('П4: если функции в базе нет, блок скрывается', async () => {
    fake.rpc.player_group_since = () => ({ error: { message: 'Could not find the function public.player_group_since(d, p) in the schema cache', code: 'PGRST202' } });
    open();
    await screen.findByText('В группе U9-B с 21.11.2026');
    setDate('2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: 'Показать, что изменится' }));
    await waitFor(() => expect(screen.queryByText(/Перенести начало/)).toBeNull());
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });
  it('П5: сбой чтения истории скрывает блок и не мешает сохранению', async () => {
    fake.rejects.player_group_history = 'network';
    const onDone = vi.fn();
    render(<PlayerEdit initial={initial} groups={groups} clubId="c1" onDone={onDone} onCancel={() => {}} />);
    await waitFor(() => expect(screen.queryByText(/Перенести начало/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
