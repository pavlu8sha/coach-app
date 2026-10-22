// «Отметки»: группы индивидуальных на дату — без чтения состава из файла оплат; список групп тот же. Перенос из perf-phase1 (52f608b) без замеров.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function env() {
  let pf = 0;
  const ctx = { console: { log() {} }, CONFIG: { DRY_RUN: false }, Utilities: { formatDate: (d) => { const x = new Date(d); return String(x.getUTCDate()).padStart(2, '0') + '.' + String(x.getUTCMonth() + 1).padStart(2, '0'); } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Settings.js', 'Individual.js', 'IndRoster.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  Object.assign(ctx, {
    settingGet_: k => (k === 'ind.capGoalkeepers' ? 7 : 6),
    indParseRaw_: () => [{ date: '2026-10-25', time: '18:00', goalkeepers: false, players: [{ name: 'Old' }] },
                         { date: '2026-10-25', time: '19:00', goalkeepers: true, players: [] }],   // старое, перенесено в новые
    indAdmRows_: () => [{ row: 2, id: 'ADM|2026-10-25 19:00 gk', date: '2026-10-25', time: '19:00', gk: true, theme: '' },
                        { row: 3, id: 'ADM|2026-10-25 17:00', date: '2026-10-25', time: '17:00', gk: false, theme: '' },
                        { row: 4, id: 'ADM|2026-10-26 17:00', date: '2026-10-26', time: '17:00', gk: false, theme: '' }],
    indPfPlayers_: () => { pf++; return [{ name: 'P' }]; },
  });
  return { ctx, pf: () => pf };
}

test('indGroups_ не читает состав, а список групп и их порядок — как при полном разборе', () => {
  const e = env();
  const groups = JSON.parse(JSON.stringify(e.ctx.indGroups_('2026-10-25')));
  assert.equal(e.pf(), 0);
  assert.deepEqual(groups, [{ name: 'Индивидуальные', sched: true }, { name: 'Вратари', sched: true }]);
  // полный разбор (с составом) даёт те же занятия в том же порядке
  const full = e.ctx.indParseForDate_('2026-10-25').sort((a, b) => a.time.localeCompare(b.time)).map(x => [x.time, x.goalkeepers]);
  const light = e.ctx.indParseForDate_('2026-10-25', true).sort((a, b) => a.time.localeCompare(b.time)).map(x => [x.time, x.goalkeepers]);
  assert.deepEqual(light, full);
  assert.equal(e.pf(), 2);                       // состав читается только в полном разборе (для занятия группы)
});
