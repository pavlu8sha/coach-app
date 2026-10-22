import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, isoDate, parseRegistry } from '../../scripts/import/registry.mjs';

const HEAD = 'Реестр\n\nID,ФИ,Группа,Локация,Статус,Начало,Конец,Доп\n';

test('CSV: кавычки, запятая внутри кавычек и пустые поля', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""е"""\n1,,3'), [['a', 'b, c', 'd "е"'], ['1', '', '3']]);
});

test('дата: dd.mm.yyyy → yyyy-mm-dd, пусто → null, мусор → ошибка', () => {
  assert.equal(isoDate('17.05.2019'), '2019-05-17');
  assert.equal(isoDate(''), null);
  assert.equal(isoDate('2019-05-17'), '2019-05-17');
  assert.throws(() => isoDate('17/05/19'), /не распознана/);
  assert.equal(isoDate('46266'), '2026-09-01'); // серийный номер Sheets
  assert.equal(isoDate('46280'), '2026-09-15');
});

test('реестр: группы без дублей, статус, даты, доп. программы', () => {
  const csv = HEAD +
    'KS-0001,Krupin Gregoriy,U7-A,КРАСНЫЙ ПАРК,Активен,01.09.2026,,U13\n' +
    'KS-0002,Zlidnev Ilia,U7-A,КРАСНЫЙ ПАРК,Ушёл,,15.10.2026,\n';
  const r = parseRegistry(csv);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].name, 'U7-A');
  assert.equal(r.players.length, 2);
  assert.equal(r.players[0].status, 'active');
  assert.equal(r.players[0].starts_on, '2026-09-01');
  assert.deepEqual(r.players[0].extras, ['U13']);
  assert.equal(r.players[1].status, 'inactive');
  assert.equal(r.players[1].ends_on, '2026-10-15');
  assert.deepEqual(r.problems, []);
});

test('реестр: строка без ID или ФИ — в problems, не в базу', () => {
  const csv = HEAD + ',Без ID,U9,,Активен,,,\nKS-0003,,U9,,Активен,,,\n';
  const r = parseRegistry(csv);
  assert.equal(r.players.length, 0);
  assert.equal(r.problems.length, 2);
});
