import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PaymentInfo from './PaymentInfo';
import PaymentInfoEditor from './PaymentInfoEditor';
import { FALLBACK_PAYMENT_INFO } from '../lib/paymentInfo';

const row = (over: Record<string, unknown> = {}) => ({
  club_id: 'c1',
  details: FALLBACK_PAYMENT_INFO.details.map((d, i) => (i === 2 ? { ...d, value: 'GE00NEW0000000000001' } : d)),
  rules: [{ title: '1. Абонементы', items: ['Новый пункт правил.'] }],
  updated_at: '2026-11-03T08:00:00Z',
  ...over,
});

describe('Реквизиты и правила оплаты: экран родителя читает базу (#239)', () => {
  beforeEach(() => fake.reset());

  it('показывает значения и дату из payment_info', async () => {
    fake.db.payment_info = [row()];
    render(<PaymentInfo />);
    expect(await screen.findByText('GE00NEW0000000000001')).toBeInTheDocument();
    expect(screen.getByText('Новый пункт правил.')).toBeInTheDocument();
    expect(screen.getByText(/обновлены: 3 ноября 2026/)).toBeInTheDocument();
  });

  it('без записи в базе остаются утверждённые значения', async () => {
    render(<PaymentInfo />);
    expect(await screen.findByText('GE11TB7050036080100015')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '4. Сохранение места при длительном отсутствии' })).toBeInTheDocument();
  });

  it('повреждённая запись не ломает экран: запасные значения', async () => {
    fake.db.payment_info = [row({ details: [] })];
    render(<PaymentInfo />);
    expect(await screen.findByText('GE11TB7050036080100015')).toBeInTheDocument();
  });
});

describe('Экран администратора «Реквизиты и правила оплаты» (#239)', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.payment_info = [row()];
  });

  it('показывает значения из базы и сохраняет через payment_info_save', async () => {
    fake.rpc.payment_info_save = () => null;
    render(<PaymentInfoEditor />);
    const iban = await screen.findByLabelText('Beneficiary’s IBAN');
    await waitFor(() => expect(iban).toHaveValue('GE00NEW0000000000001'));
    fireEvent.change(iban, { target: { value: 'GE22TB0000000000000002' } });
    fireEvent.change(screen.getByLabelText('Пункты раздела 1 (каждый с новой строки)'), { target: { value: 'Первый пункт.\n\nВторой пункт.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('payment_info_save')).toHaveLength(1));
    const args = fake.rpcCalls('payment_info_save')[0];
    expect(args.d.map((x: { label: string; value: string }) => x.label)).toEqual(FALLBACK_PAYMENT_INFO.details.map(x => x.label));
    expect(args.d[2].value).toBe('GE22TB0000000000000002');
    expect(args.r).toEqual([{ title: '1. Абонементы', items: ['Первый пункт.', 'Второй пункт.'] }]);
    expect(await screen.findByText(/Сохранено/)).toBeInTheDocument();
  });

  it('пустое значение реквизита не отправляется', async () => {
    render(<PaymentInfoEditor />);
    const bank = await screen.findByLabelText('Bank Code');
    await waitFor(() => expect(bank).toHaveValue('TBCBGE22'));
    fireEvent.change(bank, { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('ошибка прав объясняется понятным текстом', async () => {
    fake.rpc.payment_info_save = () => ({ error: { message: 'forbidden' } });
    render(<PaymentInfoEditor />);
    await screen.findByLabelText('Bank Code');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/правит только администратор/)).toBeInTheDocument();
  });

  it('«Вернуть утверждённые значения» подставляет текст владельца, но не сохраняет сам', async () => {
    render(<PaymentInfoEditor />);
    const iban = await screen.findByLabelText('Beneficiary’s IBAN');
    await waitFor(() => expect(iban).toHaveValue('GE00NEW0000000000001'));
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть утверждённые значения' }));
    expect(screen.getByLabelText('Beneficiary’s IBAN')).toHaveValue('GE11TB7050036080100015');
    expect(screen.getAllByLabelText(/Заголовок раздела/)).toHaveLength(4);
    expect(fake.rpcCalls('payment_info_save')).toHaveLength(0);
  });
});
