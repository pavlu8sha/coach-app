// То же, что final-import.ps1, но на Node (не зависит от политики выполнения PowerShell).
//   node scripts/import/final-import.mjs --dir "C:\...\migration-export 2026-10-31 19-05" --mode Final              # проверка без записи
//   node scripts/import/final-import.mjs --dir "..." --mode Final --write                                         # запись
//   node scripts/import/final-import.mjs --dir "..." --mode Final --show-only                                     # только показать команды
//   node scripts/import/final-import.mjs --dir "..." --staff-only [--write]                                       # только штат игр (тренер, оператор)
//   --accept-payment-duplicates — запись оплат продолжать, когда находки «возможные дубли платежей» просмотрены (сдвиг номеров строк в листе оплат)
//   --accept-equipment-warnings — запись экипировки продолжать, когда предупреждения проверки заказов просмотрены (ФИ не совпало, игрок заказа другой, в базе оплачено больше)
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
const acceptEquipment = flag('--accept-equipment-warnings');
const acceptPayDup = flag('--accept-payment-duplicates');
const fullVerify = flag('--full'); // verify: расхождения без обрезки и с именами игроков
const fillLineups = flag('--fill-lineups'); // матчи: дописать в составы существующих матчей игроков, которых в базе нет (без изменения существующих строк)
const staffOnly = flag('--staff-only'); // только штат игр (тренер, оператор) у матчей, где его ещё нет; остальное не трогается
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
const csvOpt = name => { const f = all.filter(p => p.split(/[\\/]/).pop() === name); return f.length === 1 ? f[0] : null; };
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
function run(label, args, { dry = false } = {}) {
  if (write && !dry) args = [...args, '--write'];
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
  if (staffOnly) {
    run('Штат игр (только добавление недостающего)', [`${S}/run-events.mjs`, '--registry', reg, '--events', csv('МАТЧИ.csv'), '--fees', csv('ВЗНОСЫ МАТЧЕЙ.csv'), '--games', sub('GAMES_ID'), '--log', csv('Игры.csv'), '--staff-only']);
    process.exit(0);
  }
  const months = readdirSync(pay, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.csv')).map(e => e.name).sort().map(n => join(pay, n));
  const paymentsArgs = [`${S}/run-payments.mjs`, '--registry', reg, ...months, ...(acceptPayDup ? ['--accept-possible-duplicates'] : [])];
  const equipmentArgs = [`${S}/run-equipment.mjs`, csv('КАТАЛОГ ЭКИПИРОВКИ.csv'), csv('СЕЗОН 2026-2027.csv'), '--registry', reg, ...(acceptEquipment ? ['--accept-warnings'] : [])];
  // Проверка заказов экипировки до первой записи: остановка на этом шаге после записи игроков и оплат оставила бы импорт наполовину
  if (write) {
    run('Предпроверка экипировки (без записи)', equipmentArgs, { dry: true });
    run('Предпроверка оплат: возможные дубли платежей (без записи)', paymentsArgs, { dry: true });
  }
  run('Игроки и группы', [`${S}/run-players.mjs`, reg]);
  run('Даты рождения', [`${S}/run-birth.mjs`, '--registry', reg, '--overrides', csv('ДАТЫ РОЖДЕНИЯ.csv'), '--pay-dir', pay]);
  run('Расписание и журнал тренировок', [`${S}/run-schedule-log.mjs`, '--registry', reg, '--schedule', sched, '--log', log]);
  if (mode === 'Final') {
    run('Посещаемость', [`${S}/run-attendance.mjs`, '--registry', reg, '--schedule', sched, '--log', log, '--att-dir', sub('ATT_ID')]);
    run('Матчи: только новые, составы новых, взносы', [`${S}/run-events.mjs`, '--registry', reg, '--events', csv('МАТЧИ.csv'), '--fees', csv('ВЗНОСЫ МАТЧЕЙ.csv'), '--games', sub('GAMES_ID'), '--log', csv('Игры.csv'), '--new-only', ...(fillLineups ? ['--fill-lineups'] : [])]);
  }
  run('Оплаты абонементов', paymentsArgs);
  run('Индивидуальные и вратарские', [`${S}/run-individual.mjs`, '--registry', reg, '--pay-dir', pay, '--sessions', csv('ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ.csv'), '--journal', csv('ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ.csv'), '--old-dir', sub('IND_ID')]);
  const extraPrices = csvOpt('ДОПОЛНИТЕЛЬНЫЕ ТРЕНИРОВКИ.csv'), extraJournal = csvOpt('ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ.csv');
  run('Дополнительные тренировки', [`${S}/run-extra.mjs`, '--registry', reg, '--dir', sub('EXTRA_ID'), ...(extraPrices ? ['--prices', extraPrices] : []), ...(extraJournal ? ['--journal', extraJournal] : []), '--year', String(new Date().getFullYear())]);
  run('Экипировка', equipmentArgs);
  run('Сборы и настройки', [`${S}/run-camps-settings.mjs`, dir]);
  run('Баллы за тренировки (без матчей)', [`${S}/run-rating.mjs`]);
  if (!showOnly) {
    console.log('\n== Сверка с выгрузкой (verify)');
    const v = spawnSync(process.execPath, [`${S}/verify.mjs`, dir, ...(fullVerify ? ['--full'] : [])], { stdio: 'inherit', env: process.env });
    if (v.status !== 0) console.log(`Сверка нашла расхождения (код ${v.status}): пришлите вывод разработчику.`);
    if (mode === 'Final' && write) console.log('Готово. Дальше: «Ещё → Пересчёт баллов за матчи» в приложении (под администратором).');
  }
} catch (e) { console.error(e.message); process.exit(1); }
