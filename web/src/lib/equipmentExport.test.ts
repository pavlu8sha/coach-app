import { describe, expect, it } from 'vitest';
import { csvFileName, equipmentCsv, type ExportOrder } from './equipmentExport';

const BOM = '﻿';
const order = (over: Partial<ExportOrder> = {}): ExportOrder => ({
  id: 'o1', ordered_on: '2026-10-20', number: '7', location: 'Isani',
  players: { full_name: 'Иванов Иван', groups: { name: 'U10-A' } },
  equipment_order_lines: [{ kit: 'Дождевик', size: '140', quantity: 1 }, { kit: 'Игровая форма', size: '134', quantity: 1 }],
  ...over,
});
const lines = (csv: string) => csv.replace(BOM, '').split('\r\n');

describe('equipmentCsv', () => {
  it('условия 4, 7: BOM, разделитель «;», колонки как в эталонном запросе и в том же порядке', () => {
    const csv = equipmentCsv([order()], '');
    expect(csv.startsWith(BOM)).toBe(true);
    expect(lines(csv)[0]).toBe('дата заказа;номер;игрок;группа;локация;вещь;размер;количество;id заказа');
  });

  it('условие 3: одна строка на вещь заказа', () => {
    const l = lines(equipmentCsv([order()], ''));
    expect(l).toHaveLength(3);
    expect(l[1]).toBe('2026-10-20;7;Иванов Иван;U10-A;Isani;Дождевик;140;1;o1');
    expect(l[2]).toBe('2026-10-20;7;Иванов Иван;U10-A;Isani;Игровая форма;134;1;o1');
  });

  it('условие 3: фильтр «Товар» оставляет в заказе только нужную вещь', () => {
    const l = lines(equipmentCsv([order()], 'Дождевик'));
    expect(l).toHaveLength(2);
    expect(l[1]).toContain(';Дождевик;140;1;');
    expect(l.join('\n')).not.toContain('Игровая форма');
  });

  it('условие 5: пустой размер, нет группы, даты и номера дают пустые ячейки', () => {
    const l = lines(equipmentCsv([order({
      ordered_on: null, players: { full_name: 'Петров Пётр', groups: null }, number: null, location: null,
      equipment_order_lines: [{ kit: 'Дождевик', size: null, quantity: 2 }],
    })], ''));
    expect(l[1]).toBe(';;Петров Пётр;;;Дождевик;;2;o1');
    expect(l[1]).not.toMatch(/null|не указан|Без группы/);
  });

  it('условие 7: значения с «;», кавычкой и переводом строки берутся в кавычки, кавычка удваивается', () => {
    const csv = equipmentCsv([order({ location: 'a;b "c"\nd', equipment_order_lines: [{ kit: 'Дождевик', size: '140', quantity: 1 }] })], '');
    expect(csv).toContain('"a;b ""c""\nd"');
  });

  it('условие 8: ячейки, начинающиеся с = + - @, экранируются апострофом', () => {
    const l = lines(equipmentCsv([order({ location: '=SUM(A1)', number: '+5', players: { full_name: '@x', groups: { name: '-g' } }, equipment_order_lines: [{ kit: 'Дождевик', size: '140', quantity: 1 }] })], ''));
    expect(l[1]).toBe("2026-10-20;'+5;'@x;'-g;'=SUM(A1);Дождевик;140;1;o1");
  });

  it('условие 6: строки по дате заказа, затем по имени игрока; вещи внутри заказа в исходном порядке', () => {
    const l = lines(equipmentCsv([
      order({ id: 'c', ordered_on: '2026-10-21', players: { full_name: 'Аверин', groups: null } }),
      order({ id: 'b', ordered_on: '2026-10-20', players: { full_name: 'Яковлев', groups: null } }),
      order({ id: 'a', ordered_on: '2026-10-20', players: { full_name: 'Борисов', groups: null } }),
    ], 'Дождевик'));
    expect(l.slice(1).map(x => x.split(';')[8])).toEqual(['a', 'b', 'c']);
    const inOrder = lines(equipmentCsv([order()], ''));
    expect(inOrder[1]).toContain(';Дождевик;');
    expect(inOrder[2]).toContain(';Игровая форма;');
  });

  it('условие 9: нет подходящих строк, пустая строка вместо файла', () => {
    expect(equipmentCsv([order()], 'Носки')).toBe('');
    expect(equipmentCsv([], '')).toBe('');
  });
});

describe('equipmentCsv: выдача по вещи (условие 5)', () => {
  const partly = order({ equipment_issues: [{ kit: 'Игровая форма' }] }); // форма выдана, дождевик нет
  const notIssued = (o: ExportOrder, kit: string) => !(o.equipment_issues ?? []).some(i => i.kit === kit);
  it('«Не выдано»: в файле только невыданная вещь заказа', () => {
    const l = lines(equipmentCsv([partly], '', notIssued));
    expect(l).toHaveLength(2);
    expect(l[1]).toContain(';Дождевик;');
  });
  it('«Не выдано» + Товар «Игровая форма»: выданная форма не выгружается, файла нет', () => {
    expect(equipmentCsv([partly], 'Игровая форма', notIssued)).toBe('');
  });
});

describe('csvFileName (условие 11)', () => {
  it('equipment-ГГГГ-ММ-ДД.csv', () => expect(csvFileName('2026-11-09')).toBe('equipment-2026-11-09.csv'));
});

import { notOrderedCsv, notOrderedFileName, notOrderedPlayers, type NotOrderedOrder, type RosterPlayer } from './equipmentExport';

const pl = (id: string, name: string, over: Partial<RosterPlayer> = {}): RosterPlayer => ({ id, full_name: name, status: 'active', groups: { name: 'U10-A' }, ...over });
const ord = (player_id: string, kits: string[], status = 'new'): NotOrderedOrder => ({ player_id, status, equipment_order_lines: kits.map(kit => ({ kit })) });
const KIT = 'Тренировочный комплект';

describe('notOrderedPlayers (docs/acceptance/eq-not-ordered-filter-2026-11-13.md)', () => {
  it('условие 3: игрок без заказов и игрок с заказом без этой вещи попадают, с вещью нет', () => {
    const r = notOrderedPlayers([pl('a', 'Без заказов'), pl('b', 'Другая вещь'), pl('c', 'Есть комплект')], [ord('b', ['Дождевик']), ord('c', [KIT, 'Дождевик'])], KIT, '', '');
    expect(r.map(p => p.id)).toEqual(['a', 'b']);
  });
  it('условие 4: отменённый заказ не считается, неотменённый (любой статус) считается', () => {
    const r = notOrderedPlayers([pl('a', 'Я'), pl('b', 'Ты')], [ord('a', [KIT], 'cancelled'), ord('b', [KIT], 'issued')], KIT, '', '');
    expect(r.map(p => p.id)).toEqual(['a']);
  });
  it('условие 5: неактивные не входят', () => {
    expect(notOrderedPlayers([pl('a', 'Я', { status: 'inactive' })], [], KIT, '', '')).toEqual([]);
  });
  it('условие 6: поиск по имени и группа', () => {
    const ps = [pl('a', 'Иванов Иван'), pl('b', 'Петров Пётр', { groups: { name: 'U12' } }), pl('c', 'Без группы', { groups: null })];
    expect(notOrderedPlayers(ps, [], KIT, 'иван', '').map(p => p.id)).toEqual(['a']);
    expect(notOrderedPlayers(ps, [], KIT, '', 'U12').map(p => p.id)).toEqual(['b']);
  });
  it('условие 9: порядок по имени', () => {
    expect(notOrderedPlayers([pl('a', 'Яковлев'), pl('b', 'Арутюнов')], [], KIT, '', '').map(p => p.id)).toEqual(['b', 'a']);
  });
});

describe('notOrderedCsv', () => {
  it('условие 9: колонки, пустая группа, BOM, защита от формул', () => {
    const csv = notOrderedCsv([pl('a', 'Иванов Иван'), pl('b', '=Хитрый', { groups: null })]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(lines(csv)).toEqual(['U10-A', 'Иванов Иван', '', 'Без группы', "'=Хитрый"]);
    expect(csv).not.toMatch(/id игрока|;/);
  });
  it('условие 9: по группам, внутри группы по имени, без группы в конце', () => {
    const csv = notOrderedCsv([pl('1', 'Яковлев', { groups: { name: 'U12' } }), pl('2', 'Без', { groups: null }), pl('3', 'Петров', { groups: { name: 'U10-A' } }), pl('4', 'Арутюнов', { groups: { name: 'U12' } })]);
    expect(lines(csv)).toEqual(['U10-A', 'Петров', '', 'U12', 'Арутюнов', 'Яковлев', '', 'Без группы', 'Без']);
  });
  it('условие 9: пустой список даёт пустую строку', () => { expect(notOrderedCsv([])).toBe(''); });
  it('условие 10: имя файла', () => { expect(notOrderedFileName('2026-11-13')).toBe('equipment-not-ordered-2026-11-13.csv'); });
});
