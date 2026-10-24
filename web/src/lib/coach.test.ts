import { describe, expect, it } from 'vitest';
import { addDays, coachError, fmtDate, hm, isoDow, plural } from './coach';

describe('coachError', () => {
  it('переводит ошибки функций базы в понятный текст', () => {
    expect(coachError('goals exceed team score')).toBe('Голов у игроков больше, чем забила команда.');
    expect(coachError('only one best player')).toBe('Лучший игрок может быть только один.');
    expect(coachError('match has fees')).toBe('У матча есть взносы: удалить его нельзя.');
    expect(coachError('points must be between 1 and 5')).toBe('Баллы: от 1 до 5.');
  });
  it('сообщает, что функция не установлена в базе', () => {
    expect(coachError('Could not find the function public.save_match')).toContain('ещё не установлена');
    expect(coachError('schema cache is stale')).toContain('ещё не установлена');
  });
  it('неизвестную ошибку показывает как есть', () => {
    expect(coachError('что-то новое')).toBe('что-то новое');
  });
});

describe('даты и числа', () => {
  it('день недели как в расписании: 1 — понедельник, 7 — воскресенье', () => {
    expect(isoDow('2026-10-19')).toBe(1);
    expect(isoDow('2026-10-25')).toBe(7);
  });
  it('сдвигает дату и форматирует', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(fmtDate('2026-10-05')).toBe('05.10.2026');
    expect(hm('18:00:00')).toBe('18:00');
    expect(hm(null)).toBe('');
  });
  it('склоняет «балл»', () => {
    expect([1, 2, 5, 11, 21, 22].map(plural)).toEqual(['балл', 'балла', 'баллов', 'баллов', 'балл', 'балла']);
  });
});
