// «Мероприятия», этап 4 (Issue #677): тесты от условий UI1–UI19 из docs/CLUB_EVENTS_ACCEPTANCE.md.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { DEFAULT_BAR, SECTIONS, parseBar } from '../lib/adminMenu';
import { restorableEntry } from '../nav/restore';
import ClubEvents from './ClubEvents';

const ev = (o: Record<string, unknown>) => ({
  id: 'e1', name: 'Турнир Осень', description: null, starts_on: '2026-12-20', starts_time: null, place: 'Стадион', base_price: 100, signup_deadline: null,
  capacity: 10, status: 'active', active_count: 3, free_places: 7, over_limit: false, club_wide: true, group_ids: [], group_names: [],
  finance: { counted: 290, debt: 160, overpay: 50 }, ...o,
});
const part = (o: Record<string, unknown>) => ({
  id: 'pt1', player_id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', group_name: 'U9-A', player_status: 'active', status: 'active', base_price: 100, individual_price: null,
  price: 100, counted: 0, debt: 100, overpay: 0, pay_state: 'debt', not_in_group: false, ...o,
});

function seed(event = ev({}), parts: unknown[] = []) {
  fake.db.groups = [{ id: 'g1', name: 'U9-A' }, { id: 'g2', name: 'U11' }];
  fake.db.players = [{ id: 'p9', full_name: 'Новиков Ян', status: 'active', group_id: 'g2' }];
  fake.db.service_payments = [];
  fake.rpc.club_event_list = () => [event];
  fake.rpc.club_event_get = () => event;
  fake.rpc.club_event_participants_list = () => parts;
}
const PARTS = [
  part({}),
  part({ id: 'pt2', player_id: 'p2', full_name: 'Петров Сергей', counted: 150, debt: 0, overpay: 50, pay_state: 'overpaid' }),
  part({ id: 'pt3', player_id: 'p3', full_name: 'Сидоров Ян', counted: 100, debt: 0, pay_state: 'paid', not_in_group: true }),
  part({ id: 'pt4', player_id: 'p4', full_name: 'Отменённый Олег', status: 'cancelled', counted: 40, debt: 60, pay_state: 'debt' }),
];
const open = async (name = 'Турнир Осень') => { render(<ClubEvents />); fireEvent.click(await screen.findByText(name)); await screen.findByRole('tab', { name: 'Участники' }); };
const openPerson = async (name: string, cancelled = false) => {
  await open();
  if (cancelled) fireEvent.click(screen.getByRole('tab', { name: 'Отменённые' }));
  fireEvent.click(await screen.findByText(name));
};

describe('UI1/UI10: раздел в админ-меню', () => {
  it('«Мероприятия» — отдельный пункт рядом с «Матчи/События»; «События» не изменились', () => {
    const ids = SECTIONS.map(s => s.id as string);
    expect(ids.indexOf('clubevents')).toBe(ids.indexOf('cmatches') + 1);
    expect(SECTIONS.find(s => s.id === 'clubevents')?.title).toBe('Мероприятия');
    expect(SECTIONS.find(s => s.id === 'cmatches')?.sub).toBe('События, матчи, составы и взносы');
    expect(DEFAULT_BAR).toEqual(['sessions', 'players', 'money', 'cmatches']);
    expect(parseBar('{"bar":["clubevents","money"]}')).toEqual(['clubevents', 'money']);
    expect(restorableEntry('section', { id: 'clubevents' })).toBe(true);
    expect(restorableEntry('ce.event', { id: 'e1' })).toBe(false); // открытая запись с данными не восстанавливается
  });
});

describe('UI6/UI19/UI9/UI18/UI13: список', () => {
  it('активные, лимит, свободные, превышение; статусы текстом; без сумм; время необязательно', async () => {
    fake.rpc.club_event_list = () => [
      ev({}),
      ev({ id: 'e2', name: 'Без лимита', capacity: null, free_places: null, active_count: 2, status: 'draft', starts_on: '2026-12-21', starts_time: '18:00:00' }),
      ev({ id: 'e3', name: 'Переполнено', capacity: 2, free_places: 0, active_count: 3, over_limit: true, status: 'finished' }),
      ev({ id: 'e4', name: 'Отмена', status: 'cancelled' }),
    ];
    render(<ClubEvents />);
    expect((await screen.findAllByText('Участников: 3 · Лимит: 10 · Свободно: 7')).length).toBeGreaterThan(0);
    expect(screen.getByText('Участников: 2 · Без лимита')).toBeInTheDocument();
    expect(screen.getByText('Превышение лимита')).toBeInTheDocument();
    for (const t of ['Активное', 'Черновик', 'Завершённое', 'Отменённое']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText('21.12.2026 · 18:00 · Стадион')).toBeInTheDocument();
    expect(screen.getAllByText('20.12.2026 · Стадион').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/₾/);
  });
  it('цвета статусов: Активное зелёное, Черновик синее, Завершённое нейтральное, Отменённое красное', async () => {
    fake.rpc.club_event_list = () => [ev({ status: 'active' }), ev({ id: 'b', name: 'B', status: 'draft' }), ev({ id: 'c', name: 'C', status: 'finished' }), ev({ id: 'd', name: 'D', status: 'cancelled' })];
    render(<ClubEvents />);
    await screen.findByText('Активное');
    expect(screen.getByText('Активное').className).toContain('success');
    expect(screen.getByText('Черновик').className).toContain('primary');
    expect(screen.getByText('Завершённое').className).not.toMatch(/success|primary|danger|warning/);
    expect(screen.getByText('Отменённое').className).toContain('danger');
  });
});

describe('форма: создание и правка', () => {
  it('создание: время можно оставить пустым, группы не выбраны = весь клуб', async () => {
    seed();
    fake.rpc.club_event_create = () => 'new-id';
    render(<ClubEvents />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новое мероприятие' }));
    const save = await screen.findByRole('button', { name: 'Создать' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Пикник' } });
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-12-25' } });
    fireEvent.change(screen.getByLabelText('Цена, ₾'), { target: { value: '15,5' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(fake.rpcCalls('club_event_create')).toHaveLength(1));
    expect(fake.rpcCalls('club_event_create')[0]).toMatchObject({ p_name: 'Пикник', p_date: '2026-12-25', p_time: null, p_price: 15.5, p_capacity: null, p_group_ids: [], p_status: 'draft' });
  });

  it('UI7/UI2: смена даты при записанных — предупреждение с числом, без подтверждения ничего не применено, с подтверждением применяется', async () => {
    seed(ev({}), PARTS);
    const calls: boolean[] = [];
    fake.rpc.club_event_update = (a: { p_confirm: boolean }) => { calls.push(a.p_confirm); return a.p_confirm ? { applied: true, warnings: [] } : { applied: false, warnings: [{ code: 'date_change', affected: 3 }] }; };
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(await screen.findByLabelText('Дата'), { target: { value: '2026-12-27' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText(/3/)).toBeInTheDocument();
    expect(calls).toEqual([false]);
    fireEvent.click(dlg.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(calls).toEqual([false, true]));
    expect(fake.rpcCalls('club_event_update')[1]).toMatchObject({ p_id: 'e1', p_confirm: true });
  });

  it('снижение лимита ниже активных — предупреждение и подтверждение', async () => {
    seed(ev({}), PARTS);
    fake.rpc.club_event_update = (a: { p_confirm: boolean }) => (a.p_confirm ? { applied: true, warnings: [] } : { applied: false, warnings: [{ code: 'capacity_below_active', active: 3, capacity: 2, over: 1 }] });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(await screen.findByLabelText('Лимит мест'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText(/лимит/i)).toBeInTheDocument();
    fireEvent.click(dlg.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_update')).toHaveLength(2));
  });

  it('UI3: смена цены требует причину не короче 3 символов до отправки', async () => {
    seed(ev({}), PARTS);
    fake.rpc.club_event_update = () => ({ applied: true, warnings: [] });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(await screen.findByLabelText('Цена, ₾'), { target: { value: '120' } });
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Причина изменения цены (обязательно)'), { target: { value: 'ab' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Причина изменения цены (обязательно)'), { target: { value: 'новая смета' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(fake.rpcCalls('club_event_update')).toHaveLength(1));
    expect(fake.rpcCalls('club_event_update')[0]).toMatchObject({ p_reason: 'новая смета', p_patch: { base_price: 120 } });
  });
});

describe('UI17: действия по статусам', () => {
  const buttons = async (status: string) => {
    seed(ev({ status }), []);
    await open();
    return ['Сделать активным', 'Завершить', 'Отменить', 'Активировать снова', 'Редактировать'].filter(n => screen.queryByRole('button', { name: n }));
  };
  it('черновик: только «Сделать активным» и «Редактировать»', async () => expect(await buttons('draft')).toEqual(['Сделать активным', 'Редактировать']));
  it('активное: «Завершить», «Отменить»', async () => expect(await buttons('active')).toEqual(['Завершить', 'Отменить', 'Редактировать']));
  it('отменённое: «Активировать снова»', async () => expect(await buttons('cancelled')).toEqual(['Активировать снова', 'Редактировать']));
  it('завершённое: без смены статуса, «Редактировать» остаётся', async () => expect(await buttons('finished')).toEqual(['Редактировать']));

  it('UI12/M2: окно отмены без возврата; подтверждение шлёт club_event_set_status', async () => {
    seed(ev({}), []);
    fake.rpc.club_event_set_status = () => null;
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText('Записи и платежи сохранятся. Возвраты в приложении недоступны.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Возврат автоматически|вернуть/i);
    fireEvent.click(dlg.getByRole('button', { name: 'Отменить мероприятие' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_set_status')).toEqual([{ p_id: 'e1', p_to: 'cancelled' }]));
  });
});

describe('участники: UI5/UI14', () => {
  it('долг и переплата раздельно, без сортировки по успехам; не из группы — отметка', async () => {
    seed(ev({}), PARTS);
    await open();
    expect(screen.getByText('Долг 100 ₾')).toBeInTheDocument();
    expect(screen.getByText('Переплата 50 ₾')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText('Не из группы мероприятия')).toBeInTheDocument();
    expect(screen.queryByText('Отменённый Олег')).not.toBeInTheDocument();
    expect(screen.queryByText(/-\d+ ₾/)).not.toBeInTheDocument(); // отрицательного остатка нет
    expect(screen.getAllByText('Активна')).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: 'Отменённые' }));
    expect(screen.getByText('Отменённый Олег')).toBeInTheDocument();
    expect(screen.getByText('Отменена')).toBeInTheDocument();
    expect(screen.getByText('Долг 60 ₾')).toBeInTheDocument();
  });

  it('вкладка «Финансы»: принято, долг и переплата отдельными суммами; без кнопок правки платежей (UI12)', async () => {
    seed(ev({}), PARTS);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Финансы' }));
    expect(await screen.findByText('Принято: 290 ₾')).toBeInTheDocument();
    expect(screen.getByText('Долг: 160 ₾')).toBeInTheDocument();
    expect(screen.getByText('Переплата: 50 ₾')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Изменить|Удалить|Отменить платёж|Вернуть|Перенести/ })).toBeNull();
  });
});

describe('добавление игрока и группы', () => {
  it('игрок не из группы: предупреждение, затем подтверждение шлёт p_confirm=true', async () => {
    seed(ev({}), []);
    fake.rpc.club_event_participant_add = (a: { p_confirm: boolean }) => (a.p_confirm ? { applied: true, warnings: [{ code: 'not_in_group' }] } : { applied: false, warnings: [{ code: 'not_in_group' }] });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить игрока' }));
    fireEvent.change(await screen.findByLabelText('Поиск игрока'), { target: { value: 'Нов' } });
    fireEvent.click(await screen.findByText('Новиков Ян'));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText(/не из групп/i)).toBeInTheDocument();
    fireEvent.click(dlg.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_participant_add')).toHaveLength(2));
    expect(fake.rpcCalls('club_event_participant_add')[1]).toEqual({ p_event: 'e1', p_player: 'p9', p_confirm: true });
  });

  it('UI15: группа — список перед добавлением, пропущенные с пометкой; добавление одним вызовом', async () => {
    seed(ev({}), []);
    fake.rpc.club_event_group_preview = () => ({ add_count: 2, active: 3, capacity: 10, over_limit: false,
      to_add: [{ player_id: 'a', full_name: 'Алиев Ким' }, { player_id: 'b', full_name: 'Борисов Лев' }],
      skipped: [{ player_id: 'c', full_name: 'Уже Тут', reason: 'already' }, { player_id: 'd', full_name: 'Не Занимается', reason: 'not_active' }] });
    fake.rpc.club_event_group_add = () => ({ applied: true, added: 2 });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить группу' }));
    fireEvent.change(await screen.findByLabelText('Группа'), { target: { value: 'g1' } });
    expect(await screen.findByText('Будет добавлено: 2')).toBeInTheDocument();
    expect(screen.getByText('Алиев Ким')).toBeInTheDocument();
    expect(screen.getByText('Уже участвует')).toBeInTheDocument();
    expect(screen.getByText('Не занимается')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить 2' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_group_add')).toEqual([{ p_event: 'e1', p_group: 'g1' }]));
  });

  it('UI15: при превышении лимита операция отказана целиком, кнопка неактивна, сообщение в форме', async () => {
    seed(ev({}), []);
    fake.rpc.club_event_group_preview = () => ({ add_count: 9, active: 3, capacity: 10, over_limit: true, to_add: [{ player_id: 'a', full_name: 'Алиев Ким' }], skipped: [] });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить группу' }));
    fireEvent.change(await screen.findByLabelText('Группа'), { target: { value: 'g1' } });
    expect(await screen.findByText(/Лимит будет превышен/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить 9' })).toBeDisabled();
  });
});

describe('карточка участника', () => {
  it('UI16/UI8: цена активной записи — предупреждение о переплате не блокирует; причина обязательна', async () => {
    seed(ev({}), PARTS);
    fake.rpc.club_event_participant_set_price = () => ({ applied: true, price: 50, counted: 150, overpay: 100 });
    await openPerson('Петров Сергей');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить цену' }));
    expect(screen.getByText('Засчитано: 150 ₾')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Новая цена, ₾'), { target: { value: '50' } });
    expect(screen.getByText('Возникнет переплата 100 ₾')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Сохранить цену' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Причина (обязательно)'), { target: { value: 'скидка' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(fake.rpcCalls('club_event_participant_set_price')).toEqual([{ p_participant: 'pt2', p_price: 50, p_reason: 'скидка' }]));
  });

  it('UI16/PR12: у отменённой записи «Изменить цену» доступна, ниже засчитанного поле не принимается', async () => {
    seed(ev({}), PARTS);
    await openPerson('Отменённый Олег', true);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить цену' }));
    fireEvent.change(screen.getByLabelText('Новая цена, ₾'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Причина (обязательно)'), { target: { value: 'закрыть долг' } });
    expect(screen.getByText('Не ниже засчитанного: 40 ₾')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить цену' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Новая цена, ₾'), { target: { value: '40' } });
    expect(screen.getByRole('button', { name: 'Сохранить цену' })).not.toBeDisabled();
  });

  it('отмена и восстановление записи', async () => {
    seed(ev({}), PARTS);
    fake.rpc.club_event_participant_cancel = () => ({ applied: true });
    await openPerson('Иванов Пётр');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись' }));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText(/Платежи сохранятся/)).toBeInTheDocument();
    fireEvent.click(dlg.getByRole('button', { name: 'Отменить запись' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_participant_cancel')).toEqual([{ p_participant: 'pt1' }]));
  });

  it('UI11/UI4: оплата в два шага, без значения способа по умолчанию, дата по умолчанию сегодня', async () => {
    seed(ev({}), PARTS);
    fake.rpc.club_event_pay = () => ({ applied: true, payment_id: 'x', price: 100, counted: 40, debt: 60, overpay: 0, overpay_added: 0 });
    await openPerson('Иванов Пётр');
    const method = screen.getByLabelText('Способ') as HTMLSelectElement;
    expect(method.value).toBe('');
    expect((screen.getByLabelText('Дата платежа') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const check = screen.getByRole('button', { name: 'Проверить и записать' });
    fireEvent.change(screen.getByLabelText('Сумма, ₾'), { target: { value: '40' } });
    expect(check).toBeDisabled();
    fireEvent.change(method, { target: { value: 'Наличные' } });
    expect(check).not.toBeDisabled();
    fireEvent.click(check);
    const dlg = within(await screen.findByRole('dialog'));
    for (const t of ['Иванов Пётр', 'Турнир Осень', '40 ₾', 'Наличные']) expect(dlg.getByText(t)).toBeInTheDocument();
    expect(dlg.getByText('Запись нельзя изменить или удалить.')).toBeInTheDocument();
    expect(fake.rpcCalls('club_event_pay')).toHaveLength(0);
    fireEvent.click(dlg.getByRole('button', { name: 'Отмена' }));
    expect(fake.rpcCalls('club_event_pay')).toHaveLength(0);
    fireEvent.click(check);
    const dlg2 = within(await screen.findByRole('dialog'));
    fireEvent.click(dlg2.getByRole('button', { name: 'Записать' }));
    fireEvent.click(dlg2.getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_pay')).toHaveLength(1));
    expect(fake.rpcCalls('club_event_pay')[0]).toMatchObject({ p_event: 'e1', p_player: 'p1', p_amount: 40, p_method: 'Наличные' });
    expect(fake.rpcCalls('club_event_pay')[0].p_request).toBeTruthy();
  });

  it('UI11: повтор после сбоя сети идёт с тем же request_id; после успеха ключ новый', async () => {
    seed(ev({}), PARTS);
    let n = 0;
    fake.rpc.club_event_pay = () => (++n === 1 ? { error: { message: 'Failed to fetch' } } : { applied: true, payment_id: 'x', price: 100, counted: 40, debt: 60, overpay: 0, overpay_added: 0 });
    await openPerson('Иванов Пётр');
    const go = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Проверить и записать' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    };
    fireEvent.change(screen.getByLabelText('Сумма, ₾'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Способ'), { target: { value: 'Перевод' } });
    await go();
    await waitFor(() => expect(fake.rpcCalls('club_event_pay')).toHaveLength(1));
    await screen.findByText('Failed to fetch');
    await go();
    await waitFor(() => expect(fake.rpcCalls('club_event_pay')).toHaveLength(2));
    const [a, b] = fake.rpcCalls('club_event_pay');
    expect(a.p_request).toBe(b.p_request);
    await waitFor(() => expect((screen.getByLabelText('Сумма, ₾') as HTMLInputElement).value).toBe(''));
    fireEvent.change(screen.getByLabelText('Сумма, ₾'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Способ'), { target: { value: 'Перевод' } });
    await go();
    await waitFor(() => expect(fake.rpcCalls('club_event_pay')).toHaveLength(3));
    expect(fake.rpcCalls('club_event_pay')[2].p_request).not.toBe(a.p_request);
  });

  it('UI14: после платежа с переплатой показана строка «Переплата X ₾»', async () => {
    seed(ev({}), PARTS);
    fake.rpc.club_event_pay = () => ({ applied: true, payment_id: 'x', price: 100, counted: 130, debt: 0, overpay: 30, overpay_added: 30 });
    await openPerson('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Сумма, ₾'), { target: { value: '130' } });
    fireEvent.change(screen.getByLabelText('Способ'), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и записать' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('Переплата 30 ₾')).toBeInTheDocument();
  });

  it('UI4: оплата недоступна для отменённой записи и вне активного/завершённого мероприятия', async () => {
    seed(ev({}), PARTS);
    await openPerson('Отменённый Олег', true);
    expect(screen.getByRole('button', { name: 'Проверить и записать' })).toBeDisabled();
    expect(screen.getByText('У отменённой записи оплата не принимается.')).toBeInTheDocument();
  });
  it('UI4: черновик не принимает оплаты', async () => {
    seed(ev({ status: 'draft' }), PARTS);
    await openPerson('Иванов Пётр');
    expect(screen.getByRole('button', { name: 'Проверить и записать' })).toBeDisabled();
    expect(screen.getByText('Оплаты принимаются в активном и завершённом мероприятии.')).toBeInTheDocument();
  });

  it('UI12: история платежей без кнопок правки; показывает дату, способ и сумму', async () => {
    seed(ev({}), PARTS);
    fake.db.service_payments = [
      { id: 's1', kind: 'event', ref_id: 'e1', player_id: 'p2', amount: 150, paid_on: '2026-11-18', method: 'Перевод', op: 'payment', recorded_at: '2026-11-18T10:00:00Z' },
      { id: 's2', kind: 'event', ref_id: 'e2', player_id: 'p2', amount: 7, paid_on: '2026-11-18', method: 'Наличные', op: 'payment', recorded_at: '2026-11-18T10:00:00Z' },
    ];
    await openPerson('Петров Сергей');
    expect(await screen.findByText('18.11.2026 · Перевод · 150 ₾')).toBeInTheDocument();
    expect(screen.queryByText(/7 ₾/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Удалить|Отменить платёж|Вернуть|Перенести/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Изменить$/ })).toBeNull();
  });

  it('ошибка базы показывается понятным текстом', async () => {
    seed(ev({}), PARTS);
    fake.rpc.club_event_pay = () => ({ error: { message: 'event not open for payments' } });
    await openPerson('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Сумма, ₾'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Способ'), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и записать' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('Оплаты принимаются только в активном или завершённом мероприятии.')).toBeInTheDocument();
  });
});

describe('замечания ревью #742', () => {
  afterEach(() => vi.useRealTimers());

  it('гонка предпросмотра: поздний ответ группы A не подменяет выбранную группу B', async () => {
    seed(ev({}), []);
    const done: Record<string, (v: unknown) => void> = {};
    fake.rpc.club_event_group_preview = (a: { p_group: string }) => new Promise(res => { done[a.p_group] = res; });
    fake.rpc.club_event_group_add = () => ({ applied: true, added: 1 });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить группу' }));
    const sel = await screen.findByLabelText('Группа');
    fireEvent.change(sel, { target: { value: 'g1' } });
    fireEvent.change(sel, { target: { value: 'g2' } });
    const pv = (n: string, c: number) => ({ add_count: c, active: 0, capacity: 10, over_limit: false, to_add: [{ player_id: n, full_name: n }], skipped: [] });
    await waitFor(() => expect(Object.keys(done)).toHaveLength(2));
    done.g2(pv('Игрок группы B', 1)); // B отвечает первым
    expect(await screen.findByText('Игрок группы B')).toBeInTheDocument();
    done.g1(pv('Игрок группы A', 5)); // A приходит позже
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Игрок группы A')).toBeNull();
    expect(screen.getByText('Будет добавлено: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить 1' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_group_add')).toEqual([{ p_event: 'e1', p_group: 'g2' }]));
  });

  it('ошибка чтения журнала платежей не выдаётся за «Платежей пока нет»; есть повтор', async () => {
    seed(ev({}), PARTS);
    fake.errors.service_payments = 'permission denied';
    await openPerson('Иванов Пётр');
    expect(await screen.findByText(/Не удалось загрузить платежи/)).toBeInTheDocument();
    expect(screen.queryByText('Платежей пока нет.')).toBeNull();
    delete fake.errors.service_payments;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Платежей пока нет.')).toBeInTheDocument();
  });

  it('дата платежа по умолчанию и граница — по Тбилиси, а не по часовому поясу устройства', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-05T21:30:00Z') }); // в Тбилиси уже 06.12
    seed(ev({}), PARTS);
    await openPerson('Иванов Пётр');
    const d = screen.getByLabelText('Дата платежа') as HTMLInputElement;
    expect(d.value).toBe('2026-12-06');
    expect(d.max).toBe('2026-12-06');
  });
});

describe('замечания Павла после слияния (19.11)', () => {
  it('возврат из формы в список не показывает «Загрузка»: данные берутся из кэша и тихо обновляются', async () => {
    seed();
    render(<ClubEvents />);
    await screen.findByText('Турнир Осень');
    fireEvent.click(screen.getByRole('button', { name: 'Новое мероприятие' }));
    await screen.findByRole('button', { name: 'Создать' });
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Турнир Осень')).toBeInTheDocument(); // сразу, без ожидания ответа базы
    expect(screen.queryByRole('status', { name: 'Загрузка' })).toBeNull();
  });

  it('чек-боксы групп — как в остальном приложении (класс ks-check, крупная область нажатия)', async () => {
    seed();
    render(<ClubEvents />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новое мероприятие' }));
    const box = await screen.findByRole('checkbox', { name: 'U9-A' });
    expect(box.closest('label')?.className).toContain('ks-check');
  });
});

describe('UI20: удаление черновика (скрытие)', () => {
  it('у пустого черновика кнопка есть; подтверждение, вызов club_event_delete_draft, возврат в список без этого мероприятия', async () => {
    const draft = ev({ status: 'draft', active_count: 0, free_places: 10 });
    seed(draft, []);
    fake.rpc.club_event_delete_draft = () => { fake.rpc.club_event_list = () => []; return { applied: true }; }; // как база: после скрытия в списке его нет
    render(<ClubEvents />);
    fireEvent.click(await screen.findByText('Турнир Осень'));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить черновик' }));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText('Мероприятие исчезнет из списка. История изменений сохранится.')).toBeInTheDocument();
    fireEvent.click(dlg.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(fake.rpcCalls('club_event_delete_draft')).toEqual([{ p_id: 'e1' }]));
    expect(await screen.findByRole('button', { name: 'Новое мероприятие' })).toBeInTheDocument();
    expect(screen.queryByText('Турнир Осень')).toBeNull();
  });

  it('отказ «Отмена» ничего не вызывает', async () => {
    seed(ev({ status: 'draft' }), []);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить черновик' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(fake.rpcCalls('club_event_delete_draft')).toHaveLength(0);
  });

  it.each([['active'], ['finished'], ['cancelled']])('у мероприятия «%s» кнопки нет', async status => {
    seed(ev({ status }), []);
    await open();
    expect(screen.queryByRole('button', { name: 'Удалить черновик' })).toBeNull();
  });

  it('у черновика с участниками кнопки нет', async () => {
    seed(ev({ status: 'draft' }), [PARTS[0]]);
    await open();
    expect(screen.queryByRole('button', { name: 'Удалить черновик' })).toBeNull();
  });

  it('ошибка базы показывается понятным текстом, экран остаётся', async () => {
    seed(ev({ status: 'draft' }), []);
    fake.rpc.club_event_delete_draft = () => ({ error: { message: 'event has participants' } });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить черновик' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('У черновика есть участники: удалить его нельзя.')).toBeInTheDocument();
  });
});
