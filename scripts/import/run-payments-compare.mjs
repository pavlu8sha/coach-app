// Только чтение: сверка оплат абонементов (файл оплат против базы, журнал объясняет платежи после миграции).
//   node scripts/import/run-payments-compare.mjs --registry РЕЕСТР.csv --db ПЛАТЕЖИ_БАЗА.csv [--journal АБОНЕМЕНТЫ.csv] 09.26.csv 10.26.csv 11.26.csv
// Имена файлов месяцев должны быть ММ.ГГ.csv. Код выхода 1 — есть необъяснённые расхождения.
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { buildPaymentsPlan } from './payments-plan.mjs';
import { parseDbPayments, parseJournal, comparePayments } from './payments-compare.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i < 0 ? null : args.splice(i, 2)[1]; };
const regFile = opt('--registry'), dbFile = opt('--db'), jFile = opt('--journal');
const monthFiles = args;
if (!regFile || !dbFile || !monthFiles.length) { console.error('Укажите --registry, --db и файлы месяцев ММ.ГГ.csv'); process.exit(2); }
const registry = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const plan = buildPaymentsPlan({ registry, files: monthFiles.map(f => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') })) });
const filePaid = new Map([...plan.subs.values()].map(s => [`${s.player_ext}|${s.month}`, s.amount_due]));
const journal = jFile ? parseJournal(fs.readFileSync(jFile, 'utf8')) : new Map();
// из базы берём только месяцы, для которых есть файлы
const months = new Set([...filePaid.keys()].map(k => k.split('|')[1]));
const db = parseDbPayments(fs.readFileSync(dbFile, 'utf8')).filter(d => months.has(d.month));
const r = comparePayments({ filePaid, db, journal });
console.log(`Игрок×месяц: совпало ${r.same}, объяснено журналом ${r.explained.length}, НЕ объяснено ${r.unexplained.length}, только в файле ${r.onlyFile.length}, только в базе ${r.onlyDb.length}`);
console.log(`Не найдены в реестре (пропущены): ${plan.unmatched.length}` + (plan.unmatched.length ? ': ' + plan.unmatched.join('; ') : ''));
for (const [t, a] of [['НЕ ОБЪЯСНЕНО', r.unexplained], ['ТОЛЬКО В ФАЙЛЕ', r.onlyFile], ['ТОЛЬКО В БАЗЕ', r.onlyDb], ['ОБЪЯСНЕНО ЖУРНАЛОМ', r.explained]]) {
  if (!a.length) continue;
  console.log(`\n${t}:`); a.forEach(x => console.log('  ' + JSON.stringify(x)));
}
process.exit(r.unexplained.length || r.onlyDb.length ? 1 : 0);
