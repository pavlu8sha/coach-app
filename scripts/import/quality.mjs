import { pathToFileURL } from 'node:url';
import { formatReport, hasActionable, runChecks, tbilisiToday } from './quality-checks.mjs';

function usage() {
  console.log('Использование: node scripts/import/quality.mjs');
  console.log('Только чтение. Нужны SUPABASE_URL (без /rest/v1), SUPABASE_SERVICE_KEY, CLUB_ID.');
  console.log('Коды выхода: 0 — только гигиена, 1 — проблемы для родителей/тренеров, 2 — ошибка.');
}

async function getAll(base, headers, table, select, order) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const path = `${table}?select=${select}&order=${order}&limit=1000&offset=${offset}`;
    const res = await fetch(`${base}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`GET ${table}: неожиданный ответ`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  if (argv.includes('--write')) throw new Error('quality.mjs только читает; ключ --write не поддерживается');
  if (argv.length) throw new Error(`quality.mjs запускается без аргументов: ${argv.join(' ')}`);

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) {
    throw new Error('Нужны SUPABASE_URL (без /rest/v1), SUPABASE_SERVICE_KEY, CLUB_ID');
  }

  const base = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
  const load = (table, select, order) => getAll(base, headers, table, select, order);

  const [
    groups,
    players,
    matches,
    matchPlayers,
    subscriptions,
    payments,
    prices,
    pointEvents,
    rules,
    sessions,
    attendance,
    weeklySchedule,
    playerGuardians,
    linkRequests,
    users,
    coachGroups,
  ] = await Promise.all([
    load('groups', 'id,club_id,name,location', 'id'),
    load('players', 'id,club_id,group_id,full_name,birth_date,status,external_id', 'id'),
    load('matches', 'id,club_id,played_on,team,goals_for,goals_against', 'id'),
    load('match_players', 'match_id,player_id,played,goals', 'match_id,player_id'),
    load('subscriptions', 'id,player_id,group_id,month,amount_due', 'id'),
    load('payments', 'id,player_id,subscription_id,amount,paid_on', 'id'),
    load('prices', 'id,club_id,group_id,kind,amount,valid_from,valid_to', 'id'),
    load('point_events', 'id,player_id,rule_id,points,source_type,source_id', 'id'),
    load('rules', 'id,club_id,code,points', 'id'),
    load('sessions', 'id,group_id,starts_at,kind', 'id'),
    load('attendance', 'session_id,player_id,status', 'session_id,player_id'),
    load('weekly_schedule', 'id,group_id,weekday,starts_at,ends_at', 'id'),
    load('player_guardians', 'player_id,user_id,relation,consent_version,consent_given_at,consent_revoked_at', 'player_id,user_id'),
    load('link_requests', 'id,user_id,player_id,status,created_at', 'id'),
    load('users', 'id,telegram_id,is_admin', 'id'),
    load('coach_groups', 'user_id,group_id', 'user_id,group_id'),
  ]);

  const checks = runChecks({
    clubId: CLUB_ID,
    today: tbilisiToday(),
    now: new Date().toISOString(),
    groups,
    players,
    matches,
    matchPlayers,
    subscriptions,
    payments,
    prices,
    pointEvents,
    rules,
    sessions,
    attendance,
    weeklySchedule,
    playerGuardians,
    linkRequests,
    users,
    coachGroups,
  });

  console.log(formatReport(checks));
  process.exitCode = hasActionable(checks) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 2;
  });
}
