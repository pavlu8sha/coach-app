import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDbExport, compareWithDb } from '../../scripts/import/equipment-compare-db.mjs';

const J = a => '"' + JSON.stringify(a).replace(/"/g, '""') + '"';
const csv = 'ord,player_ext,inscription,number,installment,total,paid,location,lines\n'
  + 'ORD-0069,KS-0043,GONGADZE,8,f,200.00,200.00,Красный парк,' + J([{ kit: 'Игровая форма', size: 'майка - 140; шорты - 128', quantity: 1 }]) + '\n'
  + 'ORD-0043,KS-0023,DEYCH,10,f,300.00,300.00,Красный парк,' + J([{ kit: 'Игровая форма', size: '140', quantity: 1 }, { kit: 'Тренировочная форма', size: '140', quantity: 1 }]) + '\n';
const line = (kit, size, quantity) => ({ kit, size, quantity });
const sheet = (ext_id, o = {}) => ({ ext_id, player_ext: 'KS-0043', inscription: 'GONGADZE', number: '8', installment: false, total: 200, paid: 200, lines: [line('Игровая форма', 'майка - 140; шорты - 128', 1)], ...o });

test('выгрузка базы разбирается, позиции с «;» внутри размера не ломают разбор строки', () => {
  const db = parseDbExport(csv);
  assert.equal(db.length, 2);
  assert.equal(db[1].lines.length, 2);
});

test('совпадающий заказ — без расхождений; перезапись содержимого видна по полям', () => {
  const db = parseDbExport(csv.replace('майка - 140; шорты - 128', 'M'));
  const ok = compareWithDb([sheet('ORD-0069', { lines: [line('Игровая форма', 'M', 1)] })], db);
  assert.deepEqual(ok.diffs, []);
  const bad = compareWithDb([sheet('ORD-0069', { inscription: 'MAKHASHVILI', number: '2', total: 470, lines: [line('Тренировочная форма', 'M', 1)] })], db);
  assert.deepEqual(bad.diffs.map(d => d.field).sort(), ['inscription', 'kit', 'number', 'total']);
});

test('заказы только в листе или только в базе выделяются отдельно', () => {
  const r = compareWithDb([sheet('ORD-0200')], parseDbExport(csv));
  assert.deepEqual([r.onlySheet, r.onlyDb], [['ORD-0200'], ['ORD-0069', 'ORD-0043']]);
});
