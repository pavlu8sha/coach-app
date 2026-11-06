import { describe, expect, it } from 'vitest';
import { activityLine, matchesFilter, linkLabel, splitLinks, fmtWhen, fromTbilisiLocal, responseText, rsvpError, toTbilisiLocal } from './matchRsvp';

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

  it('ссылки в тексте находятся без знаков препинания в конце', () => {
    expect(splitLinks('Isani, https://maps.app.goo.gl/gYs3zv3sy2W5SLPY8?g_st=ic.')).toEqual([
      { text: 'Isani, ' }, { text: 'https://maps.app.goo.gl/gYs3zv3sy2W5SLPY8?g_st=ic', href: 'https://maps.app.goo.gl/gYs3zv3sy2W5SLPY8?g_st=ic' }, { text: '.' },
    ]);
    expect(splitLinks('без ссылки')).toEqual([{ text: 'без ссылки' }]);
  });
  it('подпись ссылки: карта или сайт', () => {
    expect(linkLabel('https://maps.app.goo.gl/abc')).toBe('Открыть на карте');
    expect(linkLabel('https://www.example.com/x')).toBe('example.com');
  });
});

describe('фильтр сводки и журнал', () => {
  it('matchesFilter: «не ответили» — только без ответа', () => {
    expect(matchesFilter(null, 'none')).toBe(true);
    expect(matchesFilter('yes', 'none')).toBe(false);
    expect(matchesFilter('no', 'no')).toBe(true);
    expect(matchesFilter('no', 'yes')).toBe(false);
    expect(matchesFilter(null, 'all')).toBe(true);
  });
  it('activityLine: подпись действия, неизвестное действие показывается как есть', () => {
    expect(activityLine({ action: 'rescheduled', created_at: '2026-11-06T08:00:00Z' })).toBe('06.11.2026 12:00 · Матч перенесён');
    expect(activityLine({ action: 'x_new', created_at: '2026-11-06T08:00:00Z', actor_name: 'Иван' })).toBe('06.11.2026 12:00 · x_new · Иван');
  });
});
