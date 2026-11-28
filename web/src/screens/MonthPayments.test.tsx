import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEBT_START } from '../lib/debtSeason';
import { fake } from '../test/fakeSupabase';
import { failNth } from '../test/failNth';
import MonthPayments, { inMonth, tariffFor } from './MonthPayments';

// Дата зафиксирована: с 22-го числа экран открывается на следующем месяце, и тесты не должны зависеть от дня запуска.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
afterEach(() => vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0)));

const monthIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const seed = () => {
  fake.db.groups = [{ id: 'g1', name: 'U9' }];
  fake.db.prices = [
    { group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null },
    { group_id: 'g2', kind: 'subscription', amount: 130, valid_from: '2026-09-01', valid_to: null },
  ];
  fake.db.players = [
    { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
    { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
    { id: 'p3', full_name: 'Со Скидкой', group_id: 'g1', status: 'active' },
  ];
  fake.db.payments = [
    { player_id: 'p1', amount: 100, paid_on: monthIso() },
    { player_id: 'p3', amount: 50, paid_on: monthIso() },
  ];
  fake.db.subscriptions = [{ player_id: 'p3', month: monthIso(), discount: true, written_off: false }];
};

describe('tariffFor', () => {
  const prices = [
    { group_id: null, amount: 165, valid_from: '2026-09-01', valid_to: null },
    { group_id: 'g2', amount: 130, valid_from: '2026-09-01', valid_to: null },
    { group_id: null, amount: 170, valid_from: '2026-12-01', valid_to: null },
  ];
  it('своя цена группы важнее общей, будущая цена действует с своего месяца', () => {
    expect(tariffFor(prices, 'g1', '2026-10-01')).toBe(165);
    expect(tariffFor(prices, 'g2', '2026-10-01')).toBe(130);
    expect(tariffFor(prices, 'g1', '2026-12-01')).toBe(170);
    expect(tariffFor(prices, 'g1', '2026-08-01')).toBeNull();
  });
});

describe('inMonth: кто в списке месяца', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('прошедший месяц: только с абонементом или платежом, пришедший позже не должник', () => {
    expect(inMonth(all, '2026-09-01', '2026-11-01', new Set(['a']), new Set(['b'])).map(p => p.id)).toEqual(['a', 'b']);
  });
  it('текущий и будущий месяц: все активные', () => {
    expect(inMonth(all, '2026-11-01', '2026-11-01', new Set(['a']), new Set()).map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(inMonth(all, '2026-12-01', '2026-11-01', new Set(), new Set()).map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('прошедший месяц без данных вовсе: показываем всех', () => {
    expect(inMonth(all, '2026-09-01', '2026-11-01', new Set(), new Set())).toHaveLength(3);
  });
});

describe('«Оплаты за месяц»', () => {
  it('показывает кто сколько внёс, скидку и итог группы', async () => {
    seed();
    render(<MonthPayments />);
    expect(await screen.findByText('100 ₾ из 165 ₾')).toBeInTheDocument();
    expect(screen.getByText('0 ₾ из 165 ₾')).toBeInTheDocument();
    expect(screen.getByText(/^Скидка · внесено 50 ₾$/)).toBeInTheDocument();
    expect(screen.getAllByText('1 из 3')).toHaveLength(2); // плитка «Оплатили» и заголовок группы
    expect(screen.getByText(/внесено 150 ₾ из 495 ₾/)).toBeInTheDocument(); // итог группы
  });

  it('имя и плашка суммы стоят в одной строке без переноса плашки вниз (длинное имя переносится внутри себя)', async () => {
    seed();
    fake.db.players = [{ id: 'p1', full_name: 'Imanuel Charles McLure', group_id: 'g1', status: 'active' }];
    fake.db.payments = [{ player_id: 'p1', amount: 165, paid_on: monthIso() }];
    fake.db.subscriptions = [];
    render(<MonthPayments />);
    const pill = await screen.findByText('165 ₾ из 165 ₾');
    const line = pill.closest('.ks-line');
    expect(line).toHaveClass('pin-end');
    expect(line?.lastElementChild).toBe(pill);
    expect(line?.firstElementChild).toHaveTextContent('Imanuel Charles McLure');
  });

  it('нижняя граница списка месяцев — DEBT_START', async () => {
    seed();
    render(<MonthPayments />);
    const select = await screen.findByRole('combobox', { name: 'Месяц' });
    const values = within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value);
    expect(values).toContain(DEBT_START);
    expect(values).not.toContain('2026-08-01');
  });

  it('деньги ушедшего игрока остаются в итоге месяца, а должником он не становится', async () => {
    seed();
    fake.db.players = [...fake.db.players, { id: 'p9', full_name: 'Ушедший Лёва', group_id: 'g1', status: 'inactive' }, { id: 'p8', full_name: 'Ушедший Без Денег', group_id: 'g1', status: 'inactive' }];
    fake.db.payments = [...fake.db.payments, { player_id: 'p9', amount: 165, paid_on: monthIso() }];
    render(<MonthPayments />);
    expect(await screen.findByText('Ушедший Лёва')).toBeInTheDocument();
    expect(screen.queryByText('Ушедший Без Денег')).toBeNull();
    expect(screen.getByText(/внесено 315 ₾ из 660 ₾/)).toBeInTheDocument(); // 100 + 50 + 165 при четырёх в группе
  });

  it('списки групп свёрнуты по умолчанию, поиск раскрывает их', async () => {
    seed();
    const { container } = render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    const groups = () => [...container.querySelectorAll('details.ks-group')] as HTMLDetailsElement[];
    expect(groups().length).toBeGreaterThan(0);
    expect(groups().every(d => !d.open)).toBe(true);
    fireEvent.change(screen.getByLabelText('Поиск по ФИ'), { target: { value: 'сидор' } });
    expect(groups().every(d => d.open)).toBe(true);
    fireEvent.change(screen.getByLabelText('Поиск по ФИ'), { target: { value: '' } });
    expect(groups().every(d => !d.open)).toBe(true);
  });

  it('«Только должники» прячет оплативших, поиск ищет по фамилии', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    fireEvent.click(screen.getByRole('switch', { name: 'Только должники' }));
    expect(screen.queryByText('Скидка')).toBeNull();
    fireEvent.change(screen.getByLabelText('Поиск по ФИ'), { target: { value: 'сидор' } });
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
  });

  it('«Закрыть без оплаты» есть у всех неоплативших, в том числе с нулём, и пишет вид и причину', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    const btns = screen.getAllByRole('button', { name: 'Закрыть без оплаты' });
    expect(btns).toHaveLength(2); // Иванов: внесено 100 из 165 и игрок с нулём
    fireEvent.click(btns[0]);
    const dlg = within(await screen.findByRole('dialog'));
    fireEvent.change(dlg.getByLabelText(/Вид закрытия/), { target: { value: 'paid_elsewhere' } });
    fireEvent.change(dlg.getByLabelText(/Причина/), { target: { value: 'отдал тренеру наличными' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Закрыть без оплаты' }));
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toEqual([{ player_id: 'p1', month: monthIso(), discount: true, written_off: false, closed_kind: 'paid_elsewhere', closed_reason: 'отдал тренеру наличными' }]));
  });

  it('быстрый платёж: сумма по умолчанию — остаток, запись в журнал', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    fireEvent.click(screen.getAllByRole('button', { name: 'Внести платёж' })[0]); // Иванов: внесено 100
    expect(screen.getByLabelText(/Сумма/)).toHaveValue('65');
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.paymentAdds()).toHaveLength(1));
    expect(fake.paymentAdds()[0]).toMatchObject({ player_id: 'p1', amount: 65, method: 'Наличные' });
  });

  it('нулевая сумма и будущая дата отклоняются без записи', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    fireEvent.click(screen.getAllByRole('button', { name: 'Внести платёж' })[0]);
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText('Введите сумму (не ноль).')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2999-01-05' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText(/Дата платежа не может быть в будущем/)).toBeInTheDocument();
    expect(fake.paymentAdds()).toHaveLength(0);
  });
});

describe('«Оплаты за месяц»: когда предлагать следующий месяц (#339)', () => {
  const opened = async () => {
    seed();
    fake.db.clubs = [{ id: 'c1' }];
    render(<MonthPayments />);
    await screen.findByRole('combobox', { name: 'Месяц' });
  };

  it('до 22-го открыт текущий месяц', async () => {
    fake.db.club_settings = [];
    await opened();
    await new Promise(r => setTimeout(r, 30));
    expect((screen.getByRole('combobox', { name: 'Месяц' }) as HTMLSelectElement).value).toBe('2026-10-01');
  });

  it('с 22-го по умолчанию предлагается следующий месяц', async () => {
    vi.setSystemTime(new Date(2026, 9, 22, 12, 0, 0));
    fake.db.club_settings = [];
    await opened();
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Месяц' }) as HTMLSelectElement).value).toBe('2026-11-01'));
  });

  it('число берётся из настроек клуба', async () => {
    vi.setSystemTime(new Date(2026, 9, 22, 12, 0, 0));
    fake.db.club_settings = [{ club_id: 'c1', key: 'payments.nextMonthDay', scope: '', value: '25' }];
    await opened();
    await new Promise(r => setTimeout(r, 30));
    expect((screen.getByRole('combobox', { name: 'Месяц' }) as HTMLSelectElement).value).toBe('2026-10-01');
  });

  it('неверное число показывает предупреждение и оставляет текущий месяц', async () => {
    fake.db.club_settings = [{ club_id: 'c1', key: 'payments.nextMonthDay', scope: '', value: '40' }];
    await opened();
    expect(await screen.findByText(/недопустима: Не больше 31\./)).toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: 'Месяц' }) as HTMLSelectElement).value).toBe('2026-10-01');
  });
});

describe('закрытие без оплаты показывает вид и причину', () => {
  it('в строке подпись вида и причина вместо «Скидка»', async () => {
    seed();
    fake.db.subscriptions = [{ player_id: 'p1', month: monthIso(), discount: true, written_off: false, closed_kind: 'paid_elsewhere', closed_reason: 'отдал тренеру' }];
    render(<MonthPayments />);
    expect(await screen.findByText(/Оплачено вне приложения/)).toBeInTheDocument();
    expect(screen.getByText('Причина: отдал тренеру')).toBeInTheDocument();
  });

  it('заглушка «до 02.11.2026» из миграции 0100 не показывается', async () => {
    seed();
    fake.db.subscriptions = [{ player_id: 'p1', month: monthIso(), discount: true, written_off: false, closed_kind: 'discount', closed_reason: 'до 02.11.2026' }];
    render(<MonthPayments />);
    expect(await screen.findByText(/Скидка/)).toBeInTheDocument();
    expect(screen.queryByText(/до 02\.11\.2026/)).not.toBeInTheDocument();
  });
});

// Условия приёмки: docs/PAY_PER_VISIT_ACCEPTANCE.md, п. 14
describe('«Оплаты за месяц»: игрок «Платит за визит»', () => {
  it('в месяцах с месяца начала в списке абонементов не показывается; с платежом за месяц остаётся', async () => {
    seed();
    fake.db.players = [
      { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active', pay_mode: 'per_visit', pay_mode_from: monthIso() },
      { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
      { id: 'p3', full_name: 'Со Скидкой', group_id: 'g1', status: 'active', pay_mode: 'per_visit', pay_mode_from: monthIso() },
    ];
    fake.db.payments = [{ player_id: 'p3', amount: 50, paid_on: monthIso() }];
    render(<MonthPayments />);
    expect(await screen.findByText('Сидоров Ян')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).toBeNull(); // за визит, платежей за месяц нет
    expect(screen.getByText('Со Скидкой')).toBeInTheDocument(); // за визит, но за месяц есть платёж: деньги не прячем
  });
});

// #701: сбой чтения pay_mode не равен «игроков за визит нет»
describe('«Оплаты за месяц»: сбой чтения режима оплаты (#701)', () => {
  const TEXT = 'Не удалось загрузить данные, необходимые для расчёта задолженности. Сумма долга временно недоступна.';
  const tile = (name: string) => screen.getByText(name).closest('.ks-tile') as HTMLElement;
  it('сбой: суммы долга «Не рассчитано», внесённые деньги и список остаются, экран не заменён ошибкой', async () => {
    seed();
    const f = failNth('players', 2); // 1-й запрос — список игроков, 2-й — игроки «за визит»
    render(<MonthPayments />);
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить оплаты')).not.toBeInTheDocument();
    expect(within(tile('Ожидается по тарифам')).getByText('Не рассчитано')).toBeInTheDocument();
    expect(within(tile('Должников')).getByText('Не рассчитано')).toBeInTheDocument();
    expect(within(tile('Оплатили')).getByText('Не рассчитано')).toBeInTheDocument();
    expect(within(tile('Внесено')).getByText(/150/)).toBeInTheDocument();
    f.restore();
  });
  it('при сбое строки видны, но абонементный платёж и «Закрыть без оплаты» недоступны; после повтора возвращаются', async () => {
    seed();
    const f = failNth('players', 2);
    render(<MonthPayments />);
    await screen.findByText(TEXT);
    fireEvent.click(await screen.findByText('Иванов Пётр').then(el => el.closest('details')!.querySelector('summary')!));
    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Внести платёж' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Закрыть без оплаты' })).toBeNull();
    f.restore();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Внести платёж' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Закрыть без оплаты' }).length).toBeGreaterThan(0);
  });
  it('«Повторить загрузку»: после успеха расчёт восстановлен, платежей не создано', async () => {
    seed();
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active', pay_mode: 'per_visit', pay_mode_from: monthIso() }, ...((fake.db.players as any[]).slice(1))];
    fake.db.payments = [];
    const f = failNth('players', 2);
    render(<MonthPayments />);
    await screen.findByText(TEXT);
    f.restore();
    const before = fake.db.payments.length;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
    expect(screen.queryByText('Иванов Пётр')).toBeNull(); // «за визит», платежей нет: не в списке абонементов
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
    expect(fake.db.payments.length).toBe(before);
  });
});
