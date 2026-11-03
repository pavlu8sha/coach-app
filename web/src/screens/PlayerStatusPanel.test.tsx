import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PlayerStatusPanel from './PlayerStatusPanel';

describe('статус игрока в карточке', () => {
  it('пауза с датой возвращения уходит в базу, статус обновляется', async () => {
    fake.db.player_status_log = [];
    fake.rpc.player_set_status = () => null;
    const onChanged = vi.fn();
    render(<PlayerStatusPanel playerId="p1" status="active" externalId="KS-001" onChanged={onChanged} />);
    expect(screen.getByText('Занимается')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Поставить на паузу' }));
    fireEvent.change(screen.getByLabelText('Пауза с'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('Вернётся (необязательно)'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Комментарий (необязательно)'), { target: { value: 'болеет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('player_set_status')).toEqual([{ p: 'p1', s: 'paused', d: '2026-11-02', until: '2026-12-01', note: 'болеет' }]));
    expect(onChanged).toHaveBeenCalledWith('paused');
  });

  it('дата возвращения раньше начала паузы отклоняется до обращения к базе', async () => {
    fake.db.player_status_log = [];
    fake.rpc.player_set_status = () => null;
    render(<PlayerStatusPanel playerId="p1" status="active" externalId="KS-001" onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поставить на паузу' }));
    fireEvent.change(screen.getByLabelText('Пауза с'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Вернётся (необязательно)'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Дата возвращения раньше даты начала паузы.')).toBeInTheDocument();
    expect(fake.rpcCalls('player_set_status')).toHaveLength(0);
  });

  it('игрок на паузе: срок из журнала, можно вернуть в группу или отметить уход', async () => {
    fake.db.player_status_log = [{ player_id: 'p1', status: 'paused', on_date: '2026-11-02', until_on: '2026-12-01', comment: 'болеет', created_at: '2026-11-02T10:00:00Z' }];
    fake.rpc.player_set_status = () => null;
    render(<PlayerStatusPanel playerId="p1" status="paused" externalId="KS-001" onChanged={() => {}} />);
    expect(screen.getByText('Пауза')).toBeInTheDocument();
    expect(await screen.findByText('с 02.11.2026, вернётся 01.12.2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Игрок ушёл' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Поставить на паузу' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в группу' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('player_set_status')).toHaveLength(1));
    expect(fake.rpcCalls('player_set_status')[0]).toMatchObject({ p: 'p1', s: 'active', until: null, note: null });
  });

  it('ушедшему доступно только возвращение, гостю кнопок нет', () => {
    fake.db.player_status_log = [];
    const { unmount } = render(<PlayerStatusPanel playerId="p1" status="inactive" externalId="KS-001" onChanged={() => {}} />);
    expect(screen.getByText('Ушёл')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуть в группу' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Игрок ушёл' })).not.toBeInTheDocument();
    unmount();
    render(<PlayerStatusPanel playerId="p9" status="inactive" externalId="GUEST-12" onChanged={() => {}} />);
    expect(screen.getByText('Гость')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('даты из старого приложения показываются, пока журнал пуст', async () => {
    fake.db.player_status_log = [];
    fake.db.players = [{ id: 'p1', starts_on: '2025-09-01', ends_on: '2026-05-20' }];
    render(<PlayerStatusPanel playerId="p1" status="inactive" externalId="KS-001" onChanged={() => {}} />);
    expect(await screen.findByText(/занимался с 01\.09\.2025, ушёл 20\.05\.2026/)).toBeInTheDocument();
  });

  it('дата начала 01.09.2026 (по умолчанию в старой таблице) и начало позже ухода не показываются', async () => {
    fake.db.player_status_log = [];
    fake.db.players = [{ id: 'p1', starts_on: '2026-09-01', ends_on: '2026-07-31' }];
    render(<PlayerStatusPanel playerId="p1" status="inactive" externalId="KS-001" onChanged={() => {}} />);
    expect(await screen.findByText('ушёл 31.07.2026')).toBeInTheDocument();
    expect(screen.queryByText(/занимался с/)).not.toBeInTheDocument();
  });

  it('ошибка базы показывается по-русски, форма остаётся открытой', async () => {
    fake.db.player_status_log = [];
    fake.rpc.player_set_status = () => ({ error: { message: 'invalid return date' } });
    render(<PlayerStatusPanel playerId="p1" status="active" externalId="KS-001" onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Игрок ушёл' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Неверная дата возвращения: она нужна только для паузы и не раньше её начала.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });
});
