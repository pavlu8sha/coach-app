import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBirthDates } from '../../scripts/import/verify.mjs';
import { buildPaymentsPlan } from '../../scripts/import/payments-plan.mjs';
import { buildIndividualPlan } from '../../scripts/import/individual-plan.mjs';

test('даты рождения: ID, дата и пустые строки', () => {
  const text = [
    'ID игрока,ФИ,Дата рождения,Изменено',
    'KS-0211,Mianzelen Timur,01.04.2016,14.10.2026',
    'KS-0231,Aliaksei Mikitchuk,,16.10.2026',
    'KS-0232,Bayramov Renat,07.09.2020,19.10.2026',
  ].join('\n');
  const r = parseBirthDates(text);
  assert.equal(r.problems.length, 0);
  assert.deepEqual([...r.dates], [
    ['KS-0211', '2016-04-01'],
    ['KS-0232', '2020-09-07'],
  ]);
});

test('оплаты: абонементы и платежи по строкам месяца, алиас и гость', () => {
  const registry = {
    groups: [{ name: 'U7-A' }],
    players: [
      { external_id: 'KS-1', full_name: 'Krupin Gregoriy', group_name: 'U7-A' },
      { external_id: 'KS-2', full_name: 'Kurbanov Emin', group_name: 'U7-A' },
    ],
  };
  const text = [
    'FC KICKSTART • ОПЛАТЫ • 09.26,,,',
    'U7-A,,,',
    '№,Имя и фамилия,Дата,"Оплата, ₾"',
    '1,Krupin Gregoriy,,"165,00 ₾"',
    '2,Krupin Gregoriy,,',
    '3,Kurbanoiv Emin,,"90,00 ₾"',
    'Индивидуальные / Вратарские,,,',
    '1,Gleb,15.09.2026,"50,00 ₾"',
  ].join('\n');
  const plan = buildPaymentsPlan({ registry, files: [{ name: '09.26.csv', text }] });
  assert.equal(plan.problems.length, 0);
  assert.equal(plan.unmatched.length, 0);
  assert.equal(plan.subs.size, 2);
  assert.equal(plan.subs.get('KS-1|2026-09-01').amount_due, 165);
  assert.deepEqual(plan.pays.map(p => [p.player_ext, p.amount]), [['KS-1', 165], ['KS-2', 90]]);
  assert.equal(plan.pays[1].ref, 'PAY_ID 2026-09 U7-A №3 kurbanoiv emin');
});

test('оплаты: абонемент берёт группу из листа месяца, а не текущую из реестра', () => {
  const registry = {
    groups: [{ name: 'U9-A' }, { name: 'U9-B' }],
    players: [
      { external_id: 'KS-1', full_name: 'Ivanov Petr', group_name: 'U9-B' },
      { external_id: 'KS-2', full_name: 'Sidorov Yan', group_name: 'U9-B' },
    ],
  };
  const text = [
    'FC KICKSTART • ОПЛАТЫ • 09.26,,,',
    'U9-A,,,',
    '№,Имя и фамилия,Дата,"Оплата, ₾"',
    '1,Ivanov Petr,,"100,00 ₾"',
    '2,Sidorov Yan,,"50,00 ₾"',
    'U9-B,,,',
    '1,Sidorov Yan,,"50,00 ₾"',
  ].join('\n');
  const plan = buildPaymentsPlan({ registry, files: [{ name: '09.26.csv', text }] });
  assert.equal(plan.subs.get('KS-1|2026-09-01').group, 'U9-A');
  // KS-2 в листе в двух группах, текущая группа реестра U9-B среди них: берётся она
  assert.equal(plan.subs.get('KS-2|2026-09-01').group, 'U9-B');
  assert.equal(plan.subs.get('KS-2|2026-09-01').amount_due, 100);
  assert.deepEqual(plan.ambiguousSubs.map(s => s.player_ext), ['KS-2']);
});

test('оплаты: несколько групп в месяце, текущей группы реестра среди них нет — группа первой строки', () => {
  const registry = {
    groups: [{ name: 'U9-A' }, { name: 'weekends' }, { name: 'U10-A' }],
    players: [{ external_id: 'KS-1', full_name: 'Ivanov Petr', group_name: 'U10-A' }],
  };
  const text = [
    'FC KICKSTART • ОПЛАТЫ • 09.26,,,',
    'weekends,,,',
    '№,Имя и фамилия,Дата,"Оплата, ₾"',
    '1,Ivanov Petr,,"50,00 ₾"',
    'U9-A,,,',
    '1,Ivanov Petr,,"100,00 ₾"',
  ].join('\n');
  const plan = buildPaymentsPlan({ registry, files: [{ name: '09.26.csv', text }] });
  assert.equal(plan.subs.get('KS-1|2026-09-01').group, 'weekends');
  assert.equal(plan.ambiguousSubs.length, 1);
});

test('индивидуальные: занятие, запись и гость собираются в план', () => {
  const plan = buildIndividualPlan({
    registryNames: ['Ivanov Ivan'],
    payRows: [
      { date: '2026-10-10', gk: false, name: 'Ivanov Ivan', paid: true },
      { date: '2026-10-10', gk: false, name: 'Gleb', paid: false },
    ],
    sessionsSheet: [{ key: '2026-10-10 18:00', goalkeepers: false, starts_at: '2026-10-10T18:00:00', topic: 'Тема' }],
    journalBookings: [],
    oldFiles: [],
  });
  assert.equal(plan.problems.length, 0);
  assert.equal(plan.sessions.length, 1);
  assert.equal(plan.sessions[0].external_id, 'IND-2026-10-10');
  assert.equal(plan.sessions[0].starts_at, '2026-10-10T18:00:00');
  assert.deepEqual(plan.bookings.map(b => [b.name, b.guest, b.paid]), [
    ['Ivanov Ivan', false, true],
    ['Gleb', true, false],
  ]);
  assert.deepEqual(plan.guests, ['Gleb']);
});
