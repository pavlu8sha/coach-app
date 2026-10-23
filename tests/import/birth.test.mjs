import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoBirth, parseOverrides, parsePayBirths, buildBirthPlan } from '../../scripts/import/birth.mjs';

test('isoBirth: корректные даты и несуществующие', () => {
  assert.equal(isoBirth('07.09.2020'), '2020-09-07');
  assert.equal(isoBirth('31.02.2018'), null);
  assert.equal(isoBirth('2018-02-01'), null);
  assert.equal(isoBirth(''), null);
});

test('parseOverrides: берёт ID и дату, плохие даты отдельно', () => {
  const r = parseOverrides('ID игрока,ФИ,Дата рождения,Изменено\nKS-1,A B,01.04.2016,14.10.2026\nKS-2,C D,31.02.2016,\n');
  assert.equal(r.overrides.get('KS-1'), '2016-04-01');
  assert.equal(r.invalid.length, 1);
});

test('parsePayBirths: блок «Индивидуальные / вратарские» не читается, нечисловая строка закрывает блок', () => {
  const t = 'шапка,,,\nU7-A,,,\n№,Имя,Дата,Оплата\n1,Kid One,01.08.2019,165\nИТОГО,,,\nИндивидуальные / вратарские,,,\n№,Имя,Дата,Оплата\n1,Guest,02.02.2015,50\n';
  const r = parsePayBirths(t);
  assert.deepEqual(r.map(x => x.name), ['Kid One']);
});

test('план: ручная дата важнее файла оплат, более поздний месяц важнее раннего, без даты — в missing', () => {
  const pay = (name, d) => `U7-A,,,\n№,Имя,Дата,Оплата\n1,${name},${d},1\n`;
  const players = [
    { external_id: 'KS-1', full_name: 'Kid One', group_name: 'U7-A', status: 'active' },
    { external_id: 'KS-2', full_name: 'Kid Two', group_name: 'U7-A', status: 'active' },
    { external_id: 'KS-3', full_name: 'Kid Three', group_name: 'U7-A', status: 'inactive' },
  ];
  const plan = buildBirthPlan({
    registryPlayers: players,
    overridesText: 'ID игрока,ФИ,Дата рождения,Изменено\nKS-1,Kid One,03.03.2019,\n',
    payFiles: [{ month: '09.26', text: pay('Kid One', '01.01.2019') + pay('Kid Two', '05.05.2019') }, { month: '10.26', text: pay('Kid Two', '06.06.2019') }],
    today: '2026-10-23',
  });
  const by = Object.fromEntries(plan.assigned.map(a => [a.external_id, a]));
  assert.equal(by['KS-1'].birth_date, '2019-03-03'); assert.equal(by['KS-1'].source, 'вручную');
  assert.equal(by['KS-2'].birth_date, '2019-06-06');
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.missing.length, 1);
});

test('возраст не подходит группе попадает в outliers', () => {
  const plan = buildBirthPlan({
    registryPlayers: [{ external_id: 'KS-1', full_name: 'Old Kid', group_name: 'U13-A', status: 'active' }],
    overridesText: 'ID игрока,ФИ,Дата рождения,Изменено\nKS-1,Old Kid,09.10.2012,\n', payFiles: [], today: '2026-10-23',
  });
  assert.equal(plan.outliers.length, 1);
});
