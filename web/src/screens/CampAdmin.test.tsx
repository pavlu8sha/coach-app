import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Camps from './Camps';

// Админский экран сборов, самозапись (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 43-48)
function seed(extra: Record<string, unknown> = {}) {
  fake.db.camps = [{ id: 'c1', name: 'Зимний лагерь', location: 'Бакуриани', starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 0, booking_deadline: null, full_payment_deadline: '2026-12-20', active: true, capacity: 20, slug: 'zima', ...extra }];
  fake.db.camp_tariffs = [{ id: 't1', camp_id: 'c1', name: 'Футболист', price: 850, active: true }];
  fake.db.camp_participants = [
    { id: 'cp1', camp_id: 'c1', player_id: 'p1', tariff_id: 't1', amount: 850, tshirt_size: null, comment: null, status: 'registered', players: { full_name: 'Иванов Пётр', groups: { name: 'U9-A' } }, camp_tariffs: { name: 'Футболист' }, camp_payments: [{ id: 'pay1', amount: 500, paid_on: '2026-11-01', kind: 'payment', method: 'Наличные', comment: null }] },
    { id: 'cp2', camp_id: 'c1', player_id: 'p2', tariff_id: 't1', amount: 850, tshirt_size: null, comment: null, status: 'cancelled', players: { full_name: 'Сидоров Ян', groups: { name: 'U9-B' } }, camp_tariffs: { name: 'Футболист' }, camp_payments: [{ id: 'pay2', amount: 300, paid_on: '2026-11-02', kind: 'payment', method: 'Наличные', comment: null }] },
  ];
  fake.db.camp_applications = [
    { id: 'a1', camp_id: 'c1', child_name: 'Гость Новый', child_birth: '2015-03-04', parent_name: 'Мама Гостя', parent_phone: '555 11 22 33', tariff_id: 't1', comment: 'Вратарь', status: 'new', created_at: '2026-11-10T08:00:00Z', decision_note: null, camp_tariffs: { name: 'Футболист' } },
    { id: 'a2', camp_id: 'c1', child_name: 'Гость Принятый', child_birth: '2014-01-01', parent_name: 'Папа', parent_phone: '555 00 00 00', tariff_id: 't1', comment: null, status: 'approved', created_at: '2026-11-09T08:00:00Z', decision_note: 'Ждём', camp_tariffs: { name: 'Футболист' } },
  ];
  fake.db.camp_cancel_terms = [{ id: 'k1', camp_id: 'c1', version: 2, periods: [{ from: null, to: '2026-12-01', text: 'Возврат полный' }, { from: '2026-12-02', to: null, text: 'Возврат 50%' }], created_at: '2026-11-01T00:00:00Z' }];
  fake.rpc.camp_seats = () => 18;
}

async function openCamp(tab?: string) {
  render(<Camps />);
  fireEvent.click(await screen.findByText('Зимний лагерь'));
  if (tab) fireEvent.click(await screen.findByRole('tab', { name: tab }));
}

describe('Админ: заявки (условие 43)', () => {
  it('показывает заявки: новая сверху, у решённой нет кнопок', async () => {
    seed();
    await openCamp('Заявки');
    expect(await screen.findByText('Гость Новый')).toBeInTheDocument();
    expect(screen.getByText(/555 11 22 33/)).toBeInTheDocument();
    expect(screen.getByText(/Вратарь/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Принять' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Отклонить' })).toHaveLength(1);
    const names = screen.getAllByTestId('application').map(e => e.textContent ?? '');
    expect(names[0]).toContain('Гость Новый');
    expect(names[1]).toContain('Гость Принятый');
  });
  it('принятие: комментарий и подтверждение, вызывается camp_application_decide', async () => {
    seed();
    fake.rpc.camp_application_decide = () => 'p-new';
    await openCamp('Заявки');
    fireEvent.change(await screen.findByLabelText('Комментарий к решению'), { target: { value: 'Добро пожаловать' } });
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }));
    expect(fake.rpcCalls('camp_application_decide')).toHaveLength(0);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Принять заявку' }));
    await waitFor(() => expect(fake.rpcCalls('camp_application_decide')).toHaveLength(1));
    expect(fake.rpcCalls('camp_application_decide')[0]).toEqual({ aid: 'a1', approve: true, note: 'Добро пожаловать' });
  });
  it('отклонение без комментария передаёт null; ошибка базы показывается текстом', async () => {
    seed();
    fake.rpc.camp_application_decide = () => ({ error: { message: 'already decided' } });
    await openCamp('Заявки');
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отклонить заявку' }));
    await waitFor(() => expect(fake.rpcCalls('camp_application_decide')[0]).toEqual({ aid: 'a1', approve: false, note: null }));
    expect(await screen.findByText('Заявка уже решена.')).toBeInTheDocument();
  });
  it('нехватка мест при принятии показывается понятным текстом', async () => {
    seed();
    fake.rpc.camp_application_decide = () => ({ error: { message: 'camp full' } });
    await openCamp('Заявки');
    fireEvent.click(await screen.findByRole('button', { name: 'Принять' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Принять заявку' }));
    expect(await screen.findByText('На сборе нет свободных мест.')).toBeInTheDocument();
  });
});

describe('Админ: настройки и условия отмены (условия 44-45)', () => {
  it('показывает лимит, ссылку и свободные места', async () => {
    seed();
    await openCamp('Настройки');
    expect(await screen.findByLabelText('Лимит мест')).toHaveValue(20);
    expect(screen.getByLabelText('Имя ссылки')).toHaveValue('zima');
    expect(screen.getByText('https://t.me/kicksapp?startapp=camp_zima')).toBeInTheDocument();
    expect(await screen.findByText('Свободно мест: 18')).toBeInTheDocument();
    expect(fake.rpcCalls('camp_seats')[0]).toEqual({ cid: 'c1' });
  });
  it('сохранение: лимит и имя ссылки уходят в camp_set_public; пустой лимит значит без лимита', async () => {
    seed();
    fake.rpc.camp_set_public = () => null;
    await openCamp('Настройки');
    fireEvent.change(await screen.findByLabelText('Лимит мест'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Имя ссылки'), { target: { value: ' Zima-2027 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(fake.rpcCalls('camp_set_public')).toHaveLength(1));
    expect(fake.rpcCalls('camp_set_public')[0]).toEqual({ cid: 'c1', sl: 'zima-2027', cap: null });
  });
  it('пустое имя убирает ссылку (передаётся пустая строка); ссылка не показывается', async () => {
    seed();
    fake.rpc.camp_set_public = () => null;
    await openCamp('Настройки');
    fireEvent.change(await screen.findByLabelText('Имя ссылки'), { target: { value: '' } });
    expect(screen.queryByText(/startapp=camp_/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(fake.rpcCalls('camp_set_public')[0]).toEqual({ cid: 'c1', sl: '', cap: 20 }));
  });
  it('лимит ниже числа записанных и неверное имя показываются текстом; неверное число не отправляется', async () => {
    seed();
    fake.rpc.camp_set_public = () => ({ error: { message: 'capacity below registered' } });
    await openCamp('Настройки');
    fireEvent.change(await screen.findByLabelText('Лимит мест'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(await screen.findByText('Лимит не может быть меньше числа подтверждённых участников.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Лимит мест'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Лимит мест'), { target: { value: '2.5' } });
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled();
  });
  it('условия отмены: текущая версия показана, новая версия сохраняется через camp_terms_save', async () => {
    seed();
    fake.rpc.camp_terms_save = () => 3;
    await openCamp('Настройки');
    expect(await screen.findByText('Версия условий: 2')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Текст периода')).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText('Текст периода')[1], { target: { value: 'Возврат 30%' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить период' }));
    expect(screen.getAllByLabelText('Текст периода')).toHaveLength(3);
    fireEvent.change(screen.getAllByLabelText('Текст периода')[2], { target: { value: 'Возврата нет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить условия' }));
    expect(await screen.findByText('Условия сохранены, версия 3.')).toBeInTheDocument();
    expect(fake.rpcCalls('camp_terms_save')[0]).toEqual({
      cid: 'c1',
      periods: [{ from: null, to: '2026-12-01', text: 'Возврат полный' }, { from: '2026-12-02', to: null, text: 'Возврат 30%' }, { from: null, to: null, text: 'Возврата нет' }],
    });
  });
  it('период с пустым текстом не сохраняется', async () => {
    seed();
    await openCamp('Настройки');
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить период' }));
    expect(screen.getByRole('button', { name: 'Сохранить условия' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Убрать период' })[2]);
    expect(screen.getByRole('button', { name: 'Сохранить условия' })).not.toBeDisabled();
  });
});

describe('Админ: документы (условие 46)', () => {
  const docs = [
    { id: 'd2', doc_id: 'g1', title: 'Программа', version: 2, status: 'ready', size_bytes: 2048, uploaded_by: 'u', created_at: '2026-11-10T08:00:00Z', ready_at: '2026-11-10T08:00:05Z', removed_at: null },
    { id: 'd1', doc_id: 'g1', title: 'Программа', version: 1, status: 'ready', size_bytes: 1024, uploaded_by: 'u', created_at: '2026-11-09T08:00:00Z', ready_at: '2026-11-09T08:00:05Z', removed_at: null },
    { id: 'd3', doc_id: 'g2', title: 'Сорвалась', version: 1, status: 'failed', size_bytes: 1000, uploaded_by: 'u', created_at: '2026-11-08T08:00:00Z', ready_at: null, removed_at: null },
  ];
  const pdf = (name = 'prog.pdf', size = 1000, type = 'application/pdf') => {
    const f = new File([new Uint8Array(8)], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  it('список версий с состоянием', async () => {
    seed();
    fake.rpc.camp_document_admin_list = () => docs;
    await openCamp('Документы');
    expect(await screen.findAllByText(/Программа/)).toHaveLength(2);
    expect(fake.rpcCalls('camp_document_admin_list')[0]).toEqual({ cid: 'c1' });
    expect(screen.getByText(/версия 2/)).toBeInTheDocument();
    expect(screen.getByText(/не загружен/)).toBeInTheDocument();
  });
  it('загрузка PDF: запрос в функцию camp-docs с токеном, названием и сбором', async () => {
    seed();
    fake.rpc.camp_document_admin_list = () => [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'new' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await openCamp('Документы');
    fireEvent.change(await screen.findByLabelText('Название документа'), { target: { value: ' Памятка ' } });
    fireEvent.change(screen.getByLabelText('Файл PDF'), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://fake.supabase/functions/v1/camp-docs?action=upload&camp=c1&title=%D0%9F%D0%B0%D0%BC%D1%8F%D1%82%D0%BA%D0%B0');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(await screen.findByText('Документ загружен.')).toBeInTheDocument();
  });
  it('не PDF и слишком большой файл отклоняются до отправки', async () => {
    seed();
    fake.rpc.camp_document_admin_list = () => [];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await openCamp('Документы');
    fireEvent.change(await screen.findByLabelText('Название документа'), { target: { value: 'Файл' } });
    fireEvent.change(screen.getByLabelText('Файл PDF'), { target: { files: [pdf('a.png', 1000, 'image/png')] } });
    expect(await screen.findByText('Нужен файл PDF.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Файл PDF'), { target: { files: [pdf('big.pdf', 10 * 1024 * 1024 + 1)] } });
    expect(await screen.findByText('Файл больше 10 МБ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('замена: в запрос добавляется replaces; отказ функции показывается текстом', async () => {
    seed();
    fake.rpc.camp_document_admin_list = () => docs;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'too many documents' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await openCamp('Документы');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Заменить' }))[0]);
    fireEvent.change(screen.getByLabelText('Файл PDF'), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить новую версию' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('replaces=d2');
    expect(url).toContain('title=%D0%9F%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B0');
    expect(await screen.findByText('На сборе уже слишком много документов.')).toBeInTheDocument();
  });
  it('снятие: подтверждение, затем camp_document_remove', async () => {
    seed();
    fake.rpc.camp_document_admin_list = () => docs;
    fake.rpc.camp_document_remove = () => null;
    await openCamp('Документы');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Снять' }))[0]);
    expect(fake.rpcCalls('camp_document_remove')).toHaveLength(0);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Снять документ' }));
    await waitFor(() => expect(fake.rpcCalls('camp_document_remove')[0]).toEqual({ did: 'd2' }));
  });
  it('открытие: запрашивается короткоживущая ссылка у camp-docs', async () => {
    seed();
    fake.rpc.camp_document_admin_list = () => docs;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://files.test/x?token=1', expires_in: 60 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const win = { location: { href: '' }, opener: 'x', close: vi.fn() };
    const open = vi.fn(() => win);
    vi.stubGlobal('open', open);
    await openCamp('Документы');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Открыть' }))[0]);
    await waitFor(() => expect(win.location.href).toBe('https://files.test/x?token=1'));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(win.opener).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://fake.supabase/functions/v1/camp-docs');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'link', id: 'd2' });
  });
});

describe('Админ: рассылки (условие 47)', () => {
  const preview = { recipients: 12, messages: 12, list: [{ name: 'Мама Анна' }, { name: 'Папа Анны' }], blocked: [] as { name: string; reason: string }[], sample: 'Сбор «Зимний лагерь»:\nВыезд в 9:00', token: 'tok1', unreachable: null, enabled: true };
  it('отправить нельзя без предпросмотра; предпросмотр показывает число и пример', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => preview;
    await openCamp('Рассылки');
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), { target: { value: 'Выезд в 9:00' } });
    expect(screen.queryByRole('button', { name: /Отправить/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    expect(await screen.findByText('Получателей: 12')).toBeInTheDocument();
    expect(screen.getByText(/Выезд в 9:00/, { selector: 'pre' })).toBeInTheDocument();
    expect(fake.rpcCalls('camp_broadcast_preview')[0]).toEqual({ cid: 'c1', k: 'info', b: 'Выезд в 9:00' });
    expect(screen.getByRole('button', { name: 'Отправить 12 получателям' })).toBeInTheDocument();
  });
  it('правка текста или вида сбрасывает предпросмотр', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => preview;
    await openCamp('Рассылки');
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    await screen.findByText('Получателей: 12');
    fireEvent.change(screen.getByLabelText('Текст рассылки'), { target: { value: 'Текст 2' } });
    expect(screen.queryByText('Получателей: 12')).toBeNull();
    expect(screen.queryByRole('button', { name: /Отправить/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    await screen.findByText('Получателей: 12');
    fireEvent.click(screen.getByRole('tab', { name: 'Напоминание об оплате' }));
    expect(screen.queryByText('Получателей: 12')).toBeNull();
  });
  it('отправка: подтверждение с числом, метка состава и число уходят в camp_broadcast_send', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => preview;
    fake.rpc.camp_broadcast_send = () => ({ id: 'b1', recipients: 12 });
    await openCamp('Рассылки');
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), { target: { value: 'Выезд в 9:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить 12 получателям' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('12')).toBeInTheDocument();
    expect(fake.rpcCalls('camp_broadcast_send')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(fake.rpcCalls('camp_broadcast_send')).toHaveLength(1));
    expect(fake.rpcCalls('camp_broadcast_send')[0]).toEqual({ cid: 'c1', k: 'info', b: 'Выезд в 9:00', expected: 12, tok: 'tok1' });
    expect(await screen.findByText('Рассылка поставлена в очередь: 12.')).toBeInTheDocument();
    expect(screen.queryByText('Получателей: 12')).toBeNull();
  });
  it('напоминание: текст необязателен, показывается число недостижимых должников', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => ({ ...preview, recipients: 3, unreachable: 2 });
    await openCamp('Рассылки');
    fireEvent.click(await screen.findByRole('tab', { name: 'Напоминание об оплате' }));
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    expect(await screen.findByText('Получателей: 3')).toBeInTheDocument();
    expect(screen.getByText('Должников, до которых рассылка не дойдёт: 2')).toBeInTheDocument();
    expect(fake.rpcCalls('camp_broadcast_preview')[0]).toEqual({ cid: 'c1', k: 'reminder', b: null });
  });
  it('при выключенных уведомлениях по сборам отправка недоступна, виден запрет', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => ({ ...preview, enabled: false });
    await openCamp('Рассылки');
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    expect(await screen.findByText(/Уведомления по сборам выключены/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отправить/ })).toBeNull();
  });
  it('отказ базы при отправке (состав изменился) показывается, предпросмотр сбрасывается', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => preview;
    fake.rpc.camp_broadcast_send = () => ({ error: { message: 'recipients changed' } });
    await openCamp('Рассылки');
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить 12 получателям' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Список получателей изменился. Сделайте предпросмотр заново.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отправить/ })).toBeNull();
  });
  it('предпросмотр: список получателей (каждый родитель отдельно) и недоступные с причиной', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => ({ ...preview, blocked: [{ name: 'Папа Борис', reason: 'notifications_off' }, { name: 'Мама Вера', reason: 'daily_limit' }] });
    await openCamp('Рассылки');
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    await screen.findByText('Получателей: 12');
    const list = screen.getByRole('list', { name: 'Получатели' });
    expect(within(list).getAllByRole('listitem').map(e => e.textContent)).toEqual(['Мама Анна', 'Папа Анны']);
    const blocked = screen.getByRole('list', { name: 'Не получат сообщение' });
    expect(within(blocked).getAllByRole('listitem').map(e => e.textContent)).toEqual([
      'Папа Борис: выключены уведомления бота',
      'Мама Вера: уже три сообщения рассылок за сутки',
    ]);
    expect(screen.getByText(/другим членом семьи не заменяются/)).toBeInTheDocument();
  });
  it('результат рассылки по получателям: отправлено, не доставлено с причиной, очищено, ждёт', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [{ id: 'b1', kind: 'info', body: 'Выезд', recipients: 4, author_name: 'Админ', created_at: '2026-11-10T08:00:00Z', pending: 1, sent: 1, failed: 1, cleared: 1 }];
    fake.rpc.camp_broadcast_recipients = () => [
      { name: 'Мама Анна', state: 'sent', error: null },
      { name: 'Папа Борис', state: 'failed', error: 'Forbidden: bot was blocked by the user' },
      { name: 'Мама Вера', state: 'pending', error: null },
      { name: 'Папа Глеб', state: 'cleared', error: null },
    ];
    await openCamp('Рассылки');
    fireEvent.click(await screen.findByRole('button', { name: 'Результат' }));
    const list = await screen.findByRole('list', { name: 'Результат по получателям' });
    expect(fake.rpcCalls('camp_broadcast_recipients')[0]).toEqual({ bid: 'b1' });
    expect(within(list).getAllByRole('listitem').map(e => e.textContent)).toEqual([
      'Мама Анна: отправлено',
      'Папа Борис: не доставлено (Forbidden: bot was blocked by the user)',
      'Мама Вера: ждёт отправки',
      'Папа Глеб: очищено из очереди',
    ]);
  });
  it('подавленные по согласию (skipped): отдельный счётчик журнала и строка результата', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [{ id: 'b3', kind: 'reminder', body: 'Напоминание', recipients: 3, author_name: 'Админ', created_at: '2026-11-10T08:00:00Z', pending: 0, sent: 1, failed: 0, skipped: 1, cleared: 1 }];
    fake.rpc.camp_broadcast_recipients = () => [
      { name: 'Мама Анна', state: 'sent', error: null },
      { name: 'Папа Борис', state: 'skipped', error: 'consent' },
      { name: 'Мама Вера', state: 'cleared', error: null },
    ];
    await openCamp('Рассылки');
    expect(await screen.findByText('Получателей 3: ждёт 0, отправлено 1, не доставлено 0, не отправлено из-за согласия 1, очищено 1')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Результат' }));
    const list = await screen.findByRole('list', { name: 'Результат по получателям' });
    expect(within(list).getAllByRole('listitem').map(e => e.textContent)).toEqual([
      'Мама Анна: отправлено',
      'Папа Борис: не отправлено: нет согласия',
      'Мама Вера: очищено из очереди',
    ]);
  });
  it('повторная отправка той же рассылки отклоняется базой: показан понятный текст и предпросмотр сброшен', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [];
    fake.rpc.camp_broadcast_preview = () => preview;
    fake.rpc.camp_broadcast_send = () => ({ error: { message: 'duplicate broadcast' } });
    await openCamp('Рассылки');
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить 12 получателям' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Такая рассылка уже отправлена. Повторить можно позже.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отправить/ })).toBeNull();
  });
  it('журнал: вид, автор, текст и итоги отправки', async () => {
    seed();
    fake.rpc.camp_broadcast_list = () => [
      { id: 'b1', kind: 'info', body: 'Выезд в 9:00', recipients: 12, author_name: 'Админ', created_at: '2026-11-10T08:00:00Z', pending: 2, sent: 8, failed: 1, cleared: 1 },
      { id: 'b2', kind: 'reminder', body: 'Напоминание об оплате (остаток каждой семьи подставлен автоматически)', recipients: 3, author_name: 'Админ', created_at: '2026-11-09T08:00:00Z', pending: 0, sent: 3, failed: 0, cleared: 0 },
    ];
    await openCamp('Рассылки');
    expect(await screen.findByText(/Выезд в 9:00/)).toBeInTheDocument();
    expect(screen.getByText('Получателей 12: ждёт 2, отправлено 8, не доставлено 1, очищено 1')).toBeInTheDocument();
    expect(screen.getByText('Получателей 3: ждёт 0, отправлено 3, не доставлено 0, очищено 0')).toBeInTheDocument();
  });
});

describe('Админ: возврат и замена (условие 48)', () => {
  async function openPart(name: string) {
    await openCamp();
    fireEvent.click(await screen.findByText(name));
  }
  it('возврат: сумма, дата, комментарий, подтверждение, camp_refund', async () => {
    seed();
    fake.rpc.camp_refund = () => 'r1';
    await openPart('Сидоров Ян');
    fireEvent.change(await screen.findByLabelText('Сумма возврата, ₾'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Комментарий к возврату'), { target: { value: 'По условиям отмены' } });
    fireEvent.click(screen.getByRole('button', { name: 'Оформить возврат' }));
    expect(fake.rpcCalls('camp_refund')).toHaveLength(0);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Вернуть деньги' }));
    await waitFor(() => expect(fake.rpcCalls('camp_refund')).toHaveLength(1));
    const a = fake.rpcCalls('camp_refund')[0];
    expect(a).toMatchObject({ pid: 'cp2', amt: 150, cmt: 'По условиям отмены' });
    expect(a.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('возврат выше внесённого и неверная сумма: кнопка недоступна или показывается ответ базы', async () => {
    seed();
    fake.rpc.camp_refund = () => ({ error: { message: 'refund above paid' } });
    await openPart('Сидоров Ян');
    const btn = await screen.findByRole('button', { name: 'Оформить возврат' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Сумма возврата, ₾'), { target: { value: '-5' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Сумма возврата, ₾'), { target: { value: '999' } });
    fireEvent.click(btn);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Вернуть деньги' }));
    expect(await screen.findByText('Возврат больше внесённой суммы.')).toBeInTheDocument();
  });
  it('без внесённых денег раздела возврата нет', async () => {
    seed();
    (fake.db.camp_participants as Array<Record<string, unknown>>)[1].camp_payments = [];
    await openPart('Сидоров Ян');
    await screen.findByRole('heading', { name: 'Сидоров Ян' });
    expect(screen.queryByRole('button', { name: 'Оформить возврат' })).toBeNull();
  });
  it('замена: у отменившего выбирается записанный участник, camp_replace_participant', async () => {
    seed();
    fake.rpc.camp_replace_participant = () => 'rp1';
    await openPart('Сидоров Ян');
    const sel = await screen.findByLabelText('Кто занял место');
    expect(within(sel).getAllByRole('option').map(o => o.textContent)).toEqual(['Выберите участника', 'Иванов Пётр']);
    fireEvent.change(sel, { target: { value: 'cp1' } });
    fireEvent.change(screen.getByLabelText('Комментарий к замене'), { target: { value: 'Деньги переданы вручную' } });
    fireEvent.click(screen.getByRole('button', { name: 'Оформить замену' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Оформить замену' }));
    await waitFor(() => expect(fake.rpcCalls('camp_replace_participant')[0]).toEqual({ old_pid: 'cp2', new_pid: 'cp1', nt: 'Деньги переданы вручную' }));
  });
  it('у записанного участника раздела замены нет', async () => {
    seed();
    await openPart('Иванов Пётр');
    await screen.findByRole('heading', { name: 'Иванов Пётр' });
    expect(screen.queryByLabelText('Кто занял место')).toBeNull();
  });
});
