import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonthSheet, parseJournal, weekdayOf, labelGroups, buildAttendancePlan } from '../../scripts/import/attendance.mjs';

const head = 'FC KICKSTART,,,,,\nшаблон,,,,,\n,,,,,\n';
const sheet = (rows) => head + rows.join('\n') + '\n';

test('weekdayOf: пн=1 … вс=7', () => {
  assert.equal(weekdayOf('2026-10-19'), 1); // понедельник
  assert.equal(weekdayOf('2026-10-25'), 7); // воскресенье
});

test('labelGroups раскрывает «U13-B/C»', () => {
  assert.deepEqual(labelGroups('U13-B/C'), ['U13-B', 'U13-C']);
  assert.deepEqual(labelGroups('Weekends'), ['Weekends']);
});

test('день без галочек — не тренировка; FALSE в тренировке — отсутствовал', () => {
  const csv = sheet([
    'U7-A,,,,,', '№,ФИ ребёнка,2,5,,', '1,Ivanov Ivan,TRUE,FALSE,,', '2,Petrov Petr,FALSE,FALSE,,', 'ИТОГ ГРУППЫ,,,,,',
  ]);
  const r = parseMonthSheet(csv, '10', '2026');
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].date, '2026-10-02');
  assert.deepEqual(r.sessions[0].marks.map(m => [m.name, m.present]), [['Ivanov Ivan', true], ['Petrov Petr', false]]);
  assert.deepEqual(r.skipped, [{ date: '2026-10-05', group: 'U7-A' }]);
});

test('блок с нестандартным названием группы (Ortachala U9, weekends) читается', () => {
  const csv = sheet(['Ortachala U9,,,,', '№,ФИ ребёнка,3,,', '1,Kid One,TRUE,,', 'ИТОГ ГРУППЫ,,,,', 'weekends,,,,', '№,ФИ ребёнка,4,,', '1,Kid Two,TRUE,,']);
  const r = parseMonthSheet(csv, '09', '2026');
  assert.deepEqual(r.sessions.map(s => s.group), ['Ortachala U9', 'weekends']);
});

test('повтор строки ребёнка с той же отметкой — безвредный дубль; с другой — проблема', () => {
  const same = parseMonthSheet(sheet(['U10-B,,,,', '№,ФИ ребёнка,6,,', '1,Kid,TRUE,,', '2,Kid,TRUE,,']), '08', '2026');
  assert.equal(same.dupSame, 1); assert.equal(same.problems.length, 0); assert.equal(same.sessions[0].marks.length, 1);
  const diff = parseMonthSheet(sheet(['U10-B,,,,', '№,ФИ ребёнка,6,,', '1,Kid,TRUE,,', '2,Kid,FALSE,,']), '08', '2026');
  assert.equal(diff.problems.length, 1);
});

test('сводка справа (после 26-й колонки) не читается как отметки', () => {
  const pad = ',,,,,,,,,,,,,,,,,,,,,,,,'; // колонки до сводки
  const csv = sheet(['U9-A' + pad + ',Группа,Локация', '№,ФИ ребёнка,2' + pad, '1,Kid,TRUE' + pad + ',U9-A,TRUE']);
  const r = parseMonthSheet(csv, '10', '2026');
  assert.equal(r.sessions[0].marks.length, 1);
});

test('parseJournal читает дату, ID и статус', () => {
  const t = 'шапка\nпояснение\nЗапись ID,Дата,...\nATT-202609-0001,01.09.2026,KS-0006,Bagulin Misha,U10-A,Красный парк,Присутствовал,,,Импорт 09.26\nATT-202609-0002,02.09.2026,KS-0010,X Y,U10-A,Красный парк,Отсутствовал,,,Приложение\n';
  const j = parseJournal(t);
  assert.equal(j.length, 2);
  assert.deepEqual([j[0].date, j[0].external_id, j[0].present, j[1].present], ['2026-09-01', 'KS-0006', true, false]);
});

test('план: время из расписания по дню недели, иначе из журнала тренировок, иначе «нет слота»; не найденный ребёнок отдельно', () => {
  const csv = sheet(['U7-A,,,,,', '№,ФИ ребёнка,19,21,22,,', '1,Ivanov Ivan,TRUE,TRUE,TRUE,,', '2,Ghost Kid,TRUE,FALSE,FALSE,,']);
  const schedule = [{ group_name: 'U7-A', weekday: 1, starts_at: '16:00', kind: 'Групповая' }];
  const trainingLog = [{ group_label: 'U7-A', held_on: '2026-10-21', starts_at: '17:30' }];
  const registryPlayers = [{ external_id: 'KS-1', full_name: 'Ivanov Ivan' }];
  const plan = buildAttendancePlan({ sheets: [{ text: csv, month: '10', year: '2026' }], journalText: '', schedule, registryPlayers, trainingLog });
  const byDate = Object.fromEntries(plan.sessions.map(s => [s.date, s.starts_at]));
  assert.equal(byDate['2026-10-19'], '2026-10-19T16:00:00+04:00'); // понедельник — по расписанию
  assert.equal(byDate['2026-10-21'], '2026-10-21T17:30:00+04:00'); // из журнала тренировок
  assert.deepEqual(plan.noSlot, ['2026-10-22 U7-A']);              // четверг — слота нет
  assert.deepEqual(plan.unmatched.map(u => u.name), ['Ghost Kid']);
  assert.equal(plan.marks.every(m => m.external_id === 'KS-1'), true);
  assert.equal(plan.fromLog, 1);
});

test('индивидуальные и вратарские слоты расписания не задают время групповой тренировки', () => {
  const csv = sheet(['U7-A,,,,', '№,ФИ ребёнка,19,,', '1,Ivanov Ivan,TRUE,,']);
  const schedule = [{ group_name: 'U7-A', weekday: 1, starts_at: '12:00', kind: 'Индивидуальная' }];
  const plan = buildAttendancePlan({ sheets: [{ text: csv, month: '10', year: '2026' }], journalText: '', schedule, registryPlayers: [{ external_id: 'KS-1', full_name: 'Ivanov Ivan' }] });
  assert.deepEqual(plan.noSlot, ['2026-10-19 U7-A']);
});

test('бывшие дети из августа получают GUEST-… и попадают в план; время из TIME_FIX', () => {
  const csv = sheet(['U13-A,,,,', '№,ФИ ребёнка,22,,', '1,Bayter Aivi,TRUE,,', '2,Ivanov Ivan,TRUE,,']);
  const plan = buildAttendancePlan({ sheets: [{ text: csv, month: '08', year: '2026' }], journalText: '', schedule: [], registryPlayers: [{ external_id: 'KS-1', full_name: 'Ivanov Ivan' }] });
  assert.deepEqual(plan.former.map(f => f.external_id), ['GUEST-BAYTER-AIVI']);
  assert.equal(plan.unmatched.length, 0);
  assert.equal(plan.sessions[0].starts_at, '2026-08-22T18:45:00+04:00');
  assert.equal(plan.noSlot.length, 0);
});

test('матч вместо тренировки пропускается, сдвинутая дата исправляется, время из TIME_FIX', () => {
  const csv = sheet(['U13-A,,,,', '№,ФИ ребёнка,20,30,,', '1,Ivanov Ivan,TRUE,TRUE,,', 'ИТОГ ГРУППЫ,,,,', 'U13-B,,,,', '№,ФИ ребёнка,27,,', '1,Ivanov Ivan,TRUE,,']);
  const schedule = [{ group_name: 'U13-B', weekday: 6, starts_at: '16:45', kind: 'Групповая' }];
  const mk = (month, text) => ({ text, month, year: '2026' });
  const aug = buildAttendancePlan({ sheets: [mk('08', sheet(['U13-A,,,,', '№,ФИ ребёнка,30,,', '1,Ivanov Ivan,TRUE,,', 'ИТОГ ГРУППЫ,,,,', 'U13-B,,,,', '№,ФИ ребёнка,30,,', '1,Ivanov Ivan,TRUE,,']))], journalText: '', schedule: [], registryPlayers: [{ external_id: 'KS-1', full_name: 'Ivanov Ivan' }] });
  const a = Object.fromEntries(aug.sessions.map(s => [s.group_name, s.starts_at]));
  assert.equal(a['U13-A'], '2026-08-29T18:45:00+04:00');
  assert.equal(a['U13-B'], '2026-08-29T17:30:00+04:00');
  assert.equal(aug.shifted.length, 2);
  const sep = buildAttendancePlan({ sheets: [mk('09', csv)], journalText: '', schedule, registryPlayers: [{ external_id: 'KS-1', full_name: 'Ivanov Ivan' }] });
  assert.deepEqual(sep.excluded, ['2026-09-20 U13-A']);
  const b = sep.sessions.find(x => x.group_name === 'U13-B');
  assert.equal(b.date, '2026-09-26'); assert.equal(b.starts_at, '2026-09-26T16:45:00+04:00'); // суббота — слот расписания
});
