import { render, screen } from '@testing-library/react';
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
