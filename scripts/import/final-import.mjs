// То же, что final-import.ps1, но на Node (не зависит от политики выполнения PowerShell).
//   node scripts/import/final-import.mjs --dir "C:\...\migration-export 2026-10-31 19-05" --mode Final              # проверка без записи
//   node scripts/import/final-import.mjs --dir "..." --mode Final --write                                         # запись
//   node scripts/import/final-import.mjs --dir "..." --mode Final --show-only                                     # только показать команды
// Режимы: Final — полный импорт (с посещаемостью и матчами); Daily (по умолчанию) — без них.
// Нужны SUPABASE_URL (без /rest/v1), CLUB_ID; ключ SUPABASE_SERVICE_KEY спросит скрипт (ввод скрыт) или возьмёт из окружения.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const flag = n => argv.includes(n);
const dirArg = opt('--dir');
const mode = opt('--mode') ?? 'Daily';
const write = flag('--write');
const showOnly = flag('--show-only');
if (!dirArg || !['Final', 'Daily'].includes(mode)) { console.error('Использование: --dir <папка выгрузки> [--mode Final|Daily] [--write] [--show-only]'); process.exit(2); }
const dir = resolve(dirArg);
if (!existsSync(dir)) { console.error(`Нет папки: ${dir}`); process.exit(2); }
if (!process.env.SUPABASE_URL || !process.env.CLUB_ID) { console.error('Задайте SUPABASE_URL и CLUB_ID (см. scripts/import/README.md).'); process.exit(2); }

function walk(d) { return readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]); }
const all = walk(dir);
const csv = name => {
  const f = all.filter(p => p.split(/[\\/]/).pop() === name);
  if (f.length !== 1) throw new Error(`В выгрузке нужен ровно один файл '${name}', найдено: ${f.length}.`);
  return f[0];
};
const sub = name => {
  const d = join(dir, name);
  if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error(`В выгрузке нет папки '${name}'.`);
  return d;
};
const ask = q => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); };
  rl.question(q, a => { rl.close(); process.stdout.write('\n'); res(a); });
});
function run(label, args) {
  if (write) args = [...args, '--write'];
  console.log(`\n== ${label}`);
  if (showOnly) { console.log('node ' + args.map(a => /\s/.test(a) ? `"${a}"` : a).join(' ')); return; }
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`Остановка: шаг '${label}' завершился с кодом ${r.status}`); process.exit(r.status || 1); }
}

try {
  if (!showOnly && !process.env.SUPABASE_SERVICE_KEY) process.env.SUPABASE_SERVICE_KEY = (await ask('Ключ (service): ')).trim();
  const reg = csv('РЕЕСТР ИГРОКОВ.csv'), sched = csv('РАСПИСАНИЕ.csv'), log = csv('Тренировки.csv');
  const S = 'scripts/import';
  const pay = sub('PAY_ID');
  run('Игроки и группы', [`${S}/run-players.mjs`, reg]);
  run('Даты рождения', [`${S}/run-birth.mjs`, '--registry', reg, '--overrides', csv('ДАТЫ РОЖДЕНИЯ.csv'), '--pay-dir', pay]);
  run('Расписание и журнал тренировок', [`${S}/run-schedule-log.mjs`, '--registry', reg, '--schedule', sched, '--log', log]);
  if (mode === 'Final') {
    run('Посещаемость', [`${S}/run-attendance.mjs`, '--registry', reg, '--schedule', sched, '--log', log, '--att-dir', sub('ATT_ID')]);
    run('Матчи: только новые, составы новых, взносы', [`${S}/run-events.mjs`, '--registry', reg, '--events', csv('МАТЧИ.csv'), '--fees', csv('ВЗНОСЫ МАТЧЕЙ.csv'), '--games', sub('GAMES_ID'), '--log', csv('Игры.csv'), '--new-only']);
  }
  const months = readdirSync(pay, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.csv')).map(e => e.name).sort().map(n => join(pay, n));
  run('Оплаты абонементов', [`${S}/run-payments.mjs`, '--registry', reg, ...months]);
  run('Индивидуальные и вратарские', [`${S}/run-individual.mjs`, '--registry', reg, '--pay-dir', pay, '--sessions', csv('ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ.csv'), '--journal', csv('ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ.csv'), '--old-dir', sub('IND_ID')]);
  run('Экипировка', [`${S}/run-equipment.mjs`, csv('КАТАЛОГ ЭКИПИРОВКИ.csv'), csv('СЕЗОН 2026-2027.csv')]);
  run('Сборы и настройки', [`${S}/run-camps-settings.mjs`, dir]);
  run('Баллы за тренировки (без матчей)', [`${S}/run-rating.mjs`]);
  if (!showOnly) {
    console.log('\n== Сверка с выгрузкой (verify)');
    const v = spawnSync(process.execPath, [`${S}/verify.mjs`, dir], { stdio: 'inherit', env: process.env });
    if (v.status !== 0) console.log(`Сверка нашла расхождения (код ${v.status}): пришлите вывод разработчику.`);
    if (mode === 'Final' && write) console.log('Готово. Дальше: «Ещё → Пересчёт баллов за матчи» в приложении (под администратором).');
  }
} catch (e) { console.error(e.message); process.exit(1); }
