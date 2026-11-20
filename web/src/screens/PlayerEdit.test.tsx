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
    expect(fake.rpcCalls('player_save')).toEqual([expect.objectContaining({ p_id: 'p1', p_row: expect.objectContaining({ group_id: 'g2' }) })]);
    // абонемент и игрок меняются на сервере внутри player_save, клиент прямых записей не делает
    expect(fake.writes('players')).toEqual([]);
    expect(fake.writes('subscriptions')).toEqual([]);
  });
  it('без смены группы абонемент не трогаем', async () => {
    const onDone = open();
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр Иванович' } });
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Иванов' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.rpcCalls('player_save')).toEqual([expect.objectContaining({ p_row: expect.objectContaining({ group_id: 'g1' }) })]);
    expect(fake.writes('subscriptions')).toEqual([]);
  });
  it('если сервер отклонил сохранение (в том числе ошибка абонемента), показывается ошибка и форма остаётся', async () => {
    const onDone = open();
    fake.rpc.player_save = () => ({ error: { message: 'boom' } });
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Не удалось сохранить. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(screen.queryByText('boom')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    expect(fake.writes('players')).toEqual([]);
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
    expect(fake.rpcCalls('player_save')).toEqual([{
      p_id: 'p1',
      p_club: null,
      p_row: expect.objectContaining({ full_name: 'Иванов Пётр Иванович' }),
      p_profile: { first_name: 'Пётр Иванович', last_name: 'Иванов', primary_position: 'Нападающий', jersey_number: 10 },
    }]);
    expect(fake.writes('players')).toEqual([]);
    expect(fake.writes('player_profiles')).toEqual([]);
  });

  it('номер недоступен для некомандной группы', () => {
    open(vi.fn(), { ...initial, group_id: 'g3' });
    expect(screen.getByLabelText('Игровой номер')).toBeDisabled();
    expect(screen.getByText(/Номер доступен только для командной группы/)).toBeInTheDocument();
  });

  it('занятый номер показывается понятным сообщением', async () => {
    const onDone = open();
    fake.rpc.player_save = () => ({ error: { message: 'duplicate key value violates unique constraint "player_jersey_history_open_number"' } });
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
    expect(fake.rpcCalls('player_save')).toEqual([]);
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

  it('новый игрок создаётся одним вызовом player_save с клубом, без прямых записей', async () => {
    const onDone = open(vi.fn(), blank);
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Петров' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.rpcCalls('player_save')).toEqual([expect.objectContaining({ p_id: null, p_club: 'c1', p_row: expect.objectContaining({ full_name: 'Петров Пётр' }) })]);
    expect(fake.writes('players')).toEqual([]);
    expect(fake.writes('player_profiles')).toEqual([]);
  });

  it('конфликт номера при создании: ошибка, форма остаётся, повтор не создаёт второго игрока', async () => {
    const onDone = open(vi.fn(), blank);
    fake.rpc.player_save = () => ({ error: { message: 'duplicate key value violates unique constraint "player_jersey_history_open_number"' } });
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Петров' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByLabelText('Игровой номер'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Этот номер уже занят в команде в этом сезоне.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('player_save')).toHaveLength(2));
    expect(fake.rpcCalls('player_save').every(a => a.p_id === null)).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
  });

  // И3.10: известные ошибки переводятся, технический текст не показывается
  it.each([
    ['forbidden', 'Нет прав на сохранение.'],
    ['group belongs to another club', 'Группа не относится к клубу игрока.'],
    ['player not found', 'Игрок не найден. Обновите список.'],
    ['new row violates check constraint "player_profiles_check" SQLSTATE 23514', 'Не удалось сохранить. Попробуйте ещё раз.'],
  ])('ошибка сервера «%s» показывается понятным текстом', async (raw, shown) => {
    open();
    fake.rpc.player_save = () => ({ error: { message: raw } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(screen.queryByText(raw)).toBeNull();
  });
});

// И3.9: отклонённый Promise не оставляет форму заблокированной
describe('Данные ребёнка: сбой сети при сохранении', () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Петров' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByLabelText('Основная позиция'), { target: { value: 'Вратарь' } });
    fireEvent.change(screen.getByLabelText('Игровой номер'), { target: { value: '10' } });
  };
  const SAFE = 'Не удалось сохранить. Попробуйте ещё раз.';
  const expectRecovered = async (onDone: ReturnType<typeof vi.fn>) => {
    expect(await screen.findByText(SAFE)).toBeInTheDocument();
    expect(screen.queryByText(/network down/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled();
    expect(screen.getByLabelText('Фамилия')).toHaveValue('Петров');
    expect(screen.getByLabelText('Основная позиция')).toHaveValue('Вратарь');
    expect(screen.getByLabelText('Игровой номер')).toHaveValue(10);
    expect(onDone).not.toHaveBeenCalled();
  };
  const retry = async (onDone: ReturnType<typeof vi.fn>) => {
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  };

  it('отказ поиска тёзки', async () => {
    const onDone = open(vi.fn(), blank);
    fill();
    fake.rejects.players = 'network down';
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await expectRecovered(onDone);
    fake.rejects.players = '';
    delete fake.rejects.players;
    await retry(onDone);
    expect(fake.rpcCalls('player_save')).toHaveLength(1);
  });

  it('отказ проверки занятого номера', async () => {
    const onDone = open(vi.fn(), blank);
    fill();
    fake.rejects.player_jersey_history = 'network down';
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await expectRecovered(onDone);
    delete fake.rejects.player_jersey_history;
    await retry(onDone);
    expect(fake.rpcCalls('player_save')).toHaveLength(1);
  });

  it('отказ player_save', async () => {
    const onDone = open(vi.fn(), blank);
    fill();
    fake.rpc.player_save = () => Promise.reject(new Error('network down'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await expectRecovered(onDone);
    delete fake.rpc.player_save;
    await retry(onDone);
    expect(fake.rpcCalls('player_save')).toHaveLength(2);
  });
});
