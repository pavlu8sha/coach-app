// Перенос истории в рейтинг: правила (rules) и начисления (point_events) по посещаемости и матчам. Нужна миграция 0012.
// Использование:
//   node scripts/import/run-rating.mjs           — проверка: читает базу, показывает расчёт, ничего не пишет
//   node scripts/import/run-rating.mjs --write   — записать правила и начисления
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
import { RULES, computeEvents, summarize } from './rating.mjs';

const write = process.argv.includes('--write');
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function rest(method, p, body, prefer = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  const t = await res.text(); return t ? JSON.parse(t) : null;
}
// Постранично (сервер отдаёт не больше 1000 строк за запрос); order нужен, чтобы страницы не пересекались
async function all(path, order) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const page = await rest('GET', `${path}${path.includes('?') ? '&' : '?'}order=${order}&limit=1000&offset=${off}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
const MERGE = 'resolution=merge-duplicates,return=minimal';
const ACTIVE_FROM = '2026-01-01'; // правила действуют на всю перенесённую историю

if (write) await rest('POST', 'rules?on_conflict=club_id,code,version', RULES.map(r => ({ club_id: CLUB_ID, version: 1, active_from: ACTIVE_FROM, ...r })), MERGE);
const rules = await rest('GET', `rules?club_id=eq.${CLUB_ID}&version=eq.1&select=id,code,points,explanation`);
const rulesByCode = Object.fromEntries(rules.map(r => [r.code, r]));
if (!write) for (const r of RULES) if (!rulesByCode[r.code]) rulesByCode[r.code] = { id: '(будет создано)', ...r };

const players = await all(`players?club_id=eq.${CLUB_ID}&select=id,full_name`, 'id');
const clubPlayers = new Set(players.map(p => p.id));
const groups = await rest('GET', `groups?club_id=eq.${CLUB_ID}&select=id`);
const gids = groups.map(g => g.id).join(',');
const sessions = await all(`sessions?group_id=in.(${gids})&select=id,starts_at`, 'id');
const sess = new Set(sessions.map(s => s.id));
const attendance = (await all('attendance?select=session_id,player_id,status', 'session_id,player_id')).filter(a => sess.has(a.session_id));
const matches = await all(`matches?club_id=eq.${CLUB_ID}&select=id,played_on,goals_for,goals_against`, 'id');
const mids = new Set(matches.map(m => m.id));
const matchPlayers = (await all('match_players?select=match_id,player_id,played', 'match_id,player_id')).filter(m => mids.has(m.match_id));

const events = computeEvents({ rulesByCode, sessions, attendance, matches, matchPlayers }).filter(e => clubPlayers.has(e.player_id));
const sum = summarize(events);
console.log(`Тренировок: ${sessions.length}, отметок: ${attendance.length}, матчей: ${matches.length} (с счётом ${matches.filter(m => m.goals_for != null && m.goals_against != null).length}), записей «играл»: ${matchPlayers.filter(m => m.played).length}`);
console.log('Начисления по правилам:');
for (const [code, v] of Object.entries(sum.byRule)) console.log(`  ${code}: ${v.n} шт., ${v.points} баллов`);
console.log(`Всего начислений: ${events.length}, баллов: ${sum.total}, игроков с баллами: ${sum.byPlayer.size}`);
const name = new Map(players.map(p => [p.id, p.full_name]));
console.log('Больше всего баллов: ' + [...sum.byPlayer].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, p]) => `${name.get(id)} ${p}`).join('; '));
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }

const rows = events.map(({ code, ...e }) => e);
for (let i = 0; i < rows.length; i += 500) await rest('POST', 'point_events?on_conflict=player_id,rule_id,source_type,source_id', rows.slice(i, i + 500), MERGE);
console.log(`Записано: правил ${RULES.length}, начислений ${rows.length}.`);
