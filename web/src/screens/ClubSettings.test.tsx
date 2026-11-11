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

  it('длительность матча: общая и свои значения команд (область = команда)', async () => {
    fake.db.club_settings = [
      { club_id: 'c1', key: 'matches.durationMin', scope: '', value: '100' },
      { club_id: 'c1', key: 'matches.durationMin', scope: 'U8', value: '50' },
    ];
    render(<ClubSettings />);
    await screen.findByText(/Длительность матча, минут — общая/);
    expect(within(card(/Длительность матча, минут — общая/)).getByRole('textbox')).toHaveValue('100');
    expect(within(card(/^U8$/)).getByRole('textbox')).toHaveValue('50');
    fireEvent.change(screen.getByLabelText('Команда (длительность матча)'), { target: { value: 'U14' } });
    fireEvent.change(screen.getByLabelText('Длительность, минут'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить длительность' }));
    await waitFor(() => expect(fake.writes('club_settings', 'upsert')).toEqual([
      { club_id: 'c1', key: 'matches.durationMin', scope: 'U14', value: '120', updated_at: expect.any(String) },
    ]));
  });

  it('длительность матча команды: дробное и слишком маленькое значение не сохраняются', async () => {
    fake.db.club_settings = [];
    render(<ClubSettings />);
    await screen.findByText(/Длительность матча, минут — общая/);
    fireEvent.change(screen.getByLabelText('Команда (длительность матча)'), { target: { value: 'U14' } });
    fireEvent.change(screen.getByLabelText('Длительность, минут'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить длительность' }));
    expect(await screen.findByText('Не меньше 10.')).toBeInTheDocument();
    expect(fake.writes('club_settings', 'upsert')).toEqual([]);
  });

  it('длительность матча: общее значение сохраняется, 601 и дробное не принимаются', async () => {
    render(<ClubSettings />);
    await screen.findByText(/Длительность матча, минут — общая/);
    const c = card(/Длительность матча, минут — общая/);
    expect(within(c).getByRole('textbox')).toHaveValue('90');
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: '601' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Сохранить' }));
    expect(await within(c).findByText('Не больше 600.')).toBeInTheDocument();
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: '75,5' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Сохранить' }));
    expect(await within(c).findByText('Нужно целое число.')).toBeInTheDocument();
    expect(fake.writes('club_settings', 'upsert')).toEqual([]);
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: '75' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.writes('club_settings', 'upsert')).toEqual([
      { club_id: 'c1', key: 'matches.durationMin', scope: '', value: '75', updated_at: expect.any(String) },
    ]));
  });

  it('длительность матча: «К общему» убирает значение только этой команды', async () => {
    fake.db.club_settings = [
      { club_id: 'c1', key: 'matches.durationMin', scope: 'U8', value: '50' },
      { club_id: 'c1', key: 'matches.champFee', scope: 'U8', value: '150' },
    ];
    render(<ClubSettings />);
    await screen.findByText(/Своя длительность матча у команд/);
    // карточки U8 две: взнос за чемпионат (первая) и длительность (вторая, под заголовком «Своя длительность…»)
    const c = screen.getAllByText(/^U8$/)[1].closest('.ks-card') as HTMLElement;
    expect(within(c).getByRole('textbox')).toHaveValue('50');
    fireEvent.click(within(c).getByRole('button', { name: 'К общему' }));
    await waitFor(() => expect(fake.db.club_settings).toEqual([
      { club_id: 'c1', key: 'matches.champFee', scope: 'U8', value: '150' },
    ]));
  });
});
