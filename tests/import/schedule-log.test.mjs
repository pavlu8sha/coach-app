import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normGroup, groupForSlot, parseSchedule, parseTrainingLog } from '../../scripts/import/schedule-log.mjs';

test('кириллические буквы в U-группах заменяются, в словах не трогаются', () => {
  assert.equal(normGroup('U10-A/В'), 'U10-A/B');
  assert.equal(normGroup('Вратари'), 'Вратари');
});

test('индивидуальные и вратарские слоты идут в одну группу клуба', () => {
  assert.equal(groupForSlot('Индивидуальные'), 'Индивидуальные / Вратарские');
  assert.equal(groupForSlot('U11'), 'U11');
});

test('расписание: одна строка на группу из «Группы в отметках»', () => {
  const csv = 'День,Локация,Начало,Конец,Группа,Тип,Тренеры,Группы в отметках\nпн,Красный парк,16:00,17:00,U7-А/В,Групповая,"Дима, Руслан","U7-A, U7-B"\n';
  const r = parseSchedule(csv);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map(x => x.group_name), ['U7-A', 'U7-B']);
  assert.equal(r.rows[0].weekday, 1);
});

test('журнал: часы с запятой, точный дубль учитывается один раз', () => {
  const csv = 'Дата,День недели,Тренер,Локация,Группа,Тип тренировки,Начало,Конец,Часы,Проведено\n' +
    '01.09.2026,вторник,Паша,Красный парк,U10-A/В,Групповая,17:00,18:30,"1,50",Да\n' +
    '01.09.2026,вторник,Паша,Красный парк,U10-A/В,Групповая,17:00,18:30,"1,50",Да\n';
  const r = parseTrainingLog(csv);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].hours, 1.5);
  assert.equal(r.duplicates.length, 1);
});
