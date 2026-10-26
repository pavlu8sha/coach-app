import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Equipment from './Equipment';

const order = (id: string, name: string, total: number, paid: number, issued: string[] = []) => ({
  id, ordered_on: '2026-09-10', total, paid, installment: false, number: '7', inscription: null, location: 'Зал',
  players: { full_name: name },
  equipment_order_lines: [{ kit: 'Форма', size: '128', quantity: 1 }, { kit: 'Куртка', size: '128', quantity: 1 }],
  equipment_issues: issued.map(kit => ({ kit, issued_on: '2026-09-20', issued_by: 'Павел' })),
});
function seed() {
  fake.db.equipment_orders = [order('o1', 'Иванов Пётр', 160, 160, ['Форма', 'Куртка']), order('o2', 'Сидоров Ян', 160, 60), order('o3', 'Петров Иван', 160, 160, ['Форма'])];
  fake.db.equipment_catalog = [
    { kit: 'Форма', price: 100, valid_from: '2026-08-01' },
    { kit: 'Куртка', price: 60, valid_from: '2026-08-01' },
  ];
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр' }];
}

describe('«Экипировка»', () => {
  it('список: оплата и выдача; фильтры «Не оплачены» и «Не выданы»', async () => {
    seed();
    render(<Equipment />);
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('60 из 160 ₾')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Не оплачены' }));
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument();
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Не выданы' }));
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument(); // выдан полностью
    expect(screen.getByText('Петров Иван')).toBeInTheDocument(); // выдана часть
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
  });

  it('поиск по имени', async () => {
    seed();
    render(<Equipment />);
    await screen.findByText('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'сидор' } });
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument();
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
  });

  it('платёж по заказу и понятное сообщение о переплате', async () => {
    seed();
    fake.rpc.eq_add_payment = () => ({ error: { message: 'paid above total' } });
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.change(await screen.findByLabelText(/Сумма, ₾ \(минус/), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText('Оплата больше суммы заказа.')).toBeInTheDocument();
    expect(fake.rpcCalls('eq_add_payment')).toEqual([{ o: 'o2', amt: 500 }]);
  });

  it('выдача вещи отмечается по позиции', async () => {
    seed();
    fake.rpc.eq_set_issued = () => null;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    const kit = (await screen.findByText('Форма')).closest('.ks-card') as HTMLElement;
    fireEvent.click(within(kit).getByRole('button', { name: 'Отметить выдачу' }));
    await waitFor(() => expect(fake.rpcCalls('eq_set_issued')[0]).toMatchObject({ o: 'o2', k: 'Форма', on_: true }));
  });

  it('новый заказ: позиции из каталога, сумма по каталогу, вызов eq_create_order; номер занят — сообщение', async () => {
    seed();
    fake.rpc.eq_create_order = () => ({ error: { message: 'number taken' } });
    render(<Equipment />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый заказ' }));
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.click(await screen.findByLabelText(/Форма/));
    fireEvent.click(screen.getByLabelText(/Куртка/));
    expect(screen.getByText('По каталогу: 160 ₾')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Размер: Форма'), { target: { value: '128' } });
    fireEvent.change(screen.getByLabelText('Номер'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    expect(await screen.findByText('Этот номер уже занят в группе.')).toBeInTheDocument();
    const call = fake.rpcCalls('eq_create_order')[0];
    expect(call.p).toBe('p1');
    expect(call.lines).toEqual([{ kit: 'Форма', size: '128', quantity: 1 }, { kit: 'Куртка', size: '', quantity: 1 }]);
    expect(call.custom_total).toBeNull();
  });

  it('заказ с оплатой: ошибка удаления объясняет, что делать', async () => {
    seed();
    fake.rpc.eq_delete_order = () => ({ error: { message: 'order has payments' } });
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить заказ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }));
    expect(await screen.findByText(/сначала верните её записью с минусом/)).toBeInTheDocument();
  });
});

describe('Экипировка: фильтры как в старом приложении', () => {
  it('фильтры по группе, товару и выдаче сужают список, сводка считает по видимому', async () => {
    fake.db.equipment_orders = [
      { id: 'o1', ordered_on: '2026-09-10', total: 160, paid: 60, installment: false, number: null, inscription: null, location: 'Красный парк', players: { full_name: 'Иванов Пётр', groups: { name: 'U9-A' } }, equipment_order_lines: [{ kit: 'Форма', size: 'M', quantity: 1 }], equipment_issues: [] },
      { id: 'o2', ordered_on: '2026-09-11', total: 100, paid: 100, installment: false, number: null, inscription: null, location: 'Исани', players: { full_name: 'Сидоров Ян', groups: { name: 'U11' } }, equipment_order_lines: [{ kit: 'Куртка', size: 'L', quantity: 1 }], equipment_issues: [{ kit: 'Куртка', issued_on: '2026-09-12', issued_by: null }] },
    ];
    render(<Equipment />);
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'U11' } });
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Выдача'), { target: { value: 'no' } });
    expect(screen.queryByText('Сидоров Ян')).toBeNull();
    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('100 ₾')).toBeInTheDocument(); // долг по видимому заказу: 160 − 60
  });
});
