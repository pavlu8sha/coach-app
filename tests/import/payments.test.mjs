import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, monthFromFileName, parsePayMonth } from '../../scripts/import/payments.mjs';

const GROUPS = new Set(['U7-A', 'Isani']);

test('сумма: «165,00 ₾» → 165, пусто → 0, мусор → ошибка', () => {
  assert.equal(parseAmount('165,00 ₾'), 165);
  assert.equal(parseAmount('9,5 ₾'), 9.5);
  assert.equal(parseAmount(''), 0);
  assert.throws(() => parseAmount('сто'), /не распознана/);
});

test('месяц из имени файла: 09.26 → 2026-09-01', () => {
  assert.equal(monthFromFileName('09.26.csv'), '2026-09-01');
  assert.throws(() => monthFromFileName('ноябрь.csv'), /ММ.ГГ/);
});

test('лист месяца: группы, игроки, пустые места и заголовки локаций', () => {
  const text = [
    'FC KICKSTART • ОПЛАТЫ • 09.26,,,',
    'КРАСНЫЙ ПАРК,,,',
    'U7-A,,,',
    '№,Имя и фамилия,Дата,"Оплата, ₾"',
    '1,Krupin Gregoriy,01.08.2019,"165,00 ₾"',
    '2,,,',
    '3,Zlidnev Ilia,17.05.2019,',
    'Isani,,,',
    '1,Amodeo Nolan,,"90,00 ₾"',
    'Неизвестная,,,',
    '1,Чужой,,"50,00 ₾"',
  ].join('\n');
  const r = parsePayMonth(text, '09.26.csv', GROUPS);
  assert.deepEqual(r.rows.map(x => [x.group, x.name, x.paid]), [
    ['U7-A', 'Krupin Gregoriy', 165],
    ['U7-A', 'Zlidnev Ilia', 0],
    ['Isani', 'Amodeo Nolan', 90],
  ]);
  assert.equal(r.month, '2026-09-01');
  assert.equal(r.problems.length, 0);
});
