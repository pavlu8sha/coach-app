import { describe, expect, it } from 'vitest';
import { ERR_GENERIC, ERR_NETWORK, fallbackError, userError } from './userError';
import { coachError, errMsg } from './coach';

// Условия приёмки: docs/acceptance/link-trial-error-handling-2026-11-20.md №1–3
const known = (m: string) => (m.includes('too many') ? 'Слишком много.' : null);

describe('userError', () => {
  it('известная ошибка даёт прежний текст', () => {
    expect(userError({ message: 'too many pending' }, known)).toBe('Слишком много.');
  });
  it('сетевой сбой (ответ и исключение) даёт «Нет связи»', () => {
    expect(userError({ message: 'TypeError: Failed to fetch' }, known)).toBe(ERR_NETWORK);
    expect(userError(new TypeError('Failed to fetch'), known)).toBe(ERR_NETWORK);
    expect(userError(new Error('Network request timeout'), known)).toBe(ERR_NETWORK);
  });
  it('неизвестная ошибка даёт общий текст без сырого сообщения', () => {
    expect(userError({ message: 'permission denied for function request_link (SQLSTATE 42501)' }, known)).toBe(ERR_GENERIC);
    expect(userError(null, known)).toBe(ERR_GENERIC);
    expect(userError('oops', known)).toBe(ERR_GENERIC);
  });
});

// Условия приёмки: docs/acceptance/user-errors-everywhere-2026-11-20.md №2, №3
describe('fallbackError / coachError / errMsg', () => {
  it('сеть и неизвестное не показываются сырыми', () => {
    expect(fallbackError('TypeError: Failed to fetch')).toBe(ERR_NETWORK);
    expect(fallbackError('permission denied for function x (SQLSTATE 42501)')).toBe(ERR_GENERIC);
    expect(coachError('FetchError: network request failed')).toBe(ERR_NETWORK);
    expect(coachError('relation "players" does not exist')).toBe(ERR_GENERIC);
  });
  it('известное и русское проходит как есть', () => {
    expect(coachError('note required')).toBe('Напишите, за что баллы.');
    expect(coachError('Нельзя удалить игрока с оплатой')).toBe('Нельзя удалить игрока с оплатой');
  });
  it('errMsg принимает ответ { error } и исключение', () => {
    expect(errMsg({ message: 'permission denied for function f (SQLSTATE 42501)' })).toBe('Нет прав на это действие.');
    expect(errMsg({ message: 'note required' })).toBe(ERR_GENERIC); // доменные тексты — у мапперов экранов, не у общей точки
    expect(errMsg({ message: 'TypeError: Failed to fetch' })).toBe(ERR_NETWORK);
    expect(errMsg(new Error('boom'))).toBe(ERR_GENERIC);
    expect(errMsg(null)).toBe(ERR_GENERIC);
  });
});
