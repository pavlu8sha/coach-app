import { describe, expect, it } from 'vitest';
import sql from '../../../db/migrations/0099_payment_info.sql?raw';
import { PAYMENT_DETAILS, PAYMENT_RULES } from './clubInfo';
import { FALLBACK_PAYMENT_INFO, parsePaymentInfo } from './paymentInfo';

const details = FALLBACK_PAYMENT_INFO.details;
const rules = FALLBACK_PAYMENT_INFO.rules;

describe('Реквизиты и правила оплаты: проверка записи из базы (#239)', () => {
  it('корректная запись принимается и берёт дату обновления из базы', () => {
    const p = parsePaymentInfo({ details, rules, updated_at: '2026-11-03T08:00:00Z' });
    expect(p?.details).toEqual(details);
    expect(p?.updatedAt).toBe('2026-11-03T08:00:00Z');
  });

  it('любая неполадка даёт null: тогда показываются утверждённые значения', () => {
    expect(parsePaymentInfo(null)).toBeNull();
    expect(parsePaymentInfo({ details: details.slice(0, 3), rules })).toBeNull(); // не четыре реквизита
    expect(parsePaymentInfo({ details: [...details.slice(0, 3), { label: 'Другое поле', value: 'x' }], rules })).toBeNull(); // чужое название
    expect(parsePaymentInfo({ details: details.map((d, i) => (i === 1 ? { ...d, value: ' ' } : d)), rules })).toBeNull(); // пустое значение
    expect(parsePaymentInfo({ details, rules: [] })).toBeNull();
    expect(parsePaymentInfo({ details, rules: [{ title: 'A', items: [] }] })).toBeNull();
  });
});

// Начальные значения в миграции 0099 должны дословно совпадать с утверждёнными в lib/clubInfo.
describe('Миграция 0099: начальные значения совпадают с утверждёнными', () => {
  const part = (tag: string) => JSON.parse(sql.slice(sql.indexOf(`$${tag}$`) + tag.length + 2, sql.lastIndexOf(`$${tag}$`)));

  it('реквизиты', () => {
    expect(part('details')).toEqual(PAYMENT_DETAILS.map(({ label, value }) => ({ label, value })));
  });

  it('правила', () => {
    expect(part('rules')).toEqual(PAYMENT_RULES);
  });
});
