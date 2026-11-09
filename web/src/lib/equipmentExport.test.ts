import { describe, expect, it } from 'vitest';
import { csvFileName, equipmentCsv, type ExportOrder } from './equipmentExport';

const BOM = '﻿';
const order = (over: Partial<ExportOrder> = {}): ExportOrder => ({
  id: 'o1', ordered_on: '2026-10-20', number: '7', inscription: 'IVAN', location: 'Isani', status: 'sewing', total: 525, paid: 200,
  players: { full_name: 'Иванов Иван', groups: { name: 'U10-A' } },
  equipment_order_lines: [{ kit: 'Дождевик', size: '140', quantity: 1 }, { kit: 'Игровая форма', size: '134', quantity: 1 }],
  equipment_issues: [{ kit: 'Игровая форма' }],
  ...over,
});
const lines = (csv: string) => csv.replace(BOM, '').split('\r\n');

describe('equipmentCsv', () => {
  it('условие 4/6: BOM, разделитель «;», строка заголовка с колонками по порядку', () => {
    const csv = equipmentCsv([order()], '');
    expect(csv.startsWith(BOM)).toBe(true);
    expect(lines(csv)[0]).toBe('Дата заказа;Номер;Игрок;Группа;Локация;Вещь;Размер;Количество;Надпись;Статус;Оплачено;Сумма заказа;Выдано');
  });

  it('условие 3: одна строка на вещь заказа', () => {
    const l = lines(equipmentCsv([order()], ''));
    expect(l).toHaveLength(3);
    expect(l[1]).toBe('2026-10-20;7;Иванов Иван;U10-A;Isani;Дождевик;140;1;IVAN;Начался пошив;200;525;Нет');
    expect(l[2]).toBe('2026-10-20;7;Иванов Иван;U10-A;Isani;Игровая форма;134;1;IVAN;Начался пошив;200;525;Да');
  });

  it('условие 3: фильтр «Товар» оставляет в заказе только нужную вещь', () => {
    const l = lines(equipmentCsv([order()], 'Дождевик'));
    expect(l).toHaveLength(2);
    expect(l[1]).toContain(';Дождевик;140;1;');
    expect(l.join('\n')).not.toContain('Игровая форма');
  });

  it('условие 5: пустой размер, нет группы и даты не превращаются в null/«не указан»', () => {
    const l = lines(equipmentCsv([order({
      ordered_on: null, players: { full_name: 'Петров Пётр', groups: null }, number: null, inscription: null, location: null,
      equipment_order_lines: [{ kit: 'Дождевик', size: null, quantity: 2 }], equipment_issues: [],
    })], ''));
    expect(l[1]).toBe(';;Петров Пётр;Без группы;;Дождевик;;2;;Начался пошив;200;525;Нет');
    expect(l[1]).not.toMatch(/null|не указан/);
  });

  it('условие 6: значения с «;», кавычкой и переводом строки берутся в кавычки, кавычка удваивается', () => {
    const csv = equipmentCsv([order({ inscription: 'a;b "c"\nd', equipment_order_lines: [{ kit: 'Дождевик', size: '140', quantity: 1 }] })], '');
    expect(csv).toContain('"a;b ""c""\nd"');
  });

  it('условие 7: ячейки, начинающиеся с = + - @, экранируются апострофом', () => {
    const l = lines(equipmentCsv([order({ inscription: '=SUM(A1)', number: '+5', players: { full_name: '@x', groups: { name: '-g' } }, equipment_order_lines: [{ kit: 'Дождевик', size: '140', quantity: 1 }] })], ''));
    expect(l[1]).toBe("2026-10-20;'+5;'@x;'-g;Isani;Дождевик;140;1;'=SUM(A1);Начался пошив;200;525;Нет");
  });

  it('условие 2: порядок заказов сохраняется как на экране', () => {
    const l = lines(equipmentCsv([order({ id: 'a', players: { full_name: 'Я', groups: null } }), order({ id: 'b', players: { full_name: 'А', groups: null } })], 'Дождевик'));
    expect(l[1]).toContain(';Я;');
    expect(l[2]).toContain(';А;');
  });

  it('условие 8: нет подходящих строк, файл пустой (только заголовок не отдаём)', () => {
    expect(equipmentCsv([order()], 'Носки')).toBe('');
    expect(equipmentCsv([], '')).toBe('');
  });
});

describe('csvFileName (условие 9)', () => {
  it('equipment-ГГГГ-ММ-ДД.csv', () => expect(csvFileName('2026-11-09')).toBe('equipment-2026-11-09.csv'));
});
