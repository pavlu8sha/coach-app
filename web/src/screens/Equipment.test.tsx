import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Equipment from './Equipment';
import { today } from '../lib/coach';
import { useNav } from '../nav';

const order = (id: string, name: string, total: number, paid: number, issued: string[] = []) => ({
  id, ordered_on: '2026-09-10', total, paid, installment: false, number: '7', inscription: null, location: 'Зал',
  players: { full_name: name },
  equipment_order_lines: [{ id: `${id}-f`, kit: 'Форма', size: '128', quantity: 1 }, { id: `${id}-k`, kit: 'Куртка', size: '128', quantity: 1 }],
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

  it('фильтр «Неполные»: нет размера или номера, у гетр и носков номер не нужен', async () => {
    seed();
    const o = fake.db.equipment_orders as ReturnType<typeof order>[];
    o[1].equipment_order_lines = [{ id: 'o2-f', kit: 'Форма', size: '', quantity: 1 }];
    o[2].number = '';
    o.push({ ...order('o4', 'Носков Олег', 35, 35), number: '', equipment_order_lines: [{ id: 'o4-g', kit: 'Гетры', size: '30', quantity: 1 }] });
    render(<Equipment />);
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByRole('tab', { name: 'Неполные' }));
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument();
    expect(screen.queryByText('Носков Олег')).not.toBeInTheDocument();
    expect(screen.getByText(/не заполнено: размер/)).toBeInTheDocument();
    expect(screen.getByText(/не заполнено: номер/)).toBeInTheDocument();
  });

  it('номер из другого заказа игрока: подсказка в «Неполных» и кнопка «Подставить»', async () => {
    seed();
    const o = fake.db.equipment_orders as (ReturnType<typeof order> & { player_id?: string })[];
    o[0].player_id = 'p1'; o[0].number = '7';
    o.push({ ...order('o5', 'Иванов Пётр', 100, 100), number: '', player_id: 'p1' });
    render(<Equipment />);
    await screen.findAllByText('Иванов Пётр');
    fireEvent.click(screen.getByRole('tab', { name: 'Неполные' }));
    expect(await screen.findByText(/номер 7 есть в другом заказе/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Иванов Пётр'));
    fireEvent.click(await screen.findByRole('button', { name: /Подставить номер 7/ }));
    expect(screen.getByLabelText('Номер')).toHaveValue('7');
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
    fireEvent.change(await screen.findByLabelText(/^Способ оплаты/), { target: { value: 'Наличные' } });
    fireEvent.change(await screen.findByLabelText(/Сумма, ₾ \(минус/), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText('Оплата больше суммы заказа.')).toBeInTheDocument();
    expect(fake.rpcCalls('eq_add_payment')).toEqual([{ o: 'o2', amt: 500, d: today(), mth: 'Наличные' }]);
  });

  it('#474: в оплате заказа дата по умолчанию сегодня, предыдущую можно выбрать, в RPC уходит она', async () => {
    seed();
    fake.rpc.eq_add_payment = () => 160;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    const dateInput = await screen.findByLabelText('Дата платежа') as HTMLInputElement;
    expect(dateInput.value).toBe(today());
    expect(dateInput).toHaveAttribute('max', today());
    fireEvent.change(dateInput, { target: { value: '2026-10-13' } });
    fireEvent.change(await screen.findByLabelText(/^Способ оплаты/), { target: { value: 'Перевод' } });
    fireEvent.change(await screen.findByLabelText(/Сумма, ₾ \(минус/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.rpcCalls('eq_add_payment')).toEqual([{ o: 'o2', amt: 100, d: '2026-10-13', mth: 'Перевод' }]));
    await waitFor(() => expect((screen.getByLabelText('Дата платежа') as HTMLInputElement).value).toBe(today()));
  });

  it('#474: будущая дата в оплате заказа отклоняется до вызова RPC', async () => {
    seed();
    fake.rpc.eq_add_payment = () => 160;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.change(await screen.findByLabelText('Дата платежа'), { target: { value: '2999-01-05' } });
    fireEvent.change(await screen.findByLabelText(/^Способ оплаты/), { target: { value: 'Наличные' } });
    fireEvent.change(await screen.findByLabelText(/Сумма, ₾ \(минус/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText('Дата платежа не может быть в будущем.')).toBeInTheDocument();
    expect(fake.rpcCalls('eq_add_payment')).toHaveLength(0);
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

  it('новый заказ: позиции из каталога, сумма по каталогу, вызов eq_create_order', async () => {
    seed();
    fake.rpc.eq_create_order = () => 'new-order';
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
    await waitFor(() => expect(fake.rpcCalls('eq_create_order')).toHaveLength(1));
    const call = fake.rpcCalls('eq_create_order')[0];
    expect(call.p).toBe('p1');
    expect(call.lines).toEqual([{ kit: 'Форма', size: '128', quantity: 1 }, { kit: 'Куртка', size: '', quantity: 1 }]);
    expect(call.custom_total).toBeNull();
  });

  it('новый заказ: скидка на комплект считается с учётом прошлых заказов игрока (#339)', async () => {
    seed();
    fake.db.equipment_catalog = [
      { kit: 'Тренировочная форма', price: 160, valid_from: '2026-01-01' },
      { kit: 'Спортивный костюм', price: 150, valid_from: '2026-01-01' },
      { kit: 'Дождевик', price: 110, valid_from: '2026-01-01' },
    ];
    fake.db.equipment_orders = [{ id: 'o9', player_id: 'p1', ordered_on: '2026-09-01', total: 200, paid: 200, installment: false, number: '7', inscription: null, location: null, status: 'issued', equipment_order_status_history: [], players: { full_name: 'Иванов Пётр' }, equipment_order_lines: [{ kit: 'Игровая форма', size: '128', quantity: 1 }], equipment_issues: [] }];
    fake.db.clubs = [{ id: 'c1' }];
    fake.db.club_settings = [];
    fake.rpc.eq_create_order = () => 'o10';
    render(<Equipment />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый заказ' }));
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.click(await screen.findByLabelText(/Тренировочная форма/));
    fireEvent.click(screen.getByLabelText(/Спортивный костюм/));
    fireEvent.click(screen.getByLabelText(/Дождевик/));
    expect(await screen.findByText('К оплате: 325 ₾')).toBeInTheDocument();
    expect(screen.getByText('По каталогу: 420 ₾')).toBeInTheDocument();
    expect(screen.getByText('Скидка на комплект 15%: −95 ₾')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    await waitFor(() => expect(fake.rpcCalls('eq_create_order')[0]).toMatchObject({ p: 'p1', custom_total: 325 }));
  });

  it('номер занят: подсказка называет только игрока из той же возрастной группы и не мешает создать заказ', async () => {
    seed();
    const ord = (id: string, pid: string, name: string, grp: string, number: string) => ({ id, player_id: pid, number, players: { full_name: name, groups: { name: grp } }, equipment_order_lines: [], equipment_issues: [], equipment_order_status_history: [] });
    fake.db.equipment_orders = [
      ...fake.db.equipment_orders,
      ord('o7', 'p7', 'Тот Же Возраст', 'U9-B', '19'),
      ord('o8', 'p8', 'Другая Группа', 'U11', '19'),
      ord('o9', 'p9', 'Площадка Исани', 'Isani', '19'),
    ];
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', groups: { location: null, name: 'U9-A' } }];
    fake.rpc.eq_create_order = () => 'new-order';
    render(<Equipment />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый заказ' }));
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.click(await screen.findByLabelText(/Форма/));
    fireEvent.change(screen.getByLabelText('Номер'), { target: { value: '19' } });
    const msg = await screen.findByText(/Номер 19 уже есть в группе U9-A/);
    expect(msg.textContent).not.toContain('объедините');
    expect(msg.textContent).toContain('Тот Же Возраст (U9-B)');
    expect(msg.textContent).not.toContain('Другая Группа');
    expect(msg.textContent).not.toContain('Площадка Исани');
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    await waitFor(() => expect(fake.rpcCalls('eq_create_order')).toHaveLength(1));
  });

  it('размер правится отдельно по каждой вещи (eq_edit_line)', async () => {
    seed();
    fake.rpc.eq_edit_line = () => null;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.change(await screen.findByLabelText('Размер: Куртка'), { target: { value: '140' } });
    const card = screen.getByLabelText('Размер: Куртка').closest('.ks-card') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('eq_edit_line')).toEqual([{ l: 'o2-k', sz: '140', qty: 1 }]));
  });

  it('выданной вещи количество не меняется, размер можно', async () => {
    seed();
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Петров Иван'));
    expect(await screen.findByLabelText('Количество: Форма')).toBeDisabled();
    expect(screen.getByLabelText('Количество: Куртка')).not.toBeDisabled();
    expect(screen.getByLabelText('Размер: Форма')).not.toBeDisabled();
  });

  it('добавить вещь и убрать вещь', async () => {
    seed();
    fake.rpc.eq_add_line = () => 'new';
    fake.rpc.eq_delete_line = () => null;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.change(await screen.findByLabelText('Вещь'), { target: { value: 'Форма' } });
    fireEvent.change(screen.getByLabelText('Размер новой вещи'), { target: { value: '134' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в заказ' }));
    await waitFor(() => expect(fake.rpcCalls('eq_add_line')).toEqual([{ o: 'o2', k: 'Форма', sz: '134', qty: 1 }]));
    const card = screen.getByLabelText('Размер: Куртка').closest('.ks-card') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Убрать' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(fake.rpcCalls('eq_delete_line')).toEqual([{ l: 'o2-k' }]));
  });


  it('вещь, добавленная в заказ, остаётся после выхода через «Назад» стека навигации и повторного входа', async () => {
    seed();
    fake.db.equipment_catalog = [...(fake.db.equipment_catalog as object[]), { kit: 'Дождевик', price: 150, valid_from: '2026-08-01' }];
    fake.rpc.eq_add_line = (a: { o: string; k: string; sz: string; qty: number }) => {
      const o = (fake.db.equipment_orders as ReturnType<typeof order>[]).find(x => x.id === a.o)!;
      o.equipment_order_lines = [...o.equipment_order_lines, { id: 'new-1', kit: a.k, size: a.sz === '' ? (null as unknown as string) : a.sz, quantity: a.qty }];
      return 'new-1';
    };
    let back: () => void = () => {};
    const Probe = () => { back = useNav().back; return null; };
    render(<><Probe /><Equipment /></>);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.change(await screen.findByLabelText('Вещь'), { target: { value: 'Дождевик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в заказ' }));
    expect(await screen.findByLabelText('Размер: Дождевик')).toBeInTheDocument();
    act(() => back());
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    expect(await screen.findByLabelText('Размер: Дождевик')).toBeInTheDocument();
  });

  it('после добавления вещи предлагает пересчитать сумму по скидке на комплект (полный набор: 525 ₾)', async () => {
    seed();
    fake.db.equipment_catalog = [
      { kit: 'Игровая форма', price: 200, valid_from: '2026-01-01' }, { kit: 'Тренировочная форма', price: 160, valid_from: '2026-01-01' },
      { kit: 'Спортивный костюм', price: 150, valid_from: '2026-01-01' }, { kit: 'Дождевик', price: 110, valid_from: '2026-01-01' },
    ];
    fake.db.clubs = [{ id: 'c1' }];
    fake.db.club_settings = [];
    const ln = (id: string, kit: string, price: number) => ({ id, kit, size: '152', quantity: 1, unit_price: price });
    fake.db.equipment_orders = [{ id: 'k1', player_id: 'p7', ordered_on: '2026-10-01', total: 435, paid: 300, installment: false, number: '7', inscription: null, location: null, status: 'accepted', equipment_order_status_history: [], players: { full_name: 'Котов Родион' },
      equipment_order_lines: [ln('k1-a', 'Игровая форма', 200), ln('k1-b', 'Тренировочная форма', 160), ln('k1-c', 'Спортивный костюм', 150)], equipment_issues: [] }];
    fake.rpc.eq_add_line = (a: { o: string; k: string; sz: string; qty: number }) => {
      const o = (fake.db.equipment_orders as { id: string; total: number; equipment_order_lines: object[] }[]).find(x => x.id === a.o)!;
      o.equipment_order_lines = [...o.equipment_order_lines, ln('k1-d', a.k, 110)];
      o.total += 110; // как eq_add_line: цена по каталогу, без скидки
      return 'k1-d';
    };
    fake.rpc.eq_edit_order = () => null;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Котов Родион'));
    fireEvent.change(await screen.findByLabelText('Вещь'), { target: { value: 'Дождевик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в заказ' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('525 ₾')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(fake.rpcCalls('eq_edit_order')).toEqual([{ o: 'k1', insc: '', num: '7', inst: false, loc: '', new_total: 525 }]));
  });

  it('кнопка «Пересчитать по скидке на комплект»: строка без цены берёт цену каталога, сумма 525 ₾', async () => {
    seed();
    fake.db.equipment_catalog = [
      { kit: 'Игровая форма', price: 200, valid_from: '2026-01-01' }, { kit: 'Тренировочная форма', price: 160, valid_from: '2026-01-01' },
      { kit: 'Спортивный костюм', price: 150, valid_from: '2026-01-01' }, { kit: 'Дождевик', price: 110, valid_from: '2026-01-01' },
    ];
    fake.db.clubs = [{ id: 'c1' }];
    fake.db.club_settings = [];
    const ln = (id: string, kit: string, price: number) => ({ id, kit, size: '152', quantity: 1, unit_price: price });
    fake.db.equipment_orders = [{ id: 'k1', player_id: 'p7', ordered_on: '2026-10-01', total: 470, paid: 300, installment: false, number: '7', inscription: null, location: null, status: 'accepted', equipment_order_status_history: [], players: { full_name: 'Котов Родион' },
      equipment_order_lines: [ln('k1-a', 'Игровая форма', 200), ln('k1-b', 'Тренировочная форма', 160), ln('k1-c', 'Спортивный костюм', 150), ln('k1-d', 'Дождевик', 0)], equipment_issues: [] }];
    fake.rpc.eq_edit_order = () => null;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Котов Родион'));
    fireEvent.click(await screen.findByRole('button', { name: 'Пересчитать по скидке на комплект' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('525 ₾')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(fake.rpcCalls('eq_edit_order')).toEqual([{ o: 'k1', insc: '', num: '7', inst: false, loc: '', new_total: 525 }]));
  });

  it('дата заказа сохраняется (eq_set_order_date)', async () => {
    seed();
    fake.rpc.eq_set_order_date = () => null;
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.change(await screen.findByLabelText('Дата заказа'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить дату' }));
    await waitFor(() => expect(fake.rpcCalls('eq_set_order_date')).toEqual([{ o: 'o2', d: '2026-09-01' }]));
  });

  it('заказ с оплатой: ошибка удаления объясняет, что делать', async () => {
    seed();
    fake.rpc.eq_delete_order = () => ({ error: { message: 'order has payments' } });
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить заказ' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }));
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

describe('Экипировка: «Выдача» считается по вещи (условия docs/acceptance/eq-issue-filter-per-kit-2026-11-11.md)', () => {
  it('условия 1-2: Товар «Форма» + «Не выдано» не включает того, кому форму выдали, а куртку нет', async () => {
    seed(); // o1: всё выдано; o2: ничего; o3: выдана форма, куртка нет
    render(<Equipment />);
    expect(await screen.findByText('Петров Иван')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Товар'), { target: { value: 'Форма' } });
    fireEvent.change(screen.getByLabelText('Выдача'), { target: { value: 'no' } });
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
    expect(screen.queryByText('Петров Иван')).toBeNull();
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
    fireEvent.change(screen.getByLabelText('Выдача'), { target: { value: 'yes' } });
    expect(screen.getByText('Петров Иван')).toBeInTheDocument();
    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText('Сидоров Ян')).toBeNull();
  });
  it('условие 3: вкладка «Не выданы» вместе с «Товар» тоже смотрит на вещь', async () => {
    seed();
    render(<Equipment />);
    expect(await screen.findByText('Петров Иван')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Товар'), { target: { value: 'Форма' } });
    fireEvent.click(screen.getByRole('tab', { name: /Не выданы/ }));
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
    expect(screen.queryByText('Петров Иван')).toBeNull();
  });
  it('условие 4: без «Товар» заказ целиком (частично выданный остаётся в «Не выдано»)', async () => {
    seed();
    render(<Equipment />);
    expect(await screen.findByText('Петров Иван')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Выдача'), { target: { value: 'no' } });
    expect(screen.getByText('Петров Иван')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
  });
});

describe('Новый заказ: локация', () => {
  it('локация подставляется из группы выбранного игрока и остаётся редактируемой', async () => {
    fake.db.equipment_orders = [];
    fake.db.equipment_catalog = [{ kit: 'Носки', price: 15, valid_from: '2026-08-01' }];
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', groups: { location: 'Красный парк' } }];
    render(<Equipment />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый заказ' }));
    fireEvent.change(await screen.findByLabelText(/Найти игрока/), { target: { value: 'Иван' } });
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    expect(await screen.findByLabelText('Локация')).toHaveValue('Красный парк');
  });
});

describe('Экипировка: выгрузка в CSV (docs/acceptance/eq-export-csv-2026-11-09.md)', () => {
  const ord = (id: string, name: string, date: string, lines: { kit: string; size: string | null }[], extra: Record<string, unknown> = {}) => ({
    id, ordered_on: date, total: 100, paid: 100, installment: false, number: '7', inscription: null, location: 'Исани', status: 'accepted',
    players: { full_name: name, groups: { name: 'U9-A' } },
    equipment_order_lines: lines.map((l, n) => ({ id: `${id}-${n}`, kit: l.kit, size: l.size, quantity: 1 })), equipment_issues: [], ...extra,
  });
  const seedExport = () => {
    fake.db.equipment_orders = [
      ord('o1', 'Иванов Пётр', '2026-09-10', [{ kit: 'Дождевик', size: '140' }, { kit: 'Форма', size: 'M' }]),
      ord('o2', 'Сидоров Ян', '2026-09-11', [{ kit: 'Форма', size: 'L' }]),
    ];
  };
  const writeText = vi.fn(() => Promise.resolve());
  afterEach(() => {
    vi.restoreAllMocks(); writeText.mockClear();
    delete (window as unknown as { Telegram?: unknown }).Telegram;
    delete (navigator as unknown as { share?: unknown }).share; delete (navigator as unknown as { canShare?: unknown }).canShare;
  });
  const mockClipboard = () => Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const copied = () => (writeText.mock.calls[0] as unknown as [string])[0];

  it('условия 1, 3, 4, 13: «Скопировать» отдаёт строки только выбранного товара в колонках эталонного запроса', async () => {
    seedExport(); mockClipboard();
    render(<Equipment />);
    await screen.findByText('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Товар'), { target: { value: 'Дождевик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(copied().startsWith('﻿')).toBe(false); // в буфер без BOM
    expect(copied().split('\r\n')).toEqual([
      'дата заказа;номер;игрок;группа;локация;вещь;размер;количество;id заказа',
      '2026-09-10;7;Иванов Пётр;U9-A;Исани;Дождевик;140;1;o1',
    ]);
    expect(await screen.findByText('Список скопирован.')).toBeInTheDocument();
  });

  it('условие 2: выгрузка берёт все заказы клуба, а не только 500 с экрана, и следует фильтру «Товар»', async () => {
    fake.db.equipment_orders = Array.from({ length: 1100 }, (_, n) =>
      ord(`o${n}`, `Игрок ${String(n).padStart(4, '0')}`, `2026-09-${String(1 + (n % 28)).padStart(2, '0')}`, [{ kit: 'Дождевик', size: '140' }]));
    mockClipboard();
    render(<Equipment />);
    await screen.findAllByText(/Игрок 0/);
    fireEvent.change(screen.getByLabelText('Товар'), { target: { value: 'Дождевик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(copied().split('\r\n')).toHaveLength(1101); // заголовок + 1100 вещей
    expect(new Set(copied().split('\r\n').slice(1).map(l => l.split(';')[8])).size).toBe(1100);
  });

  it('условие 2: выгрузка следует за поиском экрана', async () => {
    seedExport(); mockClipboard();
    render(<Equipment />);
    await screen.findByText('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Сидоров' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copied()).toContain('Сидоров Ян');
    expect(copied()).not.toContain('Иванов Пётр');
  });

  it('условие 9: нет строк, файл и буфер не создаются, видно сообщение', async () => {
    seedExport(); mockClipboard();
    render(<Equipment />);
    await screen.findByText('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Никто' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect(await screen.findByText('Нет заказов по выбранным фильтрам.')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('условия 7, 11, 12: «Скачать CSV» создаёт файл equipment-<дата>.csv с BOM и не вызывает RPC', async () => {
    seedExport();
    const create = vi.fn(() => 'blob:x');
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    render(<Equipment />);
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(name).toBe(`equipment-${today()}.csv`);
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toContain('text/csv');
    // FileReader.readAsText отбрасывает BOM при декодировании, поэтому смотрим сырые байты
    const bytes = await new Promise<Uint8Array>(res => { const fr = new FileReader(); fr.onload = () => res(new Uint8Array(fr.result as ArrayBuffer)); fr.readAsArrayBuffer(blob); });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3, 40))).toMatch(/^дата заказа;/);
    expect(fake.calls).toEqual([]); // ни RPC, ни записей
  });

  it('условие 10: ошибка загрузки заказов видна рядом с кнопками', async () => {
    seedExport(); mockClipboard();
    render(<Equipment />);
    await screen.findByText('Иванов Пётр');
    fake.errors.equipment_orders = 'boom';
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/boom|Не удалось/);
    expect(writeText).not.toHaveBeenCalled();
  });

  describe('внутри Telegram Mini App (условия 14-16)', () => {
    const inTelegram = () => { (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: 'query_id=1', ready() {}, expand() {}, themeParams: {} } }; };
    const spyLinks = () => {
      const create = vi.fn(() => 'blob:x');
      Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
      return { create, click: vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}) };
    };
    const setShare = (share: (d: ShareData) => Promise<void>, can = true) => {
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
      Object.defineProperty(navigator, 'canShare', { value: () => can, configurable: true });
    };

    it('условие 14: файл уходит в меню «Поделиться», ссылка на файл не открывается', async () => {
      seedExport(); inTelegram();
      const { create, click } = spyLinks();
      const share = vi.fn(() => Promise.resolve());
      setShare(share);
      render(<Equipment />);
      await screen.findByText('Иванов Пётр');
      fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      const file = ((share.mock.calls[0] as unknown as [ShareData])[0].files ?? [])[0];
      expect(file.name).toBe(`equipment-${today()}.csv`);
      expect(create).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    });

    it('условие 15: телефон не умеет делиться файлами, окно не уводим, объясняем про «Скопировать»', async () => {
      seedExport(); inTelegram();
      const { create, click } = spyLinks();
      render(<Equipment />);
      await screen.findByText('Иванов Пётр');
      fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
      expect(await screen.findByText(/в Telegram файл скачать нельзя/i)).toBeInTheDocument();
      expect(screen.getByText('Экипировка')).toBeInTheDocument();
      expect(create).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    });

    it('условие 16: отмена меню без ошибки, другая ошибка с советом', async () => {
      seedExport(); inTelegram(); spyLinks();
      const share = vi.fn(() => Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' })));
      setShare(share);
      render(<Equipment />);
      await screen.findByText('Иванов Пётр');
      fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Скачать CSV' })).toBeEnabled());
      expect(screen.queryByRole('status')).toBeNull();
      share.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })));
      fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
      expect(await screen.findByText(/нажмите «Скачать CSV» ещё раз/)).toBeInTheDocument();
    });
  });
});
