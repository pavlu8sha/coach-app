import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../../scripts/import/events-plan.mjs';

const registryPlayers = [
  { external_id: 'KS-1', full_name: 'Ivanov Petr' },
  { external_id: 'KS-2', full_name: 'Sidorov Yan' },
  { external_id: 'KS-3', full_name: 'Petrov Ivan' },
];

const eventsCsv = [
  'ID,Команда,Тип,Название,Дата,Взнос,Турнир,Соперник,Голы,Пропущено',
  'E-100,U9,Товарищеская,Тест,01.09.2026,,,,,',
].join('\n');

const feesCsv = [
  'Событие,ID игрока,Игрок,Оплачено,Сумма,,,',
  'E-100,KS-1,Ivanov Petr,TRUE,25,,,',
  'E-100,KS-2,Sidorov Yan,TRUE,25,,,',
].join('\n');

function gamesCsv(rows) {
  return [
    ',,,01.09',
    '№,Игрок,Paid,Played',
    ...rows,
  ].join('\n');
}

function plan(rows, fees = feesCsv) {
  return buildPlan({
    eventsCsv,
    feesCsv: Array.isArray(fees) ? fees.join('\n') : fees,
    gamesFiles: [{ name: 'U9.csv', text: gamesCsv(rows) }],
    registryPlayers,
  });
}

test('товарищеская: Played создаёт участие, журнал — оплату', () => {
  const r = plan([
    '1,Ivanov Petr,TRUE,TRUE',
    '2,Sidorov Yan,FALSE,FALSE',
  ]);
  assert.deepEqual(r.matchPlayers, [{ match_ext: 'E-100', name: 'Ivanov Petr', played: true }]);
  assert.deepEqual(r.matchFees.map(f => [f.name, f.paid]), [
    ['Ivanov Petr', true],
    ['Sidorov Yan', true],
  ]);
  assert.equal(r.problems.length, 0);
});

test('оплата без отметки Played не выдумывает участие', () => {
  const r = plan([
    '1,Ivanov Petr,FALSE,FALSE',
    '2,Sidorov Yan,TRUE,FALSE',
  ], [
    'Событие,ID игрока,Игрок,Оплачено,Сумма,,,',
    'E-100,KS-2,Sidorov Yan,TRUE,25,,,',
  ]);
  assert.equal(r.matchPlayers.length, 0);
  assert.deepEqual(r.matchFees.map(f => [f.name, f.paid, f.src]), [
    ['Sidorov Yan', true, 'ВЗНОСЫ'],
  ]);
});

test('участие без оплаты и отменённая оплата остаются неоплаченными', () => {
  const r = plan([
    '1,Ivanov Petr,FALSE,TRUE',
    '2,Sidorov Yan,FALSE,TRUE',
    '3,Petrov Ivan,TRUE,TRUE',
  ], [
    'Событие,ID игрока,Игрок,Оплачено,Сумма,,,',
    'E-100,KS-3,Petrov Ivan,TRUE,25,,,',
    'E-100,KS-1,Ivanov Petr,FALSE,25,,,',
    'E-100,KS-2,Sidorov Yan,FALSE,25,,,',
  ]);
  assert.deepEqual(r.matchPlayers.map(p => p.name).sort(), ['Ivanov Petr', 'Petrov Ivan', 'Sidorov Yan']);
  assert.deepEqual(r.matchFees.map(f => [f.name, f.paid]), [
    ['Ivanov Petr', false],
    ['Sidorov Yan', false],
    ['Petrov Ivan', true],
  ]);
});
