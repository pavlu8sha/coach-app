import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import ParentCamps from './ParentCamps';

// Экран сборов родителя (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 49-56)
const kid = (id: string, name: string, club = 'club1', status = 'active', user = 'u') =>
  ({ user_id: user, player_id: id, consent_revoked_at: null, players: { id, full_name: name, club_id: club, status } });

function seed() {
  fake.db.player_guardians = [kid('p1', 'Иванов Пётр'), kid('p2', 'Иванова Аня'), kid('p9', 'Чужой Ребёнок', 'club1', 'active', 'other')];
  fake.db.camps = [
    { id: 'c1', club_id: 'club1', name: 'Зимний лагерь', location: 'Бакуриани', starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 100, booking_deadline: '2026-12-01', full_payment_deadline: '2026-12-20', active: true },
    { id: 'c2', club_id: 'club2', name: 'Чужой сбор', location: 'Батуми', starts_on: '2027-02-01', ends_on: '2027-02-05', booking_fee: 0, booking_deadline: null, full_payment_deadline: null, active: true },
    { id: 'c3', club_id: 'club1', name: 'Летний лагерь 2026', location: 'Кобулети', starts_on: '2026-07-01', ends_on: '2026-07-10', booking_fee: 0, booking_deadline: null, full_payment_deadline: null, active: false },
    { id: 'c4', club_id: 'club1', name: 'Старый сбор', location: null, starts_on: '2025-07-01', ends_on: '2025-07-10', booking_fee: 0, booking_deadline: null, full_payment_deadline: null, active: false },
  ];
  fake.db.camp_tariffs = [
    { id: 't1', camp_id: 'c1', name: 'Футболист', price: 850, active: true },
    { id: 't2', camp_id: 'c1', name: 'Вратарь', price: 900, active: true },
    { id: 't3', camp_id: 'c1', name: 'Прошлогодний', price: 700, active: false },
  ];
  fake.db.camp_participants = [
    { id: 'cp1', camp_id: 'c1', player_id: 'p1', guest_name: null, owner_user_id: null, tariff_id: 't1', amount: 850, comment: null, status: 'registered', camp_tariffs: { name: 'Футболист' },
      camp_payments: [{ id: 'pay1', amount: 500, paid_on: '2026-11-01', kind: 'payment' }, { id: 'pay2', amount: -100, paid_on: '2026-11-05', kind: 'refund' }] },
    { id: 'cp9', camp_id: 'c1', player_id: 'p9', guest_name: null, owner_user_id: null, tariff_id: 't1', amount: 850, comment: null, status: 'registered', camp_tariffs: { name: 'Футболист' }, camp_payments: [{ id: 'pay9', amount: 850, paid_on: '2026-11-01', kind: 'payment' }] },
    { id: 'cpg', camp_id: 'c1', player_id: null, guest_name: 'Гость Маша', owner_user_id: 'u', tariff_id: 't2', amount: 900, comment: null, status: 'registered', camp_tariffs: { name: 'Вратарь' }, camp_payments: [] },
    { id: 'cp3', camp_id: 'c3', player_id: 'p1', guest_name: null, owner_user_id: null, tariff_id: 'tx', amount: 600, comment: null, status: 'cancelled', camp_tariffs: { name: 'Летний' }, camp_payments: [{ id: 'pay3', amount: 200, paid_on: '2026-06-01', kind: 'payment' }] },
  ];
  fake.db.camp_cancel_terms = [
    { id: 'k1', camp_id: 'c1', version: 1, periods: [{ from: null, to: null, text: 'Старые условия' }], created_at: '2026-10-01T00:00:00Z' },
    { id: 'k2', camp_id: 'c1', version: 2, periods: [{ from: null, to: '2026-12-01', text: 'Возврат полный' }, { from: '2026-12-02', to: null, text: 'Возврат 50%' }], created_at: '2026-11-01T00:00:00Z' },
  ];
  fake.rpc.camp_seats = () => 5;
  fake.rpc.camp_documents_list = () => [{ id: 'd1', title: 'Памятка', version: 2, size_bytes: 1000, ready_at: '2026-11-02T10:00:00Z' }];
}

async function openCamp(name = 'Зимний лагерь') {
  render(<ParentCamps />);
  fireEvent.click(await screen.findByText(name));
}
const section = async (name: string) => screen.findByRole('region', { name });

describe('Родитель: список сборов (условие 50)', () => {
  it('активные сборы своего клуба и история своих записей; чужой клуб и старые без записи не видны', async () => {
    seed();
    render(<ParentCamps />);
    expect(await screen.findByText('Зимний лагерь')).toBeInTheDocument();
    expect(screen.getByText('Летний лагерь 2026')).toBeInTheDocument();
    expect(screen.queryByText('Чужой сбор')).not.toBeInTheDocument();
    expect(screen.queryByText('Старый сбор')).not.toBeInTheDocument();
  });
  it('без сборов показывает пустое состояние', async () => {
    seed();
    fake.db.camps = [];
    fake.db.camp_participants = [];
    render(<ParentCamps />);
    expect(await screen.findByText('Сборов пока нет')).toBeInTheDocument();
  });
});

describe('Родитель: карточка сбора (условие 51)', () => {
  it('тарифы, места, сроки, последние условия отмены', async () => {
    seed();
    await openCamp();
    expect(await screen.findByText('Свободно мест: 5')).toBeInTheDocument();
    expect(fake.rpcCalls('camp_seats')[0]).toEqual({ cid: 'c1' });
    expect(screen.getByText(/Футболист: 850 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Вратарь: 900 ₾/)).toBeInTheDocument();
    expect(screen.queryByText(/Прошлогодний/)).not.toBeInTheDocument();
    expect(screen.getByText(/Полная оплата до 20\.12\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/Возврат полный/)).toBeInTheDocument();
    expect(screen.getByText(/Возврат 50%/)).toBeInTheDocument();
    expect(screen.queryByText('Старые условия')).not.toBeInTheDocument();
  });
  it('свои дети и своя гостевая запись: статус, сумма, внесено, остаток, платежи; чужого участника нет', async () => {
    seed();
    await openCamp();
    const petr = await section('Иванов Пётр');
    expect(within(petr).getByText('Записан')).toBeInTheDocument();
    expect(within(petr).getByText(/Тариф: Футболист/)).toBeInTheDocument();
    expect(within(petr).getByText(/Сумма: 850 ₾ · внесено: 400 ₾ · остаток: 450 ₾/)).toBeInTheDocument();
    expect(within(petr).getByText(/01\.11\.2026: 500 ₾/)).toBeInTheDocument();
    expect(within(petr).getByText(/05\.11\.2026: возврат 100 ₾/)).toBeInTheDocument();
    const anya = await section('Иванова Аня');
    expect(within(anya).getByText('Не записан')).toBeInTheDocument();
    const guest = await section('Гость Маша');
    expect(within(guest).getByText('Записан')).toBeInTheDocument();
    expect(screen.queryByText('Чужой Ребёнок')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Чужой Ребёнок' })).not.toBeInTheDocument();
  });
  it('ошибка мест: строка мест не показывается, остальное на месте', async () => {
    seed();
    fake.rpc.camp_seats = () => ({ error: { message: 'forbidden' } });
    await openCamp();
    expect(await section('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText(/Свободно мест/)).not.toBeInTheDocument();
  });
  it('закончившийся сбор: отменённая запись видна, записать нельзя', async () => {
    seed();
    await openCamp('Летний лагерь 2026');
    const petr = await section('Иванов Пётр');
    expect(within(petr).getByText('Отменён')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Записать' })).not.toBeInTheDocument();
  });
});

describe('Родитель: запись (условие 52)', () => {
  it('выбор тарифа из активных, комментарий, подтверждение с ценой; сумма не передаётся', async () => {
    seed();
    fake.rpc.camp_parent_register = () => 'cp-new';
    await openCamp();
    const anya = await section('Иванова Аня');
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать' }));
    const sel = within(anya).getByLabelText('Тариф') as HTMLSelectElement;
    expect([...sel.options].map(o => o.textContent)).toEqual(['Футболист — 850 ₾', 'Вратарь — 900 ₾']);
    fireEvent.change(sel, { target: { value: 't2' } });
    fireEvent.change(within(anya).getByLabelText('Комментарий'), { target: { value: ' Аллергия на орехи ' } });
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать на сбор' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/900 ₾/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('camp_parent_register')).toHaveLength(1));
    expect(fake.rpcCalls('camp_parent_register')[0]).toEqual({ cid: 'c1', p: 'p2', tid: 't2', cmt: 'Аллергия на орехи' });
    expect(await screen.findByText('Ребёнок записан на сбор.')).toBeInTheDocument();
  });
  it('нет мест: ответ базы текстом', async () => {
    seed();
    fake.rpc.camp_parent_register = () => ({ error: { message: 'camp full' } });
    await openCamp();
    const anya = await section('Иванова Аня');
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать' }));
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать на сбор' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('На сборе нет свободных мест.')).toBeInTheDocument();
  });
  it('отказ администратора и закрытый сбор показываются понятным текстом', async () => {
    seed();
    let msg = 'registration declined';
    fake.rpc.camp_parent_register = () => ({ error: { message: msg } });
    await openCamp();
    const anya = await section('Иванова Аня');
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать' }));
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать на сбор' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('Администратор отказал в записи на этот сбор.')).toBeInTheDocument();
    msg = 'camp closed';
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать на сбор' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('Запись на сбор закрыта.')).toBeInTheDocument();
  });
  it('двойное нажатие подтверждения отправляет один вызов', async () => {
    seed();
    let release: (v: unknown) => void = () => {};
    fake.rpc.camp_parent_register = () => new Promise(r => { release = r; });
    await openCamp();
    const anya = await section('Иванова Аня');
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать' }));
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать на сбор' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('camp_parent_register')).toHaveLength(1));
    expect(within(anya).getByRole('button', { name: 'Записать на сбор' })).toBeDisabled();
    fireEvent.click(within(anya).getByRole('button', { name: 'Записать на сбор' }));
    release('cp-new');
    await screen.findByText('Ребёнок записан на сбор.');
    expect(fake.rpcCalls('camp_parent_register')).toHaveLength(1);
  });
});

describe('Родитель: правка записи (условие 53)', () => {
  it('смена тарифа и комментария, срок смены тарифа показан', async () => {
    seed();
    fake.rpc.camp_parent_update = () => 'cp1';
    await openCamp();
    const petr = await section('Иванов Пётр');
    fireEvent.click(within(petr).getByRole('button', { name: 'Изменить запись' }));
    expect(within(petr).getByText(/Сменить тариф можно до 20\.12\.2026/)).toBeInTheDocument();
    fireEvent.change(within(petr).getByLabelText('Тариф'), { target: { value: 't2' } });
    fireEvent.change(within(petr).getByLabelText('Комментарий'), { target: { value: 'Размер M' } });
    fireEvent.click(within(petr).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('camp_parent_update')).toHaveLength(1));
    expect(fake.rpcCalls('camp_parent_update')[0]).toEqual({ pid: 'cp1', tid: 't2', cmt: 'Размер M' });
    expect(await screen.findByText('Запись изменена.')).toBeInTheDocument();
  });
  it('срок прошёл и особая сумма: ответ базы текстом', async () => {
    seed();
    let msg = 'tariff change closed';
    fake.rpc.camp_parent_update = () => ({ error: { message: msg } });
    await openCamp();
    const petr = await section('Иванов Пётр');
    fireEvent.click(within(petr).getByRole('button', { name: 'Изменить запись' }));
    fireEvent.click(within(petr).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Срок смены тарифа прошёл.')).toBeInTheDocument();
    msg = 'custom amount';
    fireEvent.click(within(petr).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('У записи особая сумма, тариф меняет администратор.')).toBeInTheDocument();
  });
});

describe('Родитель: отмена (условие 54)', () => {
  it('подтверждение с внесённой суммой и условиями; после отмены период из ответа базы', async () => {
    seed();
    fake.rpc.camp_parent_cancel = () => ({ paid: 400, terms: { version: 2, text: 'Возврат 50%' } });
    await openCamp();
    const petr = await section('Иванов Пётр');
    fireEvent.click(within(petr).getByRole('button', { name: 'Отменить запись' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/400 ₾/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Возврат полный/)).toBeInTheDocument();
    expect(fake.rpcCalls('camp_parent_cancel')).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отменить запись' }));
    await waitFor(() => expect(fake.rpcCalls('camp_parent_cancel')[0]).toEqual({ pid: 'cp1' }));
    expect(await screen.findByText(/Запись отменена/)).toBeInTheDocument();
    expect(screen.getByText(/Условия на сегодня: Возврат 50%/)).toBeInTheDocument();
    expect(screen.getByText(/Сумму возврата определяет администратор/)).toBeInTheDocument();
  });
  it('уже отменена: ответ базы текстом', async () => {
    seed();
    fake.rpc.camp_parent_cancel = () => ({ error: { message: 'already cancelled' } });
    await openCamp();
    const petr = await section('Иванов Пётр');
    fireEvent.click(within(petr).getByRole('button', { name: 'Отменить запись' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить запись' }));
    expect(await screen.findByText('Запись уже отменена.')).toBeInTheDocument();
  });
});

describe('Родитель: документы (условие 55)', () => {
  it('записанному участнику список документов и открытие по ссылке camp-docs', async () => {
    seed();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://files.test/d1?token=1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await openCamp();
    const docs = await section('Документы');
    expect(within(docs).getByText(/Памятка/)).toBeInTheDocument();
    expect(fake.rpcCalls('camp_documents_list')[0]).toEqual({ cid: 'c1' });
    fireEvent.click(within(docs).getByRole('button', { name: 'Открыть' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://files.test/d1?token=1', '_blank', 'noopener'));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://fake.supabase/functions/v1/camp-docs');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'link', id: 'd1' });
  });
  it('без записанного участника список документов не запрашивается', async () => {
    seed();
    await openCamp('Летний лагерь 2026');
    await section('Иванов Пётр');
    expect(fake.rpcCalls('camp_documents_list')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Документы' })).not.toBeInTheDocument();
  });
});

describe('Родитель: ошибки загрузки (условие 56)', () => {
  it('ошибка списка: текст и «Повторить»', async () => {
    seed();
    fake.errors.camps = 'boom';
    render(<ParentCamps />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    fake.errors = {};
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Зимний лагерь')).toBeInTheDocument();
  });
});
