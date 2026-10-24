// Посещаемость тренеров для тренера: только просмотр, без часов; код тренера подходит, неверный — нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROWS = [
  ['Дата', 'День', 'Тренер', 'Локация', 'Группа', 'Тип', 'Начало', 'Конец', 'Часы', 'Проведена'],
  ['12.10.2026', 'Пн', 'Дима', 'Школа 159', 'U9', 'Групповая', '17:00', '18:30', '1,5', 'Да'],
  ['13.10.2026', 'Вт', 'Руслан', '', 'U11', 'Групповая', '18:30', '20:00', '1,5', 'Нет'],
  ['03.09.2026', 'Чт', 'Дима', '', 'U9', 'Групповая', '17:00', '18:00', '1', 'Да'],
];

function env() {
  const ctx = {
    CONFIG: {}, perfSpan_: (n, f) => f(),
    // как в NavCode.js: код тренера и администратора подходят для checkPin_, checkAdmin_ — только админ
    checkPin_: pin => { if (pin !== 'trainer' && pin !== 'admin') throw new Error('Неверный код доступа'); },
    checkAdmin_: pin => { if (pin !== 'admin') throw new Error('Неверный код администратора'); },
    ScriptApp: { getScriptId: () => 'test' },
    Utilities: {}, LockService: {}, SpreadsheetApp: {}, Logger: { log() {} }, Date, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'GamesNew.js'), 'utf8'), ctx, { filename: 'GamesNew.js' });
  // лист «Тренировки» подменяем после загрузки файла (его собственные объявления иначе перекроют заглушку)
  ctx.gnFile_ = () => ({ getSheetByName: () => ({ getDataRange: () => ({ getDisplayValues: () => ROWS }) }) });
  return ctx;
}

test('тренер видит месяцы и тренировки по коду тренера', () => {
  const c = env();
  assert.deepEqual(Array.from(c.appTrainerMonths('trainer')), ['09.2026', '10.2026']);
  const list = c.appTrainerAttendance('trainer', '10.2026');
  assert.equal(list.length, 2);
  assert.equal(list[0].trainer, 'Дима');
  assert.equal(list[0].held, true);
  assert.equal(list[1].held, false);
});

test('часы и прочие расчётные поля тренеру не отдаются', () => {
  const list = env().appTrainerAttendance('trainer', '');
  assert.equal(list.length, 3);
  for (const t of list) {
    assert.deepEqual(Object.keys(t).sort(), ['date', 'end', 'group', 'held', 'location', 'start', 'trainer', 'type']);
    assert.ok(!('hours' in t));
  }
});

test('без кода доступа ничего не отдаётся, а редактирующая страница «Учёт» остаётся только для администратора', () => {
  const c = env();
  assert.throws(() => c.appTrainerAttendance('x', ''), /код доступа/);
  assert.throws(() => c.appTrainerMonths('x'), /код доступа/);
  assert.throws(() => c.appTrainingsList('trainer', '10.2026'), /код администратора/);
  assert.throws(() => c.appAccountMonths('trainer'), /код администратора/);
});
