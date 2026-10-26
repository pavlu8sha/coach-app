import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isoDow, today } from '../lib/coach';
import { fake } from '../test/fakeSupabase';
import TrainerLog from './TrainerLog';

function seed(logs: Record<string, unknown>[] = []) {
  fake.db.weekly_schedule = [
    { weekday: isoDow(today()), starts_at: '17:00:00', ends_at: '18:30:00', location: 'Зал', coaches: 'Павел, Соприк', kind: 'Групповая', source_key: `${isoDow(today())}|17:00|U9` },
    { weekday: isoDow(today()), starts_at: '17:00:00', ends_at: '18:30:00', location: 'Зал', coaches: 'Павел, Соприк', kind: 'Групповая', source_key: `${isoDow(today())}|17:00|U9` }, // дубль строки группы в отметках
  ];
  fake.db.training_log = logs;
}
const row = (id: string, coach: string, held = true) => ({ id, held_on: today(), coach, location: 'Зал', group_label: 'U9', kind: 'Групповая', starts_at: '17:00:00', ends_at: '18:30:00', hours: 1.5, held });

describe('«Учёт тренеров»', () => {
  it('план из расписания показывается один раз; «Проведена» подтверждает с тренерами по плану', async () => {
    seed();
    fake.rpc.tl_confirm = () => 2;
    render(<TrainerLog />);
    expect(await screen.findByText('U9 · 17:00–18:30')).toBeInTheDocument();
    expect(screen.getAllByText(/U9 · 17:00/)).toHaveLength(1);
    expect(screen.getByText(/по плану: Павел, Соприк/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Проведена' }));
    await waitFor(() => expect(fake.rpcCalls('tl_confirm')).toHaveLength(1));
    expect(fake.rpcCalls('tl_confirm')[0]).toMatchObject({ d: today(), label: 'U9', kind: 'Групповая', st: '17:00', en: '18:30', coaches: ['Павел', 'Соприк'] });
  });

  it('проведённая тренировка: тренеры и часы, замена и добавление', async () => {
    seed([row('l1', 'Павел')]);
    fake.rpc.tl_replace_coach = () => null;
    fake.rpc.tl_add = () => 'x';
    render(<TrainerLog />);
    const card = (await screen.findByText('U9 · 17:00–18:30')).closest('.ks-card') as HTMLElement;
    expect(within(card).getByText('Проведена')).toBeInTheDocument();
    expect(within(card).getByText('Павел · 1.5 ч')).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText('Заменить тренера Павел'), { target: { value: 'Соприк' } });
    await waitFor(() => expect(fake.rpcCalls('tl_replace_coach')).toEqual([{ i: 'l1', new_coach: 'Соприк' }]));
    fireEvent.change(within(card).getByLabelText('Добавить тренера'), { target: { value: 'Соприк' } });
    await waitFor(() => expect(fake.rpcCalls('tl_add')).toHaveLength(1));
    expect(fake.rpcCalls('tl_add')[0]).toMatchObject({ d: today(), coach: 'Соприк', label: 'U9' });
  });

  it('до подтверждения правка времени, места и тренеров уходит в «Проведена»', async () => {
    seed();
    fake.rpc.tl_confirm = () => 1;
    render(<TrainerLog />);
    fireEvent.click(await screen.findByRole('button', { name: /Изменить время, место, тренеров/ }));
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Конец'), { target: { value: '19:30' } });
    fireEvent.change(screen.getByLabelText('Место'), { target: { value: 'Стадион' } });
    fireEvent.click(screen.getByRole('button', { name: 'Соприк' })); // снять Соприка из плана
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('U9 · 18:00–19:30')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Проведена' }));
    await waitFor(() => expect(fake.rpcCalls('tl_confirm')).toHaveLength(1));
    expect(fake.rpcCalls('tl_confirm')[0]).toMatchObject({ st: '18:00', en: '19:30', loc: 'Стадион', coaches: ['Павел'] });
  });

  it('у проведённой тренировки время и место меняются в базе', async () => {
    seed([row('l1', 'Павел'), row('l2', 'Соприк')]);
    fake.rpc.tl_edit_session = () => 2;
    render(<TrainerLog />);
    fireEvent.click(await screen.findByRole('button', { name: /Изменить время, место/ }));
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '18:30' } });
    fireEvent.change(screen.getByLabelText('Конец'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByLabelText('Место'), { target: { value: 'Другой зал' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('tl_edit_session')).toHaveLength(1));
    expect(fake.rpcCalls('tl_edit_session')[0]).toMatchObject({ d: today(), label: 'U9', old_st: '17:00', new_st: '18:30', new_loc: 'Другой зал' });
  });

  it('будущую тренировку подтвердить нельзя — понятное сообщение', async () => {
    seed();
    fake.rpc.tl_confirm = () => ({ error: { message: 'date in the future' } });
    render(<TrainerLog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Проведена' }));
    expect(await screen.findByText('Тренировку, которая ещё не прошла, подтвердить нельзя.')).toBeInTheDocument();
  });

  it('месяц: часы и число тренировок по тренерам', async () => {
    seed([row('l1', 'Павел'), { ...row('l2', 'Павел'), hours: 1 }, row('l3', 'Соприк')]);
    render(<TrainerLog />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Месяц' }));
    const pavel = (await screen.findByText('Павел', { selector: 'b' })).closest('.ks-card') as HTMLElement;
    expect(within(pavel).getByText('2.5 ч')).toBeInTheDocument();
    expect(within(pavel).getByText('Тренировок: 2')).toBeInTheDocument();
  });
});
