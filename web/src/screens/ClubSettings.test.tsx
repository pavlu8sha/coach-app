import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import ClubSettings from './ClubSettings';

beforeEach(() => {
  fake.reset();
  fake.db.clubs = [{ id: 'c1' }];
  fake.db.club_settings = [{ club_id: 'c1', key: 'stats.low_pct', scope: '', value: '40' }];
});

const card = (title: RegExp) => screen.getByText(title).closest('.ks-card') as HTMLElement;

describe('Настройки клуба (#339)', () => {
  it('показывает сохранённое значение и значения по умолчанию', async () => {
    render(<ClubSettings />);
    const low = await screen.findByText(/Порог низкой посещаемости/);
    expect(within(low.closest('.ks-card') as HTMLElement).getByRole('textbox')).toHaveValue('40');
    expect(within(card(/С какого числа/)).getByRole('textbox')).toHaveValue('');
    expect(within(card(/С какого числа/)).getByText('По умолчанию: 22')).toBeInTheDocument();
  });

  it('сохраняет число в club_settings', async () => {
    render(<ClubSettings />);
    await screen.findByText(/С какого числа/);
    const c = card(/С какого числа/);
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: '25' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.writes('club_settings', 'upsert')).toEqual([
      { club_id: 'c1', key: 'payments.next_month_day', scope: '', value: '25', updated_at: expect.any(String) },
    ]));
  });

  it('не пускает значение вне допустимых границ', async () => {
    render(<ClubSettings />);
    await screen.findByText(/С какого числа/);
    const c = card(/С какого числа/);
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: '40' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Сохранить' }));
    expect(await within(c).findByText('Не больше 31.')).toBeInTheDocument();
    expect(fake.writes('club_settings', 'upsert')).toHaveLength(0);
  });

  it('«По умолчанию» удаляет запись', async () => {
    render(<ClubSettings />);
    await screen.findByText(/Порог низкой посещаемости/);
    fireEvent.click(within(card(/Порог низкой посещаемости/)).getByRole('button', { name: 'По умолчанию' }));
    await waitFor(() => expect(fake.db.club_settings).toEqual([]));
  });
});
