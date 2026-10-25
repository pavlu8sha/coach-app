import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGamesLog } from '../../scripts/import/games-log.mjs';

const head = 'Дата,Команда,Соперник,Счёт,Голы,Сотрудник,Роль,Регламент\n';

test('штат игры: строки под объединёнными ячейками относятся к той же игре', () => {
  const csv = head +
    '03.10.2026,U9,Динамо,2:1,Иванов - 2,Павел,Тренер,Да\n' +
    ',,,,,Соприк,Оператор,Нет\n' +
    '04.10.2026,U10,Сансона,0:0,,Дима,Тренер,Да\n';
  const { games } = parseGamesLog(csv, ["Иванов"]);
  assert.equal(games.length, 2);
  assert.deepEqual(games[0].staff, [{ name: 'Павел', role: 'Тренер', reg: true }, { name: 'Соприк', role: 'Оператор', reg: false }]);
  assert.deepEqual(games[1].staff, [{ name: 'Дима', role: 'Тренер', reg: true }]);
});

test('строка тренировки после игры не попадает в штат игры', () => {
  const csv = head +
    '03.10.2026,U9,Динамо,2:1,,Павел,Тренер,Да\n' +
    '05.10.2026,,,,,Цотне,Тренер,Да\n';
  const { games } = parseGamesLog(csv, []);
  assert.equal(games[0].staff.length, 1);
});
