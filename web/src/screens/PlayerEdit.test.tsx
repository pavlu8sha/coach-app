import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { today } from '../lib/coach';
import { seasonStart } from '../lib/seasonStats';
import { fake } from '../test/fakeSupabase';
import PlayerEdit, { type PlayerForm } from './PlayerEdit';

const groups = [{ id: 'g1', name: 'U13-C' }, { id: 'g2', name: 'U13-B' }, { id: 'g3', name: 'Индивидуальные / вратарские' }];
const initial: PlayerForm = {
  id: 'p1', full_name: 'Иванов Пётр', first_name: null, last_name: null, primary_position: null,
  jersey_number: null, jersey_team: null, jersey_season_start: null, birth_date: null, group_id: 'g1', status: 'active',
};
const blank: PlayerForm = { full_name: '', first_name: null, last_name: null, primary_position: null, jersey_number: null, jersey_team: null, jersey_season_start: null, birth_date: null, group_id: 'g1', status: 'active' };
const open = (onDone = vi.fn(), init = initial) => {
  render(<PlayerEdit initial={init} groups={groups} clubId="c1" onDone={onDone} onCancel={() => {}} />);
  return onDone;
};

describe('Данные ребёнка: перевод в другую группу (#261)', () => {
  it('смена группы меняет группу и в абонементе текущего месяца', async () => {
    const onDone = open();
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.writes('players', 'update')).toEqual([expect.objectContaining({ group_id: 'g2' })]);
    expect(fake.writes('subscriptions', 'update')).toEqual([{ group_id: 'g2' }]);
  });
  it('без смены группы абонемент не трогаем', async () => {
    const onDone = open();
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр Иванович' } });
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Иванов' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.writes('subscriptions', 'update')).toEqual([]);
  });
  it('если абонемент обновить не удалось, показывается ошибка и форма остаётся', async () => {
    const onDone = open();
    fake.errors.subscriptions = 'boom';
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/обновить не удалось: boom/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('Данные ребёнка: заголовок экрана (#244)', () => {
  it('заголовок экрана — h1', () => {
    open();
    expect(screen.getByRole('heading', { level: 1, name: 'Данные ребёнка' })).toBeInTheDocument();
  });
});

describe('Профиль игрока: имя, позиция и номер (#654)', () => {
  it('старая запись без отдельных имени и фамилии показывает сохранённое полное имя', () => {
    open();
    expect(screen.getByLabelText('Сохранённое полное имя')).toHaveValue('Иванов Пётр');
  });

  it('сохраняет имя, фамилию, позицию и номер; full_name собирается как «Фамилия Имя»', async () => {
    const onDone = open();
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр Иванович' } });
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Иванов' } });
    fireEvent.change(screen.getByLabelText('Основная позиция'), { target: { value: 'Нападающий' } });
    fireEvent.change(screen.getByLabelText('Игровой номер'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.writes('players', 'update')).toEqual([expect.objectContaining({ full_name: 'Иванов Пётр Иванович' })]);
    expect(fake.writes('player_profiles', 'upsert')).toEqual([expect.objectContaining({
      player_id: 'p1', first_name: 'Пётр Иванович', last_name: 'Иванов', primary_position: 'Нападающий', jersey_number: 10,
    })]);
  });

  it('номер недоступен для некомандной группы', () => {
    open(vi.fn(), { ...initial, group_id: 'g3' });
    expect(screen.getByLabelText('Игровой номер')).toBeDisabled();
    expect(screen.getByText(/Номер доступен только для командной группы/)).toBeInTheDocument();
  });

  it('занятый номер показывается понятным сообщением', async () => {
    const onDone = open();
    fake.errors.player_profiles = 'duplicate key value violates unique constraint "player_jersey_history_open_number"';
    fireEvent.change(screen.getByLabelText('Игровой номер'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Этот номер уже занят в команде в этом сезоне.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('занятый номер не создаёт нового игрока', async () => {
    fake.db.player_jersey_history = [{ player_id: 'other', team: 'U13-B/C', season_start: seasonStart(today()), number: 10, valid_to: null }];
    const onDone = open(vi.fn(), blank);
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Петров' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByLabelText('Игровой номер'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Этот номер уже занят в команде в этом сезоне.')).toBeInTheDocument();
    expect(fake.writes('players', 'insert')).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('история изменений только для чтения', async () => {
    fake.db.player_profile_history = [{ player_id: 'p1', field: 'primary_position', old_value: null, new_value: 'Нападающий', changed_at: '2026-11-16T10:00:00Z' }];
    fake.db.player_jersey_history = [{ player_id: 'p1', number: 10, team: 'U13-B/C', season_start: '2026-09-01', valid_from: '2026-11-16T10:00:00Z', valid_to: null }];
    open();
    fireEvent.click(await screen.findByText('История изменений'));
    expect(screen.getByText('Позиция: — → Нападающий')).toBeInTheDocument();
    expect(screen.getByText(/Номер 10: U13-B\/C, сезон с 01.09.2026 — действует/)).toBeInTheDocument();
  });

  it('новый игрок: после вставки профиль пишется к созданному id', async () => {
    const onDone = open(vi.fn(), blank);
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Петров' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.writes('players', 'insert')).toEqual([expect.objectContaining({ full_name: 'Петров Пётр' })]);
    const created = fake.db.players.at(-1) as { id: string };
    expect(fake.writes('player_profiles', 'upsert')).toEqual([expect.objectContaining({ player_id: created.id })]);
  });
});
