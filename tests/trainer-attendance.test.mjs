// «Учёт тренеров» для тренера: только просмотр (тренировки с часами, игры, статистика, расписание); код тренера подходит, неверный — нет.
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

test('тренер видит тренировки месяца вместе с часами по коду тренера', () => {
  const c = env();
  const list = c.appTrainingsList('trainer', '10.2026');
  assert.equal(list.length, 2);
  assert.equal(list[0].trainer, 'Дима');
  assert.equal(list[0].held, true);
  assert.equal(list[0].hours, 1.5);   // решение Павла 26.10: часы тренерам видны
  assert.equal(list[1].held, false);
});

test('без кода доступа ничего не отдаётся', () => {
  const c = env();
  assert.throws(() => c.appTrainingsList('x', ''), /код доступа/);
});

// Какая проверка кода стоит в начале функции
const SRC = fs.readFileSync(path.join(ROOT, 'GamesNew.js'), 'utf8');
function guard(name) {
  const i = SRC.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  return /check(Admin|Pin)_\(pin\)/.exec(SRC.slice(i, i + 400))[1];
}

test('чтение «Учёта тренеров» открыто и тренеру (checkPin_)', () => {
  for (const f of ['appAccountMonths', 'appTrainingsList', 'appGamesData', 'appDailySchedule0_']) assert.equal(guard(f), 'Pin', f);
});

test('изменения в «Учёте тренеров» остаются только для администратора (checkAdmin_)', () => {
  for (const f of ['appTrainingAdd', 'appGameStaffSet', 'appConfirmDaily', 'appAddTrainer', 'appTrainingReplaceTrainers', 'appAddTrainerDaily', 'appTrainingOptions']) assert.equal(guard(f), 'Admin', f);
});
