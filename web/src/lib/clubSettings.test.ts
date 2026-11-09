import { afterEach, describe, expect, it } from 'vitest';
import { champFeeFor, matchDurationFor, settingError, settingDef, settingNumber, settingNumberError, settingText } from './clubSettings';
import { compareGroups, setGroupOrder, sortGroups } from './coach';

afterEach(() => setGroupOrder(''));

describe('Настройки клуба: значения и проверка', () => {
  it('пустая или отсутствующая настройка даёт значение по умолчанию; для чисел без значения по умолчанию — «не задано»', () => {
    expect(settingText({}, 'stats.lowPct')).toBe('50');
    expect(settingText({ 'stats.lowPct': '' }, 'stats.lowPct')).toBe('50');
    expect(settingNumber({ 'stats.lowPct': '40' }, 'stats.lowPct')).toBe(40);
    expect(Number.isNaN(settingNumber({ 'stats.lowPct': '500' }, 'stats.lowPct'))).toBe(true);
    expect(settingNumberError({ 'stats.lowPct': '500' }, 'stats.lowPct')).toBe('Не больше 100.');
    expect(settingNumber({}, 'ind.capIndividual')).toBe(6);
    expect(settingNumber({}, 'ind.capGoalkeepers')).toBe(7);
    expect(settingNumber({ 'ind.capIndividual': '6' }, 'ind.capIndividual')).toBe(6);
    expect(settingNumber({ 'ind.capIndividual': 'abc' }, 'ind.capIndividual')).toBeNaN();
  });

  it('значения из старого приложения (null) считаются незаданными', () => {
    expect(settingText({ 'equip.discNeedOwn': null as unknown as string }, 'equip.discNeedOwn')).toContain('Игровая форма');
  });

  it('границы: число вне диапазона отклоняется, пустое поле возвращает значение по умолчанию', () => {
    expect(settingError(settingDef('payments.nextMonthDay')!, '40')).toBe('Не больше 31.');
    expect(settingError(settingDef('payments.nextMonthDay')!, 'abc')).toBe('Нужно число.');
    expect(settingError(settingDef('payments.nextMonthDay')!, '')).toBeNull();
    expect(settingError(settingDef('ind.capIndividual')!, '')).toBeNull();
    expect(settingError(settingDef('ind.capIndividual')!, '0')).toBe('Не меньше 1.');
    expect(settingError(settingDef('ind.capIndividual')!, '6,5')).toBe('Нужно целое число.');
    expect(settingNumber({ 'ind.capIndividual': '6,5' }, 'ind.capIndividual')).toBeNaN();
    expect(settingError(settingDef('extra.cap')!, '6,5')).toBe('Нужно целое число.');
    expect(settingError(settingDef('equip.discPct')!, '12,5')).toBeNull();
    expect(settingError(settingDef('equip.discRound')!, '0')).toBe('Не меньше 1.');
    expect(settingError(settingDef('equip.discRound')!, '5,5')).toBe('Нужно целое число.');
    expect(settingError(settingDef('equip.discRound')!, '5')).toBeNull();
    expect(settingNumber({}, 'equip.discRound')).toBe(5);
    expect(settingError(settingDef('equip.fullPrice')!, '  ')).toBe('Список не может быть пустым.');
  });

  it('взнос за чемпионат: свой у команды важнее общего, без обоих — не задан', () => {
    const scoped = { 'matches.champFee': { 'U13-A': '300' } };
    expect(champFeeFor({ 'matches.champFee': '200' }, scoped, 'U13-A')).toBe(300);
    expect(champFeeFor({ 'matches.champFee': '200' }, scoped, 'U9')).toBe(200);
    expect(champFeeFor({}, scoped, 'U9')).toBeNull();
    expect(champFeeFor({ 'matches.champFee': '200' }, { 'matches.champFee': { 'U13-A': '0' } }, 'U13-A')).toBe(0);
  });

  it('длительность матча: своя у команды важнее общей, без обеих 90 минут', () => {
    const scoped = { 'matches.durationMin': { 'U8': '50' } };
    expect(matchDurationFor({ 'matches.durationMin': '120' }, scoped, 'U8')).toBe(50);
    expect(matchDurationFor({ 'matches.durationMin': '120' }, scoped, 'U14')).toBe(120);
    expect(matchDurationFor({}, {}, 'U14')).toBe(90);
    expect(matchDurationFor({ 'matches.durationMin': '' }, {}, 'U14')).toBe(90);
  });

  it('длительность матча: недопустимое значение не действует, берётся следующее по порядку', () => {
    expect(matchDurationFor({ 'matches.durationMin': '120' }, { 'matches.durationMin': { 'U8': 'abc' } }, 'U8')).toBe(120);
    expect(matchDurationFor({ 'matches.durationMin': '120' }, { 'matches.durationMin': { 'U8': '5' } }, 'U8')).toBe(120);
    expect(matchDurationFor({ 'matches.durationMin': '45,5' }, {}, 'U8')).toBe(90);
    expect(matchDurationFor({ 'matches.durationMin': '9000' }, {}, 'U8')).toBe(90);
    expect(settingError(settingDef('matches.durationMin')!, '9')).toBe('Не меньше 10.');
    expect(settingError(settingDef('matches.durationMin')!, '601')).toBe('Не больше 600.');
    expect(settingError(settingDef('matches.durationMin')!, '75')).toBeNull();
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
