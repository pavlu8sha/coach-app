// Дописывает в базу игравших из листа «УЧАСТИЕ» старого приложения (составы матчей). По умолчанию только читает и печатает отчёт.
//   node scripts/import/run-participation-fill.mjs --file УЧАСТИЕ.csv [--write]
// Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Существующие строки состава (в т.ч. правленные в приложении) не меняются.
import fs from 'node:fs';
import { getAll, chunkByMatch } from './rest-all.mjs';
import { parseParticipation, missingFromParticipation } from './participation-fill.mjs';

const args = process.argv.slice(2);
const fi = args.indexOf('--file'), file = fi < 0 ? null : args[fi + 1], write = args.includes('--write');
if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { console.error('--file должен указывать на файл УЧАСТИЕ.csv (не на папку)'); process.exit(2); }
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function rest(method, p, body, prefer = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const rows = parseParticipation(fs.readFileSync(file, 'utf8'));
const matches = await getAll(rest, `matches?club_id=eq.${CLUB_ID}&select=id,external_id,played_on,team`);
const midByExt = new Map(matches.map(m => [m.external_id, m.id]));
const infoById = new Map(matches.map(m => [m.id, m]));
const players = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id`);
const pidByExt = new Map(players.map(p => [p.external_id, p.id]));
const dbLineups = new Map();
for (const r of await getAll(rest, 'match_players?select=match_id,player_id,played,goals', 'match_id,player_id')) {
  if (!dbLineups.has(r.match_id)) dbLineups.set(r.match_id, new Map());
  dbLineups.get(r.match_id).set(r.player_id, r);
}
const { add, skipped } = missingFromParticipation({ rows, midOf: e => midByExt.get(e), pidOf: p => pidByExt.get(p), dbLineups });
console.log(`Строк УЧАСТИЯ: ${rows.length}, из них «играл»: ${rows.filter(x => x.played).length}`);
console.log(`Событий без матча в базе (турниры и т.п.): ${skipped.noMatch.size}; игроков без записи в базе: ${skipped.noPlayer.size} ${[...skipped.noPlayer].slice(0, 10).join(' ')}`);
const byMatch = new Map();
for (const a of add) byMatch.set(a.match_id, (byMatch.get(a.match_id) ?? 0) + 1);
console.log(`Будет добавлено игроков: ${add.length} в ${byMatch.size} матчах (строки базы не меняются):`);
for (const [id, n] of [...byMatch].sort((a, b) => (infoById.get(b[0]).played_on).localeCompare(infoById.get(a[0]).played_on))) { const m = infoById.get(id); console.log(`  ${m.played_on} ${m.team} ${m.external_id}: +${n}`); }
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
for (const chunk of chunkByMatch(add.map(a => ({ match_id: a.match_id, player_id: a.player_id, played: true, goals: a.goals })))) {
  await rest('POST', 'match_players?on_conflict=match_id,player_id', chunk, 'resolution=ignore-duplicates,return=minimal');
}
console.log(`Записано: ${add.length} игроков.`);
