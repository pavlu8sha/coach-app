import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import FirstWave from './FirstWave';

const row = (over: object = {}) => ({ player_id: 'p1', name: 'Иванов Пётр', direction: 'ind_sat', parents: 2, enabled: 1, ...over });

describe('Первая волна', () => {
  it('показывает детей выбранного направления и число получающих родителей', async () => {
    fake.rpc.first_wave_list = () => [row(), row({ player_id: 'p2', name: 'Сидоров Ян', direction: 'goalkeeper' })];
    render(<FirstWave />);
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('Родителей: 2, получают: 1')).toBeInTheDocument();
    expect(screen.queryByText('Сидоров Ян')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Вратарская' }));
    expect(await screen.findByText('Сидоров Ян')).toBeInTheDocument();
  });

  it('отмечает ребёнка без действующего согласия родителей (#238)', async () => {
    fake.rpc.first_wave_list = () => [row({ parents: 0, enabled: 0, consent_missing: true }), row({ player_id: 'p2', name: 'Сидоров Ян' })];
    render(<FirstWave />);
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getAllByText('Нет действующего согласия')).toHaveLength(1);
    expect(screen.getByText('уведомления не уходят: у родителей нет действующего согласия')).toBeInTheDocument();
  });

  it('добавление ребёнка уходит в first_wave_add с выбранным направлением, удаление в first_wave_remove', async () => {
    fake.db.players = [{ id: 'p9', full_name: 'Кузнецов Лев', status: 'active' }];
    fake.rpc.first_wave_list = () => [row()];
    fake.rpc.first_wave_add = () => 1;
    fake.rpc.first_wave_remove = () => null;
    render(<FirstWave />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Воскресенье' }));
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Кузн' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить: Кузнецов Лев' }));
    await waitFor(() => expect(fake.rpcCalls('first_wave_add')).toEqual([{ dirs: ['ind_sun'], pls: ['p9'] }]));
    fireEvent.click(screen.getByRole('tab', { name: 'Суббота' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать: Иванов Пётр' }));
    await waitFor(() => expect(fake.rpcCalls('first_wave_remove')).toEqual([{ d: 'ind_sat', p: 'p1' }]));
  });

  it('предпросмотр рассылки: только счёт, без отправки', async () => {
    fake.rpc.first_wave_list = () => [row()];
    fake.rpc.first_wave_friday = () => [{ direction: 'ind_sat', recipients: 3, sent: false }, { direction: 'ind_sun', recipients: 0, sent: false }, { direction: 'goalkeeper', recipients: 1, sent: false }];
    render(<FirstWave />);
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть, кому уйдёт' }));
    expect(await screen.findByText('Суббота: родителей 3')).toBeInTheDocument();
    expect(fake.rpcCalls('first_wave_friday')).toEqual([{ dry: true }]);
  });

  it('импорт списком: найденные уходят в first_wave_add по направлениям, остальные только показаны', async () => {
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', status: 'active' }, { id: 'p2', full_name: 'Сидоров Ян', status: 'active' }];
    fake.rpc.first_wave_list = () => [];
    fake.rpc.first_wave_add = () => 1;
    render(<FirstWave />);
    fireEvent.change(await screen.findByLabelText('Список'), { target: { value: 'Иванов Пётр\nСидоров Ян;вратарская\nНеизвестный Игрок' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить список' }));
    expect(await screen.findByText('Найдено: 2, неоднозначно: 0, не найдено: 1.')).toBeInTheDocument();
    expect(screen.getByText(/Не найдены среди активных игроков: Неизвестный Игрок/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить найденных (2)' }));
    await waitFor(() => expect(fake.rpcCalls('first_wave_add')).toEqual([{ dirs: ['ind_sat'], pls: ['p1'] }, { dirs: ['goalkeeper'], pls: ['p2'] }]));
  });
});
