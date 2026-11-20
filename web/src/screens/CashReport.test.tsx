import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { today } from '../lib/coach';
// @ts-expect-error в проекте нет типов node; vitest читает файлы напрямую
import { readFileSync, readdirSync } from 'node:fs';
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
    fake.db.groups = [{ location: 'Исани' }];
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Исани' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Локация'), { target: { value: 'Исани' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Перевод' }));
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: 'Исани', p_method: 'Перевод' }));
  });

  it('локация: выпадающий список без дублей, выбор передаёт точное значение, «Все локации» — null', async () => {
    fake.db.groups = [{ location: 'Ortachala' }, { location: 'Isani' }, { location: null }];
    fake.db.camps = [{ location: 'Surami' }, { location: 'Ortachala' }, { location: ' ' }];
    fake.db.equipment_orders = [{ location: 'Isani' }];
    fake.db.extra_sessions = [{ place: 'Vake' }];
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    const sel = screen.getByLabelText('Локация') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    await waitFor(() => expect(Array.from(sel.options).map(o => o.textContent)).toEqual(['Все локации', 'Isani', 'Ortachala', 'Surami', 'Vake']));
    fireEvent.change(sel, { target: { value: 'Ortachala' } });
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: 'Ortachala' }));
    fireEvent.change(sel, { target: { value: '' } });
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: null }));
  });

  it('локация: сбой списка не блокирует отчёт и показывается сообщение, а не пустой список', async () => {
    fake.errors.camps = 'column camps.location does not exist';
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    expect(Array.from((screen.getByLabelText('Локация') as HTMLSelectElement).options).map(o => o.textContent)).toEqual(['Все локации']);
    expect(await screen.findByRole('status')).toHaveTextContent('Список локаций не загрузился');
  });

  it('период: поля «С» и «По» стоят в паре равных колонок', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.click(screen.getByRole('tab', { name: 'Период' }));
    expect(screen.getByLabelText('С').closest('.ks-pair')).toBe(screen.getByLabelText('По').closest('.ks-pair'));
  });

  it('показывает ошибку, если отчёт не открылся', async () => {
    fake.rpc.cash_report = () => ({ data: null, error: { message: 'forbidden' } });
    render(<CashReport />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('По сотрудникам')).not.toBeInTheDocument();
  });
});

// Контракт с базой: заглушка Supabase не знает схему, поэтому колонки списка локаций сверяются с миграциями, а источники — с телом cash_report.
describe('Кассовый отчёт: источники списка локаций совпадают с базой', () => {
  const dir = '../db/migrations/';
  const sql = (readdirSync(dir) as string[]).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(dir + f, 'utf8') as string);
  const report = [...sql].reverse().find(t => /function +(public\.)?cash_report *\(/i.test(t) && /create or replace/i.test(t)) ?? '';
  it('cash_report берёт локацию из groups, camps, equipment_orders и extra_sessions.place, а sessions.location в схеме нет', () => {
    expect(report).toMatch(/gr\.location/);
    expect(report).toMatch(/cm\.location/);
    expect(report).toMatch(/eo\.location from equipment_orders/);
    expect(report).toMatch(/es\.place from extra_sessions/);
    const all = sql.join('\n');
    expect(all).not.toMatch(/alter table sessions[^;]*add column[^;]*location/i);
  });
  it('колонки, которые читает экран, есть в миграциях', () => {
    const all = sql.join('\n');
    expect(all).toMatch(/alter table camps[\s\S]{0,80}add column if not exists location/i);
    expect(all).toMatch(/create table (if not exists )?extra_sessions[\s\S]{0,400}place text/i);
    expect(all).toMatch(/create table (if not exists )?equipment_orders[\s\S]{0,600}location text/i);
  });
});
