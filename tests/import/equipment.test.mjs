import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, parseSeason, isoOrNull } from '../../scripts/import/equipment.mjs';

const CAT = 'Название,Цена, ₾,Размеры,Надпись,Номер,Активна\nТренировочная форма,100,,нет,да,да\nИгровая форма,200,,да,да,да\nСпортивный костюм,170,,нет,да,да\n';
const kits = new Map(parseCatalog(CAT).map(k => [k.kit, k.price]));

test('каталог: название → цена', () => {
  assert.equal(kits.get('Игровая форма'), 200);
});

test('дата заказа: пусто → null, dd.mm.yyyy → iso', () => {
  assert.equal(isoOrNull(''), null);
  assert.equal(isoOrNull('21.10.2026'), '2026-10-21');
});

test('заказы: количество «2 + 1» по позициям, блок себестоимости не читается', () => {
  const text = [
    'FC • ЭКИПИРОВКА,,,,,,,,,,,,,,',
    'ЗАКАЗЫ,,,,,,,,,,,,,,',
    '№,Дата заказа,ФИ ребёнка,Комплект,Размер,Надпись,Номер,Рассрочка,Сумма заказа,Оплачено,Долг,ID игрока,Локация,ID заказа,Кол-во',
    '134,22.10.2026,Imanuel,Тренировочная форма + Спортивный костюм,140,,,,370,00 ₾,,KS-0055,Ortachala,ORD-0131,2 + 1',
    '1,,Podilchuk,Игровая форма + Тренировочная форма,140,PODILCHUK,3,,"300,00 ₾","300,00 ₾",,KS-0114,Красный парк,ORD-0004,',
    '№,Дата,Категория,Себестоимость',
    '1,,Расход,50',
  ].join('\n');
  const r = parseSeason(text, kits);
  assert.equal(r.orders.length, 2);
  assert.deepEqual(r.orders[0].lines.map(l => [l.kit, l.quantity]), [['Тренировочная форма', 2], ['Спортивный костюм', 1]]);
  assert.equal(r.orders[0].line_sum, 370);
  assert.equal(r.orders[1].ordered_on, null);
  assert.equal(r.orders[1].paid, 300);
});

test('«Полный комплект» без опечатки раскрывается так же, как с опечаткой', () => {
  const full = new Map([...kits, ['Дождевик', 150], ['Тренировочная форма', 100]]);
  const text = [
    '№,Дата заказа,ФИ ребёнка,Комплект,Размер,Надпись,Номер,Рассрочка,Сумма заказа,Оплачено,Долг,ID игрока,Локация,ID заказа,Кол-во',
    '35,,X,Полный комплект,128,,,,"525,00 ₾","0,00 ₾",,KS-0001,Isani,ORD-0035,',
  ].join('\n');
  const r = parseSeason(text, full);
  assert.equal(r.problems.length, 0);
  assert.equal(r.orders[0].lines.length, 4);
  assert.equal(r.orders[0].total, 525);
});

test('полный набор с опечаткой раскрывается в 4 позиции; итог из листа (525), позиции — каталог (620)', () => {
  const full = new Map([...kits, ['Дождевик', 150], ['Тренировочная форма', 100]]);
  const text = [
    '№,Дата заказа,ФИ ребёнка,Комплект,Размер,Надпись,Номер,Рассрочка,Сумма заказа,Оплачено,Долг,ID игрока,Локация,ID заказа,Кол-во',
    '32,,X,Полный комлпект,128,,,,"525,00 ₾","0,00 ₾",,KS-0001,Isani,ORD-0032,',
  ].join('\n');
  const r = parseSeason(text, full);
  assert.equal(r.problems.length, 0);
  assert.equal(r.orders[0].lines.length, 4);
  assert.equal(r.orders[0].line_sum, 620);
  assert.equal(r.orders[0].total, 525);
});

test('запятая в размере без кавычек не сдвигает столбцы', () => {
  const text = [
    '№,Дата заказа,ФИ ребёнка,Комплект,Размер,Надпись,Номер,Рассрочка,Сумма заказа,Оплачено,Долг,ID игрока,Локация,ID заказа,Кол-во',
    '3,,Matusevich,Тренировочная форма + Игровая форма,игровая: 140, тренировочная: 152,MATUSEVICH,7,,"300,00 ₾","300,00 ₾","0,00 ₾",KS-0101,Красный парк,ORD-0006,',
  ].join('\n');
  const r = parseSeason(text, kits);
  assert.equal(r.problems.length, 0);
  assert.equal(r.orders[0].ext_id, 'ORD-0006');
  assert.equal(r.orders[0].lines[0].size, 'игровая: 140, тренировочная: 152');
});
