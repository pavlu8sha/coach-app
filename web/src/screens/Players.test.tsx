import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import Players from './Players';

// дата фиксирована: статус считается за месяц с учётом 22-го числа (docs/PLAYERS_PAY_STATUS_ACCEPTANCE.md)
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 10, 15, 12, 0, 0));
const month = today().slice(0, 7) + '-01';
function seed() {
  fake.db.groups = [{ id: 'g1', name: 'U10-B', club_id: 'c1' }, { id: 'g2', name: 'U7-A', club_id: 'c1' }];
  fake.db.players = [
    { id: 'p1', full_name: 'Amodeo Nolan', group_id: 'g1', birth_date: '2016-09-05', status: 'active', external_id: 'KS-0002' },
    { id: 'p2', full_name: 'Andreev Boris', group_id: 'g2', birth_date: '2020-02-15', status: 'active', external_id: 'KS-0004' },
    { id: 'p3', full_name: 'Старый Игрок', group_id: 'g2', birth_date: null, status: 'inactive', external_id: 'KS-0009' },
  ];
  fake.db.prices = [{ group_id: null, amount: 165, valid_from: '2026-01-01', valid_to: null, kind: 'subscription' }];
  fake.db.payments = [{ player_id: 'p1', amount: 165, paid_on: month }];
  fake.db.subscriptions = [];
}

const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Фильтры/ }));

describe('«Игроки»', () => {
  beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });

  it('показывает игроков со статусом оплаты за месяц; неактивных по умолчанию нет', async () => {
    seed();
    render(<Players />);
    expect(await screen.findByText('Amodeo Nolan')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText('Не платил')).toBeInTheDocument();
    expect(screen.queryByText('Старый Игрок')).not.toBeInTheDocument();
  });

  it('без фильтра группы показаны все игроки, а не первые 80', async () => {
    seed();
    for (let i = 0; i < 100; i++) fake.db.players.push({ id: `x${i}`, full_name: `Игрок ${i}`, group_id: 'g1', birth_date: null, status: 'active', external_id: `KS-9${i}` });
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    expect(screen.getByText('101 игр.')).toBeInTheDocument();
  });

  it('игрок индивидуальных и вратарских без абонемента: не должник', async () => {
    seed();
    fake.db.groups.push({ id: 'g3', name: 'Индивидуальные / вратарские', club_id: 'c1' });
    fake.db.players.push({ id: 'p4', full_name: 'Только Индивидуальные', group_id: 'g3', birth_date: null, status: 'active', external_id: 'KS-0100' });
    render(<Players />);
    await screen.findByText('Только Индивидуальные');
    expect(screen.getByText('Без абонемента')).toBeInTheDocument();
    expect(screen.getAllByText('Не платил')).toHaveLength(1);
  });

  it('ищет по ID и фильтрует по году рождения', async () => {
    seed();
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    fireEvent.change(screen.getByLabelText('Поиск игроков'), { target: { value: 'KS-0004' } });
    expect(screen.queryByText('Amodeo Nolan')).not.toBeInTheDocument();
    expect(screen.getByText('Andreev Boris')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Поиск игроков'), { target: { value: '' } });
    openFilters();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2016' }));
    expect(screen.getByText('Amodeo Nolan')).toBeInTheDocument();
    expect(screen.queryByText('Andreev Boris')).not.toBeInTheDocument();
  });

  it('«Только не оплатившие» оставляет должников', async () => {
    seed();
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    fireEvent.click(screen.getByRole('button', { name: 'Не оплатили' }));
    expect(screen.queryByText('Amodeo Nolan')).not.toBeInTheDocument();
    expect(screen.getByText('Andreev Boris')).toBeInTheDocument();
  });

  it('фильтр статуса показывает неактивных', async () => {
    seed();
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    openFilters();
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Статус'), { target: { value: 'inactive' } });
    const row = screen.getByText('Старый Игрок').closest('button')!;
    expect(within(row).getByText('Ушёл')).toBeInTheDocument();
  });

  it('нажатие на игрока открывает карточку с абонементом по месяцам', async () => {
    seed();
    render(<Players />);
    fireEvent.click((await screen.findByText('Amodeo Nolan')).closest('button')!);
    expect(await screen.findByText('Абонемент')).toBeInTheDocument();
    expect(screen.getByText('Изменить данные')).toBeInTheDocument();
    expect(screen.getAllByText('Внести платёж').length).toBeGreaterThan(0);
    expect(screen.getByText(/KS-0002/)).toBeInTheDocument();
  });

  describe('окно «Фильтры» и пилюли', () => {
    it('«+ Добавить» в шапке открывает форму нового игрока', async () => {
      seed();
      render(<Players />);
      await screen.findByText('Amodeo Nolan');
      fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
      expect(await screen.findByText('Новый ребёнок')).toBeInTheDocument();
    });

    it('на странице нет селектов и чипов годов; есть «Фильтры» и «Не оплатили»', async () => {
      seed();
      render(<Players />);
      await screen.findByText('Amodeo Nolan');
      expect(screen.queryByLabelText('Группа')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Статус')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '2016' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Фильтры' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Не оплатили' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('button', { name: /^Убрать/ })).not.toBeInTheDocument();
    });

    it('выбор в окне сразу меняет список, считает «Фильтры · N» и даёт пилюли с «✕»', async () => {
      seed();
      render(<Players />);
      await screen.findByText('Amodeo Nolan');
      openFilters();
      const dlg = screen.getByRole('dialog');
      expect(within(dlg).getByRole('button', { name: 'Показать 2' })).toBeInTheDocument();
      fireEvent.click(within(dlg).getByRole('button', { name: '2016' }));
      fireEvent.change(within(dlg).getByLabelText('Группа'), { target: { value: 'g1' } });
      expect(within(dlg).getByRole('button', { name: 'Показать 1' })).toBeInTheDocument();
      expect(screen.queryByText('Andreev Boris')).not.toBeInTheDocument();
      fireEvent.click(within(dlg).getByRole('button', { name: 'Показать 1' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Фильтры · 2' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Убрать 2016' }));
      expect(screen.getByRole('button', { name: 'Фильтры · 1' })).toBeInTheDocument();
      expect(screen.getByText('Amodeo Nolan')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Убрать U10-B' }));
      expect(screen.getByText('Andreev Boris')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Убрать/ })).not.toBeInTheDocument();
    });

    it('статус не по умолчанию даёт пилюлю; «Сбросить» возвращает значения по умолчанию', async () => {
      seed();
      render(<Players />);
      await screen.findByText('Amodeo Nolan');
      openFilters();
      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Статус'), { target: { value: 'inactive' } });
      expect(screen.getByRole('button', { name: 'Убрать Ушли' })).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сбросить' }));
      expect(screen.queryByRole('button', { name: /^Убрать/ })).not.toBeInTheDocument();
      expect(screen.getByText('Amodeo Nolan')).toBeInTheDocument();
    });

    it('«Сбросить» не трогает «Не оплатили»; Esc закрывает окно', async () => {
      seed();
      render(<Players />);
      await screen.findByText('Amodeo Nolan');
      fireEvent.click(screen.getByRole('button', { name: 'Не оплатили' }));
      expect(screen.getByRole('button', { name: 'Не оплатили' })).toHaveAttribute('aria-pressed', 'true');
      openFilters();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сбросить' }));
      expect(screen.getByRole('button', { name: 'Не оплатили' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('выбор в окне не уводит фокус с выбранного элемента', async () => {
      seed();
      render(<Players />);
      await screen.findByText('Amodeo Nolan');
      openFilters();
      const dlg = screen.getByRole('dialog');
      const chip = within(dlg).getByRole('button', { name: '2016' });
      chip.focus();
      fireEvent.click(chip);
      expect(document.activeElement).toBe(chip);
      const sel = within(dlg).getByLabelText('Группа');
      sel.focus();
      fireEvent.change(sel, { target: { value: 'g1' } });
      expect(document.activeElement).toBe(sel);
    });

    it('Tab и Shift+Tab не выходят из окна; после закрытия фокус возвращается на «Фильтры»', async () => {
      seed();
      render(<Players />);
      await screen.findByText('Amodeo Nolan');
      const opener = screen.getByRole('button', { name: 'Фильтры' });
      opener.focus();
      fireEvent.click(opener);
      const dlg = screen.getByRole('dialog');
      const show = within(dlg).getByRole('button', { name: /^Показать/ });
      const reset = within(dlg).getByRole('button', { name: 'Сбросить' });
      expect(document.activeElement).toBe(show);
      expect(fireEvent.keyDown(show, { key: 'Tab' })).toBe(false); // последний элемент: уходит на первый
      expect(document.activeElement).toBe(reset);
      expect(fireEvent.keyDown(reset, { key: 'Tab', shiftKey: true })).toBe(false); // первый: уходит на последний
      expect(document.activeElement).toBe(show);
      fireEvent.click(show);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(opener);
      opener.focus();
      fireEvent.click(opener);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(document.activeElement).toBe(opener);
    });
  });
});

// Условия приёмки: docs/PLAYERS_PAY_STATUS_ACCEPTANCE.md
describe('«Игроки»: месяц статуса с 22-го и «За визит»', () => {
  beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); vi.setSystemTime(new Date(2026, 10, 15, 12, 0, 0)); });
  const at = (d: number) => vi.setSystemTime(new Date(2026, 10, d, 12, 0, 0));

  it('до 22-го статус за ноябрь, с 22-го за декабрь (платёж за декабрь считается)', async () => {
    seed();
    at(21);
    const { unmount } = render(<Players />);
    await screen.findByText('Amodeo Nolan');
    expect(screen.getByText('Статус оплаты за 11.26')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    unmount();
    at(22);
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    expect(screen.getByText('Статус оплаты за 12.26')).toBeInTheDocument();
    expect(screen.queryByText('Оплачено')).not.toBeInTheDocument();
    expect(screen.getAllByText('Не платил')).toHaveLength(2);
  });

  it('платёж за декабрь с 22-го даёт «Оплачено»', async () => {
    seed();
    fake.db.payments = [{ player_id: 'p1', amount: 165, paid_on: '2026-11-25', for_month: '2026-12-01' }];
    at(22);
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
  });

  it('порог из настройки клуба: при 25 на 22-е месяц ещё ноябрь', async () => {
    seed();
    fake.db.club_settings = [{ club_id: 'c1', key: 'payments.nextMonthDay', scope: null, value: '25' }];
    fake.db.clubs = [{ id: 'c1' }];
    at(22);
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    expect(screen.getByText('Статус оплаты за 11.26')).toBeInTheDocument();
  });

  it('игрок «за визит» в месяце периода: «За визит», не «Не платил», и не в «Не оплатили»', async () => {
    seed();
    fake.db.players[1] = { ...fake.db.players[1], pay_mode: 'per_visit', pay_mode_from: '2026-11-01', pay_mode_until: null };
    render(<Players />);
    await screen.findByText('Andreev Boris');
    expect(screen.getByText('За визит')).toBeInTheDocument();
    expect(screen.queryByText('Не платил')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Не оплатили/ }));
    expect(screen.queryByText('Andreev Boris')).not.toBeInTheDocument();
  });

  it('вернулся на абонемент с 01.12: ноябрь «За визит», с 22-го декабрь обычный статус', async () => {
    seed();
    fake.db.players[1] = { ...fake.db.players[1], pay_mode: 'subscription', pay_mode_from: '2026-11-01', pay_mode_until: '2026-12-01' };
    const { unmount } = render(<Players />);
    await screen.findByText('Andreev Boris');
    expect(screen.getByText('За визит')).toBeInTheDocument();
    unmount();
    at(22);
    render(<Players />);
    await screen.findByText('Andreev Boris');
    expect(screen.queryByText('За визит')).not.toBeInTheDocument();
    expect(screen.getAllByText('Не платил')).toHaveLength(2);
  });

  it('до миграции 0229 (нет колонки pay_mode_until) экран работает по прежним правилам', async () => {
    seed();
    fake.errorsNext.players = 'column players.pay_mode_until does not exist';
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    expect(screen.getByText('Не платил')).toBeInTheDocument();
  });

  it('настоящий сбой чтения игроков показывает ошибку, а не «Не платил»', async () => {
    seed();
    fake.errors.players = 'connection lost';
    render(<Players />);
    expect(await screen.findByText('Не удалось загрузить игроков')).toBeInTheDocument();
    expect(screen.queryByText('Не платил')).not.toBeInTheDocument();
  });
});
