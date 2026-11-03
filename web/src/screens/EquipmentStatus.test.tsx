import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EQUIPMENT_REQUIRED_TEXT } from '../lib/equipment';
import { fake } from '../test/fakeSupabase';
import Equipment from './Equipment';
import { EquipmentTab } from './PlayerCardTabs';

type OrderLine = { kit: string; size: string | null; quantity: number };
type Issue = { kit: string; issued_on: string; issued_by: string | null };
const order = (id: string, name: string, status: string, history: { status: string; changed_at: string; changed_by_name: string | null }[] = [], extra: { equipment_order_lines?: OrderLine[]; equipment_issues?: Issue[] } = {}) => ({
  id, player_id: 'p1', ordered_on: '2026-09-10', total: 160, paid: 160, installment: false, number: '7', inscription: null, location: 'Зал',
  status, equipment_order_status_history: history,
  players: { full_name: name },
  equipment_order_lines: [{ kit: 'Форма', size: '128', quantity: 1 }],
  equipment_issues: [],
  ...extra,
});

describe('Экипировка: статусы заказов (#240)', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.equipment_orders = [order('o1', 'Иванов Пётр', 'accepted'), order('o2', 'Сидоров Ян', 'issued', [{ status: 'issued', changed_at: '2026-11-02T09:00:00Z', changed_by_name: 'Админ' }])];
    fake.db.equipment_catalog = [];
  });

  it('в списке виден статус заказа', async () => {
    render(<Equipment />);
    expect(await screen.findByText(/Принят в заказ/)).toBeInTheDocument();
    expect(screen.getByText(/· Выдан ·/)).toBeInTheDocument();
  });

  it('админ переводит заказ на следующий шаг; кнопки «назад» у нового заказа нет', async () => {
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    expect(await screen.findByText('Статус заказа')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Вернуть:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Перевести: Начался пошив' }));
    await waitFor(() => expect(fake.rpcCalls('eq_set_order_status')).toEqual([{ o: 'o1', st: 'sewing' }]));
  });

  it('у выданного заказа нет шага вперёд; возврат назад просит подтверждение и пишет историю через базу', async () => {
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    expect(await screen.findByText('Статус заказа')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Перевести:/ })).not.toBeInTheDocument();
    expect(screen.getByText(/02\.11\.2026 · Выдан · Админ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть: Готов к выдаче' }));
    expect(fake.rpcCalls('eq_set_order_status')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(fake.rpcCalls('eq_set_order_status')).toEqual([{ o: 'o2', st: 'ready' }]));
  });

  it('недопустимый переход: понятное сообщение', async () => {
    fake.rpc.eq_set_order_status = () => ({ error: { message: 'bad transition' } });
    render(<Equipment />);
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.click(await screen.findByRole('button', { name: 'Перевести: Начался пошив' }));
    expect(await screen.findByText(/только на один шаг/)).toBeInTheDocument();
  });

  it('требование к форме: администратор правит текст, сохраняется в club_settings', async () => {
    fake.db.clubs = [{ id: 'c1' }];
    fake.db.club_settings = [{ club_id: 'c1', key: 'equipment.required_text', scope: '', value: 'Старый текст' }];
    render(<Equipment />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Текст' }));
    const ta = await screen.findByLabelText('Требование к форме');
    await waitFor(() => expect(ta).toHaveValue('Старый текст'));
    fireEvent.change(ta, { target: { value: 'Новый текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.writes('club_settings', 'upsert')).toEqual([
      { club_id: 'c1', key: 'equipment.required_text', scope: '', value: 'Новый текст', updated_at: expect.any(String) },
    ]));
  });

  it('без сохранённого текста в редакторе стоит утверждённая формулировка', async () => {
    fake.db.clubs = [{ id: 'c1' }];
    fake.db.club_settings = [];
    render(<Equipment />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Текст' }));
    await waitFor(() => expect(screen.getByLabelText('Требование к форме')).toHaveValue(EQUIPMENT_REQUIRED_TEXT));
  });

  it('утверждённый текст требования — две строки', () => {
    expect(EQUIPMENT_REQUIRED_TEXT.split('\n')).toHaveLength(2);
  });

  it('частичная выдача по количеству: «Частично», а не «Да»', async () => {
    fake.db.equipment_orders = [order('o1', 'Иванов Пётр', 'accepted', [], {
      equipment_order_lines: [{ kit: 'Форма', size: '128', quantity: 2 }],
      equipment_issues: [{ kit: 'Форма', issued_on: '2026-09-11', issued_by: 'Склад' }],
    })];
    render(<Equipment />);
    expect(await screen.findByText(/выдано: Частично/)).toBeInTheDocument();
  });
});

describe('Экипировка у родителя: статус и требование к форме (#240)', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.equipment_orders = [order('o1', 'Аня', 'sewing', [{ status: 'sewing', changed_at: '2026-11-02T09:00:00Z', changed_by_name: 'Админ' }])];
  });

  it('родитель видит статус заказа ребёнка, дату смены и текст требования из базы', async () => {
    fake.rpc.equipment_requirement = () => 'Текст требования от администратора';
    render(<EquipmentTab playerId="p1" />);
    expect(await screen.findByText(/Начался пошив/)).toBeInTheDocument();
    expect(screen.getByText(/с 02\.11\.2026/)).toBeInTheDocument();
    expect(await screen.findByText('Текст требования от администратора')).toBeInTheDocument();
  });

  it('пока база не ответила или текст не задан, показывается утверждённая формулировка', async () => {
    render(<EquipmentTab playerId="p1" />);
    expect(await screen.findByText(EQUIPMENT_REQUIRED_TEXT.replace(/\n/g, ' '))).toBeInTheDocument();
  });

  it('требование видно и когда заказов нет; родитель ничего не пишет в базу', async () => {
    fake.db.equipment_orders = [];
    render(<EquipmentTab playerId="p1" />);
    expect(await screen.findByText(EQUIPMENT_REQUIRED_TEXT.replace(/\n/g, ' '))).toBeInTheDocument();
    expect(await screen.findByText('Заказов нет')).toBeInTheDocument();
    expect(fake.calls.filter(c => c.kind !== 'rpc')).toHaveLength(0);
    expect(fake.rpcCalls('eq_set_order_status')).toHaveLength(0);
  });

  it('родитель видит частичную выдачу по количеству', async () => {
    fake.db.equipment_orders = [order('o1', 'Аня', 'accepted', [], {
      equipment_order_lines: [{ kit: 'Форма', size: '128', quantity: 2 }],
      equipment_issues: [{ kit: 'Форма', issued_on: '2026-09-11', issued_by: 'Склад' }],
    })];
    render(<EquipmentTab playerId="p1" />);
    expect(await screen.findByText(/Выдано:/)).toHaveTextContent('Выдано: 1 из 2');
    expect(screen.queryByText(/\(всё\)/)).not.toBeInTheDocument();
  });
});
