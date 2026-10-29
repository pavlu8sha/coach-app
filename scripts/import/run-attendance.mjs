// Импорт истории посещаемости в Supabase. Нужна миграция 0011.
// Использование:
//   node scripts/import/run-attendance.mjs --registry РЕЕСТР.csv --schedule РАСПИСАНИЕ.csv --log Тренировки.csv --att-dir ПАПКА_ATT_ID   — проверка
//   то же + --write — записать
// В папке ATT_ID берутся листы месяцев вида 08.26.csv и «ЖУРНАЛ ПОСЕЩАЕМОСТИ.csv»: журнал приоритетнее листа (расхождения — по журналу, недостающие отметки и дни дописываются).
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { parseSchedule, parseTrainingLog } from './schedule-log.mjs';
import { buildAttendancePlan } from './attendance.mjs';
import { getAll } from './rest-all.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), schFile = arg('schedule'), attDir = arg('att-dir'), logFile = arg('log');
if (!regFile || !schFile || !attDir || !logFile) { console.error('Укажите --registry, --schedule, --log, --att-dir'); process.exit(2); }

const read = f => fs.readFileSync(f, 'utf8');
const files = fs.readdirSync(attDir);
const sheets = files.map(f => [f, f.match(/^(\d{2})\.(\d{2})\.csv$/)]).filter(([, m]) => m)
  .map(([f, m]) => ({ file: f, month: m[1], year: '20' + m[2], text: read(path.join(attDir, f)) }))
  .sort((a, b) => (a.year + a.month).localeCompare(b.year + b.month));
const journalFile = files.find(f => f.startsWith('ЖУРНАЛ ПОСЕЩАЕМОСТИ') || f.startsWith('#U0416#U0423#U0420'));
if (!sheets.length) { console.error('В папке нет листов месяцев вида 09.26.csv'); process.exit(2); }

const reg = parseRegistry(read(regFile));
const sch = parseSchedule(read(schFile));
const plan = buildAttendancePlan({
  sheets, journalText: journalFile ? read(path.join(attDir, journalFile)) : '', schedule: sch.rows, registryPlayers: reg.players,
  trainingLog: parseTrainingLog(read(logFile)).rows,
});

const present = plan.marks.filter(m => m.status === 'present').length;
console.log(`Листы: ${sheets.map(s => s.file).join(', ')}${journalFile ? '' : ' (журнала нет)'}`);
console.log(`Тренировок (группа × день): ${plan.sessions.length}. Отметок: ${plan.marks.length} (был ${present}, не был ${plan.marks.length - present})`);
const perMonth = {};
for (const s of plan.sessions) { const k = s.date.slice(0, 7); perMonth[k] = (perMonth[k] || 0) + 1; }
console.log('По месяцам (тренировок): ' + Object.entries(perMonth).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`Дней без единой галочки (не тренировка): ${plan.skipped.length}${plan.skipped.length ? ' — ' + plan.skipped.map(s => `${s.date} ${s.group}`).join('; ') : ''}`);
console.log(`Исключено как не тренировки: ${plan.excluded.join('; ') || 'нет'}. Даты исправлены: ${plan.shifted.join('; ') || 'нет'}`);
console.log(`Бывшие дети (будут добавлены как неактивные игроки): ${plan.former.length}${plan.former.length ? ' — ' + plan.former.map(f => f.full_name).join('; ') : ''}`);
console.log(`Не найдены в реестре: ${plan.unmatched.length}${plan.unmatched.length ? ' — ' + plan.unmatched.map(u => `${u.name} (${u.n})`).join('; ') : ''}`);
console.log(`Время из журнала тренировок (нет слота в расписании): ${plan.fromLog}. Дублей строк в листах с той же отметкой: ${plan.dupSame}`);
console.log(`Нет слота в расписании: ${plan.noSlot.length}${plan.noSlot.length ? ' — ' + plan.noSlot.slice(0, 15).join('; ') : ''}`);
console.log(`Несколько слотов (взято раннее время): ${plan.manySlots.length}${plan.manySlots.length ? ' — ' + plan.manySlots.slice(0, 10).join('; ') : ''}`);
const j = plan.journal;
console.log(`Отложены до перехода (не в реестре, не импортируются): ${plan.deferred.length}${plan.deferred.length ? ' — ' + plan.deferred.map(u => `${u.name} (${u.n})`).join('; ') : ''}`);
console.log(`Журнал: строк ${j.rows}, совпало с листами ${j.agree} из ${j.both}, расхождений ${j.disagree.length} (взяты из журнала), дописано из журнала ${j.journalOnly.length}, пропущено ${j.journalSkipped.length}`);
for (const d of j.disagree) console.log('  расхождение: ' + d);
for (const d of j.journalOnly) console.log('  дописано из журнала: ' + d);
for (const d of j.journalSkipped) console.log('  из журнала пропущено: ' + d);
for (const p of [...reg.problems, ...sch.problems, ...plan.problems]) console.log(`  проблема${p.line ? ' (строка ' + p.line + ')' : ''}: ${p.error}`);

if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (plan.unmatched.length || plan.noSlot.length || plan.problems.length || reg.problems.length || sch.problems.length) { console.error('Есть проблемы — запись остановлена.'); process.exit(1); }

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

const dbGroups = await rest('GET', `groups?club_id=eq.${CLUB_ID}&select=id,name`);
const gid = new Map(dbGroups.map(g => [g.name, g.id]));
const missing = [...new Set(plan.sessions.map(s => s.group_name).filter(g => !gid.has(g)))];
if (missing.length) { console.error('Группы не найдены в базе: ' + missing.join(', ')); process.exit(1); }
// 0) бывшие дети из августа — неактивные игроки без группы
if (plan.former.length) await rest('POST', 'players?on_conflict=club_id,external_id', plan.former.map(f => ({
  club_id: CLUB_ID, external_id: f.external_id, full_name: f.full_name, status: 'inactive',
})), MERGE);
const dbPlayers = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id`);
const pid = new Map(dbPlayers.map(p => [p.external_id, p.id]));
const noPlayer = [...new Set(plan.marks.map(m => m.external_id).filter(x => !pid.has(x)))];
if (noPlayer.length) { console.error('Игроки не найдены в базе: ' + noPlayer.join(', ')); process.exit(1); }

// 1) тренировки
const sRows = plan.sessions.map(s => ({ group_id: gid.get(s.group_name), starts_at: s.starts_at, kind: 'training', source_key: s.source_key }));
for (let i = 0; i < sRows.length; i += 500) await rest('POST', 'sessions?on_conflict=group_id,source_key', sRows.slice(i, i + 500), MERGE);
// 2) id тренировок
const groupIds = [...new Set(sRows.map(r => r.group_id))];
const dbSessions = await getAll(rest, `sessions?group_id=in.(${groupIds.join(',')})&source_key=like.ATT*&select=id,group_id,source_key`);
const sid = new Map(dbSessions.map(s => [`${s.group_id}|${s.source_key}`, s.id]));
// 3) отметки
const startsOf = new Map(plan.sessions.map(s => [`${s.group_name}|${s.source_key}`, s.starts_at]));
const aRows = plan.marks.map(m => ({
  session_id: sid.get(`${gid.get(m.group_name)}|${m.source_key}`), player_id: pid.get(m.external_id),
  status: m.status, marked_at: startsOf.get(`${m.group_name}|${m.source_key}`),
}));
if (aRows.some(r => !r.session_id)) { console.error('Не найден id тренировки для части отметок — запись остановлена.'); process.exit(1); }
for (let i = 0; i < aRows.length; i += 500) await rest('POST', 'attendance?on_conflict=session_id,player_id', aRows.slice(i, i + 500), MERGE);
console.log(`Записано: тренировок ${sRows.length}, отметок ${aRows.length}.`);
