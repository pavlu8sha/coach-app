import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import IndRegulars from './IndRegulars';

describe('Постоянные игроки: предупреждение о переполнении', () => {
  const tpl = { id: 't1', isodow: 6, start_time: '19:00:00', goalkeepers: false, active: true };
  it('если постоянных больше мест, под слотом показано предупреждение', async () => {
    fake.db.individual_templates = [tpl];
    fake.db.individual_slot_members = [];
    fake.rpc.ind_regulars_overflow = () => [{ template_id: 't1', regulars: 3, cap: 2 }];
    render(<IndRegulars />);
    expect(await screen.findByText(/Постоянных \(3\) больше мест \(2\)/)).toBeInTheDocument();
  });
  it('без функции в базе предупреждения нет, экран работает', async () => {
    fake.db.individual_templates = [tpl];
    fake.db.individual_slot_members = [];
    fake.rpc.ind_regulars_overflow = () => ({ error: { message: 'Could not find the function' } });
    render(<IndRegulars />);
    expect(await screen.findByText(/Постоянных на этот месяц нет/)).toBeInTheDocument();
    expect(screen.queryByText(/больше мест/)).toBeNull();
  });
});

describe('Постоянные игроки: окончание слота', () => {
  const tpl = { id: 't1', isodow: 6, start_time: '19:00:00', end_time: null, goalkeepers: false, active: true };
  it('окончание слота сохраняется в шаблон; раньше начала нельзя', async () => {
    fake.db.individual_templates = [tpl];
    fake.db.individual_slot_members = [];
    fake.rpc.ind_regulars_overflow = () => [];
    render(<IndRegulars />);
    const input = await screen.findByLabelText('Окончание слота');
    fireEvent.change(input, { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить окончание/ }));
    expect(await screen.findByText('Окончание должно быть позже начала.')).toBeInTheDocument();
    expect(fake.writes('individual_templates', 'update')).toEqual([]);
    fireEvent.change(input, { target: { value: '20:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить окончание/ }));
    await waitFor(() => expect(fake.writes('individual_templates', 'update')).toEqual([{ end_time: '20:00' }]));
    expect((await screen.findAllByText(/Суббота 19:00–20:00/)).length).toBeGreaterThan(0);
  });
});
