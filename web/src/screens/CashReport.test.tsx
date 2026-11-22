import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { today } from '../lib/coach';
import { fake } from '../test/fakeSupabase';
import CashReport from './CashReport';

const report = {
  total: 245,
  by_method: [{ method: 'Наличные', sum: 30 }, { method: 'Перевод', sum: 165 }, { method: 'не указан', sum: 50 }],
  by_staff: [{ staff_id: 'a1', name: 'Гил', sum: -100 }, { staff_id: 'a2', name: 'Дима', sum: 245 }, { staff_id: null, name: 'не указан', sum: 100 }],
  rows: [{ id: 'r1', kind: 'Абонемент', player: 'Аня', amount: 165, paid_on: today(), method: 'Перевод', staff: 'Дима', recorded_at: null, location: 'Исани' }],
};

describe('Кассовый отчёт', () => {
  beforeEach(() => fake.reset());

  it('запрашивает отчёт за сегодня и показывает итоги по способам и сотрудникам', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await waitFor(() => expect(fake.rpcCalls('cash_report')).toHaveLength(1));
    expect(fake.rpcCalls('cash_report')[0]).toMatchObject({ p_from: today(), p_to: today(), p_location: null, p_method: null });
    await screen.findByText('По сотрудникам');
    expect(screen.getByText('Дима')).toBeInTheDocument();
    // «не указан» есть и в итогах по сотрудникам, и в итогах по способам
    expect(screen.getAllByText('не указан').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Наличные').length).toBeGreaterThan(0);
  });

  it('позволяет выбрать конкретный день', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.click(screen.getByRole('tab', { name: 'День' }));
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-15' } });
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_from: '2026-10-15', p_to: '2026-10-15' }));
  });

  it('передаёт фильтры локации и способа в функцию базы', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.change(screen.getByLabelText('Локация'), { target: { value: 'Isani' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Перевод' }));
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: 'Isani', p_method: 'Перевод' }));
  });

  it('L1/L2: список локаций из справочника филиалов, без запросов к таблицам; выбор передаёт точное значение, «Все локации» — null', async () => {
    fake.db.groups = [{ location: 'Исани' }, { location: '35-я школа' }];
    fake.db.camps = [{ location: 'Surami' }];
    fake.db.extra_sessions = [{ place: 'Surami Hotel' }];
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    const sel = screen.getByLabelText('Локация') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    expect(Array.from(sel.options).map(o => o.textContent)).toEqual(['Все локации', 'Red Garden', 'Isani', 'Ortachala']);
    expect(fake.calls.filter(c => ['groups', 'camps', 'equipment_orders', 'extra_sessions'].includes(c.name))).toEqual([]);
    fireEvent.change(sel, { target: { value: 'Ortachala' } });
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: 'Ortachala' }));
    fireEvent.change(sel, { target: { value: '' } });
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: null }));
  });

  it('L7: операция с разовой площадкой видна при «Все локации», хотя в списке её нет', async () => {
    fake.rpc.cash_report = () => ({ data: { ...report, rows: [{ ...report.rows[0], location: '35-я школа' }] }, error: null });
    render(<CashReport />);
    expect(await screen.findByText(/35-я школа/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '35-я школа' })).toBeNull();
  });

  it('период: поля «С» и «По» стоят в паре равных колонок', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.click(screen.getByRole('tab', { name: 'Период' }));
    expect(screen.getByLabelText('С').closest('.ks-pair')).toBe(screen.getByLabelText('По').closest('.ks-pair'));
  });

  it('L4/L5: «Сборы» и «Без сборов» оставляют нужные операции и пересчитывают итоги, которые сходятся', async () => {
    const rows = [
      { id: 'a', kind: 'Абонемент', player: 'Аня', amount: 100, paid_on: today(), method: 'Наличные', staff: 'Дима', recorded_at: null, location: 'Isani' },
      { id: 'b', kind: 'Сбор', player: 'Боря', amount: 300, paid_on: today(), method: 'Перевод', staff: 'Гил', recorded_at: null, location: 'Surami' },
      { id: 'c', kind: 'Сбор', player: 'Вера', amount: -50, paid_on: today(), method: 'Перевод', staff: 'Дима', recorded_at: null, location: 'Surami' },
    ];
    fake.rpc.cash_report = () => ({ data: { total: 350, by_method: [{ method: 'Наличные', sum: 100 }, { method: 'Перевод', sum: 250 }], by_staff: [{ staff_id: 'x', name: 'Гил', sum: 300 }, { staff_id: 'y', name: 'Дима', sum: 50 }], rows }, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    expect(screen.getByText('Аня')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Сборы' }));
    expect(screen.queryByText('Аня')).toBeNull();
    expect(screen.getByText('Боря')).toBeInTheDocument();
    expect(screen.getByText('Вера')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /250/ })).toBeInTheDocument(); // итог 300 - 50
    expect(screen.getByText('Операции').parentElement).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('tab', { name: 'Без сборов' }));
    expect(screen.getByText('Аня')).toBeInTheDocument();
    expect(screen.queryByText('Боря')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /100/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Всё' }));
    expect(screen.getByRole('heading', { level: 2, name: /350/ })).toBeInTheDocument();
    // запрос в базу от фильтра вида не меняется
    expect(new Set(fake.rpcCalls('cash_report').map(a => JSON.stringify(a))).size).toBe(1);
  });

  it('L2: выбор филиала уходит в отчёт названием справочника (старые написания приводит canonicalLocation, см. branches.test)', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    expect((screen.getByLabelText('Локация') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Локация'), { target: { value: 'Isani' } });
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: 'Isani' }));
  });

  it('L5: два сотрудника с одним именем: фильтр вида недоступен, суммы не склеиваются', async () => {
    const rows = [
      { id: 'a', kind: 'Абонемент', player: 'Аня', amount: 100, paid_on: today(), method: 'Наличные', staff: 'Дима', recorded_at: null, location: 'Isani' },
      { id: 'b', kind: 'Сбор', player: 'Боря', amount: 300, paid_on: today(), method: 'Перевод', staff: 'Дима', recorded_at: null, location: 'Surami' },
    ];
    fake.rpc.cash_report = () => ({ data: { total: 400, by_method: [{ method: 'Наличные', sum: 100 }, { method: 'Перевод', sum: 300 }], by_staff: [{ staff_id: 'x', name: 'Дима', sum: 100 }, { staff_id: 'y', name: 'Дима', sum: 300 }], rows }, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.click(screen.getByRole('tab', { name: 'Сборы' }));
    expect(screen.getByText(/Фильтр по виду недоступен/)).toBeInTheDocument();
    expect(screen.getByText('Аня')).toBeInTheDocument(); // показано всё, как на сервере
    expect(screen.getAllByText('Дима')).toHaveLength(2); // два сотрудника в итогах, суммы раздельные (100 и 300)
    expect(screen.getAllByText('100 ₾').length).toBeGreaterThan(0);
    expect(screen.getAllByText('300 ₾').length).toBeGreaterThan(0);
  });

  it('L6: пустой результат фильтра вида показывает «За период платежей нет»', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.click(screen.getByRole('tab', { name: 'Сборы' }));
    expect(screen.getByText('За период платежей нет')).toBeInTheDocument();
  });

  it('показывает ошибку, если отчёт не открылся', async () => {
    fake.rpc.cash_report = () => ({ data: null, error: { message: 'forbidden' } });
    render(<CashReport />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('По сотрудникам')).not.toBeInTheDocument();
  });
});
