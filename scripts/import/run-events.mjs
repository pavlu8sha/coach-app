// Импорт событий (турниры, матчи, игроки матчей, взносы) в Supabase. Нужна миграция 0007.
// Использование:
//   node scripts/import/run-events.mjs --registry РЕЕСТР.csv --events МАТЧИ.csv --fees ВЗНОСЫ_МАТЧЕЙ.csv --games ПАПКА_GAMES_ID
//   то же + --write — записать
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Повторный запуск не дублирует: все записи идут через upsert по внешним ключам (E-xxx, KS-xxxx).
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { buildPlan } from './events-plan.mjs';
import { parseGamesLog } from './games-log.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), evFile = arg('events'), feeFile = arg('fees'), gamesDir = arg('games'), logFile = arg('log');
if (!regFile || !evFile || !feeFile || !gamesDir || !logFile) {
  console.error('Укажите --registry, --events, --fees, --games (папка GAMES_ID), --log (Игры.csv)'); process.exit(2);
}

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const gamesFiles = fs.readdirSync(gamesDir).filter(n => n.endsWith('.csv')).map(n => ({ name: n, text: fs.readFileSync(path.join(gamesDir, n), 'utf8') }));
const plan = buildPlan({ eventsCsv: fs.readFileSync(evFile, 'utf8'), feesCsv: fs.readFileSync(feeFile, 'utf8'), gamesFiles, registryPlayers: reg.players });

// счёт и голы из журнала игр
const journal = parseGamesLog(fs.readFileSync(logFile, 'utf8'), reg.players.map(p => p.full_name));
const extByTD = new Map(plan.matches.map(m => [m.team + '|' + m.played_on, m.external_id]));
const scoreBy = new Map();   // match_ext → {goals_for, goals_against}
const goalsBy = new Map();   // match_ext|полное имя → голы
for (const g of journal.games) {
  const ext = extByTD.get(g.team + '|' + g.date);
  if (!ext) { journal.problems.push({ team: g.team, date: g.date, error: 'игры нет в МАТЧАХ' }); continue; }
  scoreBy.set(ext, { goals_for: g.goals_for, goals_against: g.goals_against });
  for (const s of g.scorers) goalsBy.set(ext + '|' + s.registry_name, (goalsBy.get(ext + '|' + s.registry_name) || 0) + s.goals);
}
const cnt = (a, f) => a.filter(f).length;
console.log(`Турниры ${plan.tournaments.length}, матчи ${plan.matches.length} (товарищеских ${cnt(plan.matches, m => m.kind === 'friendly')}, игр ${cnt(plan.matches, m => m.kind === 'game')})`);
console.log(`Игроки матчей ${plan.matchPlayers.length}; взносы за товарищеские ${plan.matchFees.length} (оплачено ${cnt(plan.matchFees, f => f.paid)}); взносы за турниры ${plan.tFees.length} (оплачено ${cnt(plan.tFees, f => f.paid)}, не оплачено ${cnt(plan.tFees, f => !f.paid)})`);
console.log(`Не найдены в реестре: ${plan.unmatched.length ? plan.unmatched.join(', ') : 'нет'}`);
console.log(`Счёт игр из журнала: ${scoreBy.size} из ${journal.games.length}; голы бомбардиров: ${goalsBy.size} записей`);
console.log(`Проблем: ${plan.problems.length + journal.problems.length}; без матча в МАТЧАХ: ${plan.gamesProblems.length}`);
for (const p of journal.problems) console.log(`  журнал ${p.team} ${p.date}: ${p.error}`);
for (const p of plan.problems) console.log(`  ${p.id}: ${p.error}`);
for (const g of plan.gamesProblems) console.log(`  ${g}`);
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (plan.problems.length || plan.gamesProblems.length || plan.unmatched.length || journal.problems.length) {
  console.error('Есть проблемы или несопоставленные имена — запись остановлена.'); process.exit(1);
}

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
async function upsertAll(table, onConflict, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await rest('POST', `${table}?on_conflict=${onConflict}`, rows.slice(i, i + 500), MERGE);
  }
}

// 0) игроки базы по external_id (KS-xxxx) — сначала должен быть импортирован реестр
const dbPlayers = await rest('GET', `players?club_id=eq.${CLUB_ID}&select=id,external_id`);
const pid = new Map(dbPlayers.map(p => [p.external_id, p.id]));
const regByName = new Map(reg.players.map(p => [p.full_name, p.external_id]));
const playerId = name => pid.get(regByName.get(name));
const absent = [...new Set([...plan.matchPlayers, ...plan.matchFees, ...plan.tFees].map(x => x.name).filter(n => !playerId(n)))];
if (absent.length) { console.error('Игроки не найдены в базе (сначала реестр): ' + absent.join(', ')); process.exit(1); }

// 1) турниры
await upsertAll('tournaments', 'club_id,external_id', plan.tournaments.map(t => ({
  club_id: CLUB_ID, external_id: t.external_id, team: t.team, kind: t.kind, name: t.name, fee: t.fee, starts_on: t.starts_on || null,
})));
const dbT = await rest('GET', `tournaments?club_id=eq.${CLUB_ID}&select=id,external_id`);
const tid = new Map(dbT.map(t => [t.external_id, t.id]));

// 2) матчи
await upsertAll('matches', 'club_id,external_id', plan.matches.map(m => ({
  club_id: CLUB_ID, external_id: m.external_id, team: m.team, kind: m.kind, played_on: m.played_on,
  opponent: m.opponent || null, goals_for: scoreBy.get(m.external_id)?.goals_for ?? m.goals_for ?? null,
  goals_against: scoreBy.get(m.external_id)?.goals_against ?? m.goals_against ?? null,
  tournament_id: m.tournament_ext ? (tid.get(m.tournament_ext) ?? null) : null,
})));
const dbM = await rest('GET', `matches?club_id=eq.${CLUB_ID}&select=id,external_id`);
const mid = new Map(dbM.map(m => [m.external_id, m.id]));

// 3) игроки матчей, взносы за товарищеские, взносы за турниры
// игроки матчей: составу из листа добавляем голы; бомбардиры, которых не отметили «играл», тоже попадают в состав
const mpKeys = new Set(plan.matchPlayers.map(x => x.match_ext + '|' + x.name));
const mpRows = plan.matchPlayers.map(x => ({ match_id: mid.get(x.match_ext), player_id: playerId(x.name), played: true, goals: goalsBy.get(x.match_ext + '|' + x.name) || 0 }));
for (const [k, g] of goalsBy) {
  const [ext, name] = k.split('|');
  if (!mpKeys.has(ext + '|' + name)) mpRows.push({ match_id: mid.get(ext), player_id: playerId(name), played: true, goals: g });
}
await upsertAll('match_players', 'match_id,player_id', mpRows);
await upsertAll('match_fees', 'match_id,player_id', plan.matchFees.map(x => ({
  match_id: mid.get(x.match_ext), player_id: playerId(x.name), amount: x.amount, paid: !!x.paid,
})));
await upsertAll('tournament_fees', 'tournament_id,player_id', plan.tFees.map(x => ({
  tournament_id: tid.get(x.tournament_ext), player_id: playerId(x.name), amount: x.amount, paid: !!x.paid,
})));
console.log(`Записано: счёт ${scoreBy.size} игр, голы ${goalsBy.size} записей; турниры ${plan.tournaments.length}, матчи ${plan.matches.length}, игроки матчей ${plan.matchPlayers.length}, взносы за товарищеские ${plan.matchFees.length}, взносы за турниры ${plan.tFees.length}.`);
