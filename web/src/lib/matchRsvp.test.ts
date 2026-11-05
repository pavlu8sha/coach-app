import { describe, expect, it } from 'vitest';
import { fmtWhen, fromTbilisiLocal, responseText, rsvpError, toTbilisiLocal } from './matchRsvp';

describe('RSVP: время и тексты', () => {
  it('показывает время по Тбилиси', () => {
    expect(fmtWhen('2026-11-14T06:00:00Z')).toBe('14.11.2026 10:00');
  });
  it('поле даты и времени переводится туда и обратно в часовом поясе Тбилиси', () => {
    expect(fromTbilisiLocal('2026-11-14T10:00')).toBe('2026-11-14T10:00:00+04:00');
    expect(toTbilisiLocal('2026-11-14T06:00:00Z')).toBe('2026-11-14T10:00');
  });
  it('без ответа — «Не ответил»', () => {
    expect(responseText(null)).toBe('Не ответил');
    expect(responseText('yes')).toBe('Будет');
  });
  it('неизвестная ошибка базы показывается как есть', () => {
    expect(rsvpError('что-то странное')).toBe('что-то странное');
  });
});
