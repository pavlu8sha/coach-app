import { describe, expect, it } from 'vitest';
import { ERR_GENERIC, ERR_NETWORK, userError } from './userError';

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
