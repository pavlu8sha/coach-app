import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import ClubSettings from './ClubSettings';

beforeEach(() => {
  fake.reset();
  fake.db.clubs = [{ id: 'c1' }];
  fake.db.club_settings = [{ club_id: 'c1', key: 'stats.lowPct', scope: '', value: '40' }];
});

const card = (title: RegExp) => screen.getByText(title).closest('.ks-card') as HTMLElement;

describe('Настройки клуба (#339)', () => {
  it('показывает сохранённое значение и значения по умолчанию', async () => {
    render(<ClubSettings />);
    const low = await screen.findByText(/Порог низкой посещаемости/);
    expect(within(low.closest('.ks-card') as HTMLElement).getByRole('textbox')).toHaveValue('40');
    // без своей записи в поле стоит действующее значение по умолчанию, кнопки сброса нет
    expect(within(card(/С какого числа/)).getByRole('textbox')).toHaveValue('22');
    expect(within(card(/С какого числа/)).getByText('по умолчанию')).toBeInTheDocument();
    expect(within(card(/С какого числа/)).queryByRole('button', { name: 'По умолчанию' })).toBeNull();
    expect(within(card(/Порог низкой посещаемости/)).getByText('своё')).toBeInTheDocument();
    expect(within(card(/Порог низкой посещаемости/)).getByText('По умолчанию: 50')).toBeInTheDocument();
    expect(within(card(/Мест на индивидуальном занятии/)).getByRole('textbox')).toHaveValue('6');
    expect(within(card(/Мест на вратарском занятии/)).getByRole('textbox')).toHaveValue('7');
  });

  it('показывает предупреждение о сохранённом значении вне границ', async () => {
    fake.db.club_settings = [{ club_id: 'c1', key: 'payments.nextMonthDay', scope: '', value: '40' }];
    render(<ClubSettings />);
    expect(await screen.findByText('Сохранённое значение недопустимо: Не больше 31.')).toBeInTheDocument();
    expect(within(card(/С какого числа/)).getByRole('textbox')).toHaveValue('40');
  });

  it('сохраняет число в club_settings', async () => {
    render(<ClubSettings />);
    await screen.findByText(/С какого числа/);
    const c = card(/С какого числа/);
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: '25' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.writes('club_settings', 'upsert')).toEqual([
      { club_id: 'c1', key: 'payments.nextMonthDay', scope: '', value: '25', updated_at: expect.any(String) },
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

  it('пустое поле убирает запись и возвращает значение по умолчанию', async () => {
    fake.db.club_settings = [{ club_id: 'c1', key: 'ind.capIndividual', scope: '', value: '6' }];
    render(<ClubSettings />);
    await screen.findByText(/Мест на индивидуальном занятии/);
    const c = card(/Мест на индивидуальном занятии/);
    expect(within(c).getByRole('textbox')).toHaveValue('6');
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.db.club_settings).toEqual([]));
  });

  it('взнос за чемпионат: общий и свои значения команд (область = команда)', async () => {
    fake.db.club_settings = [
      { club_id: 'c1', key: 'matches.champFee', scope: '', value: '200' },
      { club_id: 'c1', key: 'matches.champFee', scope: 'U13-A', value: '300' },
    ];
    render(<ClubSettings />);
    await screen.findByText(/Взнос за чемпионат, ₾ — общий/);
    expect(within(card(/Взнос за чемпионат, ₾ — общий/)).getByRole('textbox')).toHaveValue('200');
    expect(within(card(/^U13-A$/)).getByRole('textbox')).toHaveValue('300');
    fireEvent.change(screen.getByLabelText('Команда'), { target: { value: 'U9' } });
    fireEvent.change(screen.getByLabelText('Взнос, ₾'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fake.writes('club_settings', 'upsert')).toEqual([
      { club_id: 'c1', key: 'matches.champFee', scope: 'U9', value: '150', updated_at: expect.any(String) },
    ]));
  });
});
