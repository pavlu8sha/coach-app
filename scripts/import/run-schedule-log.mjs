// Импорт расписания и журнала тренировок в Supabase. Нужна миграция 0009.
// Использование:
//   node scripts/import/run-schedule-log.mjs --registry РЕЕСТР.csv --schedule РАСПИСАНИЕ.csv --log Тренировки.csv   — проверка
//   то же + --write — записать
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
import fs from 'node:fs';
import { parseRegistry } from './registry.mjs';
import { parseSchedule, parseTrainingLog } from './schedule-log.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), schFile = arg('schedule'), logFile = arg('log');
if (!regFile || !schFile || !logFile) { console.error('Укажите --registry, --schedule, --log'); process.exit(2); }

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const groupNames = new Set([...reg.groups.values()].map(g => g.name));
const sch = parseSchedule(fs.readFileSync(schFile, 'utf8'));
const log = parseTrainingLog(fs.readFileSync(logFile, 'utf8'));
const unknown = [...new Set(sch.rows.map(r => r.group_name).filter(g => !groupNames.has(g)))];

console.log(`Расписание: строк ${sch.rows.length} (по группам), проблем ${sch.problems.length}, неизвестных групп ${unknown.length}${unknown.length ? ': ' + unknown.join(', ') : ''}`);
console.log(`Журнал тренировок: строк ${log.rows.length}, точных дублей пропущено ${log.duplicates.length}: ${log.duplicates.join('; ')}`);
console.log(`Проведено «Нет»: ${log.rows.filter(r => !r.held).length}. Тренеров: ${new Set(log.rows.map(r => r.coach)).size}`);
for (const p of [...sch.problems, ...log.problems]) console.log(`  строка ${p.line}: ${p.error}`);
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (unknown.length || sch.problems.length || log.problems.length) { console.error('Есть проблемы — запись остановлена.'); process.exit(1); }

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function rest(method, p, body, prefer = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
    method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const MERGE = 'resolution=merge-duplicates,return=minimal';

// 1) группы клуба по имени
const dbGroups = await rest('GET', `groups?club_id=eq.${CLUB_ID}&select=id,name`);
const gid = new Map(dbGroups.map(g => [g.name, g.id]));
const missing = unknown.filter(g => !gid.has(g));
if (missing.length) { console.error('Группы не найдены в базе: ' + missing.join(', ')); process.exit(1); }

// 2) расписание
const schRows = sch.rows.map(r => ({
  group_id: gid.get(r.group_name), weekday: r.weekday, starts_at: r.starts_at, ends_at: r.ends_at,
  location: r.location, coaches: r.coaches, kind: r.kind, source_key: r.source_key,
}));
for (let i = 0; i < schRows.length; i += 500) await rest('POST', 'weekly_schedule?on_conflict=group_id,source_key', schRows.slice(i, i + 500), MERGE);

// 3) журнал тренировок
const logRows = log.rows.map(r => ({ club_id: CLUB_ID, ...r }));
for (let i = 0; i < logRows.length; i += 500) await rest('POST', 'training_log?on_conflict=club_id,external_id', logRows.slice(i, i + 500), MERGE);
console.log(`Записано: расписание ${schRows.length}, журнал тренировок ${logRows.length}.`);
