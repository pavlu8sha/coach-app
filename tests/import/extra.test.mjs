import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtraPlan, parseExtraSheet, replayExtraJournal, sheetDate } from '../../scripts/import/extra.mjs';

const sheet = '№,ФИ,Группа,Paid\n1,Ivanov Petr,U9,TRUE\n2,Sidorov Yan,U9,FALSE\n3,,,\n';
const now = new Date('2026-10-26T00:00:00Z');

test('дата листа без года: текущий год, далёкое будущее — прошлый', () => {
  assert.equal(sheetDate('14.09', 2026, now), '2026-09-14');
  assert.equal(sheetDate('20.01', 2026, now), '2026-01-20');
  assert.equal(sheetDate('15.12', 2026, new Date('2026-03-01T00:00:00Z')), '2025-12-15');
  assert.equal(sheetDate('Итоги', 2026, now), null);
});

test('лист: пустые строки пропускаются, Paid читается', () => {
  assert.deepEqual(parseExtraSheet(sheet), [{ name: 'Ivanov Petr', paid: true }, { name: 'Sidorov Yan', paid: false }]);
});

test('журнал: способ и сумма последней оплаты, отмена снимает', () => {
  const j = replayExtraJournal('Дата,ID,ФИ,Сумма,Способ,Тип,Комм\nx,14.09|2026-09-14,Ivanov Petr,20,Перевод,Оплата,\nx,14.09|2026-09-14,Sidorov Yan,20,Наличные,Оплата,\nx,14.09|2026-09-14,Sidorov Yan,-20,Наличные,Отмена,\n');
  assert.deepEqual(j.get('14.09|2026-09-14|ivanov petr'), { method: 'Перевод', amount: 20 });
  assert.equal(j.has('14.09|2026-09-14|sidorov yan'), false);
});

test('план: сумма из листа цен, способ из журнала, неизвестный игрок — проблема', () => {
  const plan = buildExtraPlan({
    registryNames: ['Ivanov Petr', 'Sidorov Yan'],
    sheets: [{ name: '14.09', text: sheet + '4,Nobody Here,U9,FALSE\n' }],
    prices: new Map([['14.09|2026-09-14', 20]]),
    journal: replayExtraJournal('a,b,c,d,e,f\nx,14.09|2026-09-14,Ivanov Petr,20,Перевод,Оплата,\n'),
    year: 2026, now,
  });
  assert.equal(plan.sessions[0].amount, 20);
  assert.deepEqual(plan.sessions[0].people[0], { name: 'Ivanov Petr', paid: true, method: 'Перевод', paid_amount: 20 });
  assert.equal(plan.sessions[0].people[1].paid, false);
  assert.equal(plan.problems.length, 1);
});

test('план: ушедшие игроки и опечатка в имени заводятся бывшими, а не останавливают импорт', () => {
  const plan = buildExtraPlan({
    registryNames: ['Ivanov Petr', 'Sidorov Yan'],
    sheets: [{ name: '14.09', text: sheet + '4,Rak Dorian,U9,TRUE\n5,Imnaishvili Gosha,U9,FALSE\n6,Imnaiishvili George,U9,FALSE\n7,Nobody Here,U9,FALSE\n' }],
    year: 2026, now,
  });
  assert.deepEqual(plan.sessions[0].people.map(p => p.name), ['Ivanov Petr', 'Sidorov Yan', 'Rak Dorian', 'Imnaiishvili George']);
  assert.deepEqual(plan.former.map(f => f.full_name), ['Rak Dorian', 'Imnaiishvili George']);
  assert.equal(plan.former[0].external_id, 'GUEST-RAK-DORIAN');
  assert.equal(plan.problems.length, 1);
});

test('план: если игрок уже в реестре, бывшим он не заводится', () => {
  const plan = buildExtraPlan({
    registryNames: ['Ivanov Petr', 'Sidorov Yan', 'Rak Dorian'],
    sheets: [{ name: '14.09', text: sheet + '4,Rak Dorian,U9,TRUE\n' }], year: 2026, now,
  });
  assert.equal(plan.former.length, 0);
});
