import { afterEach, describe, expect, it } from 'vitest';
import { champFeeFor, settingError, settingDef, settingNumber, settingText } from './clubSettings';
import { compareGroups, setGroupOrder, sortGroups } from './coach';

afterEach(() => setGroupOrder(''));

describe('Настройки клуба: значения и проверка', () => {
  it('пустая или отсутствующая настройка даёт значение по умолчанию; для чисел без значения по умолчанию — «не задано»', () => {
    expect(settingText({}, 'stats.lowPct')).toBe('50');
    expect(settingText({ 'stats.lowPct': '' }, 'stats.lowPct')).toBe('50');
    expect(settingNumber({ 'stats.lowPct': '40' }, 'stats.lowPct')).toBe(40);
    expect(settingNumber({ 'stats.lowPct': '500' }, 'stats.lowPct')).toBe(50); // вне границ → по умолчанию
    expect(Number.isNaN(settingNumber({}, 'ind.capIndividual'))).toBe(true);
    expect(settingNumber({ 'ind.capIndividual': '6' }, 'ind.capIndividual')).toBe(6);
  });

  it('значения из старого приложения (null) считаются незаданными', () => {
    expect(settingText({ 'equip.discNeedOwn': null as unknown as string }, 'equip.discNeedOwn')).toContain('Игровая форма');
  });

  it('границы: число вне диапазона отклоняется, пустое допустимо только там, где нет значения по умолчанию', () => {
    expect(settingError(settingDef('payments.nextMonthDay')!, '40')).toBe('Не больше 31.');
    expect(settingError(settingDef('payments.nextMonthDay')!, 'abc')).toBe('Нужно число.');
    expect(settingError(settingDef('ind.capIndividual')!, '')).toBeNull();
    expect(settingError(settingDef('ind.capIndividual')!, '0')).toBe('Не меньше 1.');
    expect(settingError(settingDef('equip.fullPrice')!, '  ')).toBe('Список не может быть пустым.');
  });

  it('взнос за чемпионат: свой у команды важнее общего, без обоих — не задан', () => {
    const scoped = { 'matches.champFee': { 'U13-A': '300' } };
    expect(champFeeFor({ 'matches.champFee': '200' }, scoped, 'U13-A')).toBe(300);
    expect(champFeeFor({ 'matches.champFee': '200' }, scoped, 'U9')).toBe(200);
    expect(champFeeFor({}, scoped, 'U9')).toBeNull();
    expect(champFeeFor({ 'matches.champFee': '200' }, { 'matches.champFee': { 'U13-A': '0' } }, 'U13-A')).toBe(0);
  });
});

describe('Свой порядок групп', () => {
  it('группы из списка идут первыми в заданном порядке, остальные после них в обычном', () => {
    setGroupOrder('weekends, U13-A, U7-A');
    expect(sortGroups(['U7-A', 'U9-A', 'U13-A', 'weekends', 'Isani', 'U7-B'].map(name => ({ name }))).map(g => g.name)).toEqual(['weekends', 'U13-A', 'U7-A', 'U7-B', 'U9-A', 'Isani']);
    expect(compareGroups('WEEKENDS', 'U7-A')).toBeLessThan(0); // регистр не важен
  });
  it('пустой список возвращает обычный порядок', () => {
    setGroupOrder('weekends');
    setGroupOrder('');
    expect(compareGroups('U7-A', 'weekends')).toBeLessThan(0);
  });
});
