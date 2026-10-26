import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import MenuSettings from './MenuSettings';

beforeEach(() => {
  fake.db.clubs = [{ id: 'c1' }];
  fake.db.club_settings = [];
});

describe('«Ещё → Меню»', () => {
  it('меняет порядок и состав панели и сохраняет настройку', async () => {
    const changed = vi.fn();
    render(<MenuSettings onChanged={changed} />);
    fireEvent.click(await screen.findByLabelText('Выше: Оплаты'));
    fireEvent.click(screen.getByLabelText('В «Ещё»: Матчи'));
    fireEvent.click(screen.getByLabelText('На панель: Запросы'));
    fireEvent.click(screen.getByText('Сохранить меню'));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const [w] = fake.writes('club_settings', 'upsert') as { key: string; value: string }[];
    expect(w.key).toBe('admin_menu');
    expect(JSON.parse(w.value)).toEqual({ bar: ['sessions', 'money', 'players', 'requests'] });
  });

  it('больше четырёх разделов на панель не пускает', async () => {
    render(<MenuSettings onChanged={() => {}} />);
    expect(await screen.findByLabelText('На панель: Запросы')).toBeDisabled();
  });
});
