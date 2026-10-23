import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCampsPlan, parseCampTariffs, parseSettings } from '../../scripts/import/camps.mjs';

const campsCsv = [
  'ID сбора,Название,Место,Начало,Конец,"Бронь, ₾",Срок брони,Срок полной оплаты,Активен',
  'CMP-0001,Ureki Winter Camp,KOLKHIDA,03.01.2027,10.01.2027,500,30.11.2026,19.12.2026,да',
].join('\n');
const tariffsCsv = [
  'ID сбора,Тариф,"Цена, ₾",Активен',
  'CMP-0001,Футболист,1500,да',
  'CMP-0001,Ребенок + родитель,2500,да',
].join('\n');
const participantsCsv = [
  'ID записи,ID сбора,ID игрока,ФИ,Группа / академия,Тариф,"Сумма, ₾",Размер футболки,Комментарий,Статус,Дата записи,Гость',
  'CP-0001,CMP-0001,KS-0001,Ivanov Ivan,U7-A,Футболист,1500,,,Записан,10.10.2026,',
  'CP-0002,CMP-0001,KS-0002,Petrov Petr,U7-A,Футболист,1500,,,Отказ,10.10.2026,',
].join('\n');
const paymentsCsv = [
  'Время,Дата,ID сбора,ID записи,ID игрока,ФИ,Сумма,Тип,Способ,Комментарий',
  '11.10.2026,2026-10-11,CMP-0001,CP-0001,KS-0001,Ivanov Ivan,"500,00 ₾",Бронь,Наличные,',
].join('\n');

test('сборы: лагерь, тарифы, участники и платёж', () => {
  const plan = buildCampsPlan({
    campsCsv, tariffsCsv, participantsCsv, paymentsCsv,
    settingsCsv: 'Ключ,Объект,Значение,Изменено\nmatches.champFee,,200,19.10.2026\n',
    registryPlayers: [{ external_id: 'KS-0001' }, { external_id: 'KS-0002' }],
  });
  assert.equal(plan.problems.length, 0);
  assert.equal(plan.camps.length, 1);
  assert.deepEqual(plan.camps[0], {
    external_id: 'CMP-0001', name: 'Ureki Winter Camp', location: 'KOLKHIDA',
    starts_on: '2027-01-03', ends_on: '2027-01-10', booking_fee: 500,
    booking_deadline: '2026-11-30', full_payment_deadline: '2026-12-19', active: true,
  });
  assert.equal(plan.tariffs.length, 2);
  assert.deepEqual(plan.counts, { registered: 1, declined: 1 });
  assert.equal(plan.participants[0].status, 'registered');
  assert.equal(plan.participants[1].status, 'declined');
  assert.equal(plan.payments.length, 1);
  assert.equal(plan.payments[0].amount, 500);
  assert.equal(plan.payments[0].kind, 'booking');
  assert.equal(plan.payments[0].method, 'cash');
  assert.equal(plan.payments[0].legacy_ref, 'CAMP_PAY CMP-0001 CP-0001 2026-10-11');
});

test('сборы: неизвестный тариф и статус — проблема, а не тихая запись', () => {
  const plan = buildCampsPlan({
    campsCsv, tariffsCsv,
    participantsCsv: participantsCsv.replace('Футболист,1500,,,Записан', 'Неизвестный,1500,,,Ждём'),
    paymentsCsv,
    settingsCsv: 'Ключ,Объект,Значение,Изменено\n',
    registryPlayers: [{ external_id: 'KS-0001' }],
  });
  assert.ok(plan.problems.some(p => /статус не распознан/.test(p.error)));
});

test('настройки: одинаковый ключ с разным объектом хранится отдельно', () => {
  const { settings, problems } = parseSettings([
    'Ключ,Объект,Значение,Изменено',
    'matches.champFee,,200,19.10.2026',
    'matches.champFee,U13-A,300,19.10.2026',
  ].join('\n'));
  assert.equal(problems.length, 0);
  assert.deepEqual(settings.map(s => [s.key, s.scope, s.value]), [
    ['matches.champFee', '', '200'],
    ['matches.champFee', 'U13-A', '300'],
  ]);
});

test('тарифы: цена и активность', () => {
  const { tariffs } = parseCampTariffs(tariffsCsv);
  assert.deepEqual(tariffs[1], { camp_ext: 'CMP-0001', name: 'Ребенок + родитель', price: 2500, active: true });
});
