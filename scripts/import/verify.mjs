// Сверка Supabase с выгрузкой Google Sheets. Только чтение: GET /rest/v1, без --write.
// Использование:
//   node scripts/import/verify.mjs "migration-export 2026-10-22 19-12"
//   node scripts/import/verify.mjs --dir "migration-export 2026-10-22 19-12"
// Нужны переменные окружения: SUPABASE_URL (без /rest/v1), SUPABASE_SERVICE_KEY, CLUB_ID.
// Возвращает 0, если все проверки сошлись, 1 — если есть расхождения, 2 — если проверку нельзя выполнить.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsv, parseRegistry, isoDate } from './registry.mjs';
import { parseCatalog, parseSeason } from './equipment.mjs';
import { buildPlan } from './events-plan.mjs';
import { parsePayBlock, parseSessionsSheet, replayJournal } from './individual.mjs';
import { buildIndividualPlan } from './individual-plan.mjs';
import { buildPaymentsPlan } from './payments-plan.mjs';
import { buildCampsPlan } from './camps.mjs';
import { parseGamesLog } from './games-log.mjs';

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const money = n => Math.round(Number(n || 0) * 100) / 100;
const sameMoney = (a, b) => Math.abs(money(a) - money(b)) < 0.005;
const monthOf = v => String(v || '').slice(0, 7) + '-01';

// «ID игрока,ФИ,дата рождения,…» → Map external_id → yyyy-mm-dd
export function parseBirthDates(text) {
  const out = new Map();
  const problems = [];
  for (const r of parseCsv(text)) {
    const id = (r[0] || '').trim();
    if (!id || /^ID\b/i.test(id)) continue;
    const raw = (r[2] || '').trim();
    if (!raw) continue;
    try { out.set(id, isoDate(raw)); }
    catch (e) { problems.push({ id, error: e.message }); }
  }
  return { dates: out, problems };
}

const lead = (n, width) => String(n).padStart(width);
function printTable(checks) {
  const head = ['Домен', 'Ожидалось', 'В базе', 'Разница'];
  const w = [
    Math.max(head[0].length, ...checks.map(c => c.name.length)),
    Math.max(head[1].length, ...checks.map(c => String(c.expected).length)),
    Math.max(head[2].length, ...checks.map(c => String(c.actual).length)),
    head[3].length,
  ];
  const line = `+-${'-'.repeat(w[0])}-+-${'-'.repeat(w[1])}-+-${'-'.repeat(w[2])}-+-${'-'.repeat(w[3])}-+`;
  console.log(line);
  console.log(`| ${head[0].padEnd(w[0])} | ${head[1].padStart(w[1])} | ${head[2].padStart(w[2])} | ${head[3].padStart(w[3])} |`);
  console.log(line);
  for (const c of checks) {
    const diff = c.diff === null ? '—' : (c.diff > 0 ? '+' : '') + c.diff;
    console.log(`| ${c.name.padEnd(w[0])} | ${String(c.expected).padStart(w[1])} | ${String(c.actual).padStart(w[2])} | ${diff.padStart(w[3])} |`);
  }
  console.log(line);
}

function findExportDir(arg) {
  if (arg) return path.resolve(arg);
  const cwd = process.cwd();
  const dirs = fs.readdirSync(cwd, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^migration-export/.test(d.name))
    .map(d => path.join(cwd, d.name));
  if (dirs.length === 1) return dirs[0];
  throw new Error(dirs.length ? `Найдено несколько выгрузок, укажите --dir: ${dirs.map(d => path.basename(d)).join(', ')}` : 'Не найдена папка migration-export*');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--write')) throw new Error('verify.mjs только читает; ключ --write не поддерживается');
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Использование: node scripts/import/verify.mjs [--dir] "migration-export 2026-10-22 19-12"');
    return;
  }
  const argDir = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : argv.find(a => !a.startsWith('--'));
  const dir = findExportDir(argDir);
  const read = p => fs.readFileSync(path.join(dir, p), 'utf8');

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) {
    throw new Error('Нужны SUPABASE_URL (без /rest/v1), SUPABASE_SERVICE_KEY, CLUB_ID');
  }
  const base = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
  async function get(p) {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const sep = p.includes('?') ? '&' : '?';
      const res = await fetch(`${base}/rest/v1/${p}${sep}limit=1000&offset=${offset}`, { headers });
      if (!res.ok) throw new Error(`GET ${p.split('?')[0]}: ${res.status} ${await res.text()}`);
      const page = await res.json();
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  // ---------- ожидаемое из CSV ----------
  const reg = parseRegistry(read('ATT_ID/РЕЕСТР ИГРОКОВ.csv'));
  if (reg.problems.length) throw new Error(`Реестр разобран с ошибками: ${reg.problems.map(p => `строка ${p.line}: ${p.error}`).join('; ')}`);
  const names = reg.players.map(p => p.full_name);
  const nameToExt = new Map(reg.players.map(p => [p.full_name, p.external_id]));
  const regByExt = new Map(reg.players.map(p => [p.external_id, p]));

  const catalog = parseCatalog(read('EQUIP_ID/КАТАЛОГ ЭКИПИРОВКИ.csv'));
  const equip = parseSeason(read('EQUIP_ID/СЕЗОН 2026-2027.csv'), new Map(catalog.map(k => [k.kit, k.price])));
  if (equip.problems.length) throw new Error(`Экипировка разобрана с ошибками: ${equip.problems.length}; ${equip.problems.slice(0, 5).map(p => `строка ${p.line}${p.id ? ` (${p.id})` : ''}: ${p.error}`).join('; ')}`);

  const gamesFiles = fs.readdirSync(path.join(dir, 'GAMES_ID')).filter(n => n.endsWith('.csv')).sort()
    .map(n => ({ name: n, text: read(`GAMES_ID/${n}`) }));
  const plan = buildPlan({
    eventsCsv: read('ADMIN_ID/МАТЧИ.csv'),
    feesCsv: read('ADMIN_ID/ВЗНОСЫ МАТЧЕЙ.csv'),
    gamesFiles,
    registryPlayers: reg.players,
  });
  const journal = parseGamesLog(read('GN_FILE/Игры.csv'), names);
  const extByTD = new Map(plan.matches.map(m => [m.team + '|' + m.played_on, m.external_id]));
  const scoreBy = new Map();
  const goalsBy = new Map(); // match_ext|player_ext → голы
  for (const g of journal.games) {
    const ext = extByTD.get(g.team + '|' + g.date);
    if (!ext) continue;
    scoreBy.set(ext, { goals_for: g.goals_for, goals_against: g.goals_against });
    for (const s of g.scorers) {
      const pext = s.registry_name ? nameToExt.get(s.registry_name) : null;
      if (pext) goalsBy.set(ext + '|' + pext, (goalsBy.get(ext + '|' + pext) || 0) + s.goals);
    }
  }

  const payFiles = fs.readdirSync(path.join(dir, 'PAY_ID')).filter(n => n.endsWith('.csv')).sort()
    .map(n => ({ name: n, text: read(`PAY_ID/${n}`) }));
  const paysPlan = buildPaymentsPlan({ registry: reg, files: payFiles });
  const payRows = payFiles.flatMap(f => parsePayBlock(f.text));
  const oldFiles = fs.readdirSync(path.join(dir, 'IND_ID')).filter(n => n.endsWith('.csv')).sort()
    .map(n => ({ name: n, text: read(`IND_ID/${n}`) }));
  const indPlan = buildIndividualPlan({
    registryNames: names,
    payRows,
    sessionsSheet: parseSessionsSheet(read('ADMIN_ID/ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ.csv')),
    journalBookings: replayJournal(read('ADMIN_ID/ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ.csv'), names).bookings,
    oldFiles,
  });
  const birth = parseBirthDates(read('ADMIN_ID/ДАТЫ РОЖДЕНИЯ.csv'));
  const campsPlan = buildCampsPlan({
    campsCsv: read('ADMIN_ID/СБОРЫ.csv'),
    tariffsCsv: read('ADMIN_ID/ТАРИФЫ СБОРОВ.csv'),
    participantsCsv: read('ADMIN_ID/УЧАСТНИКИ СБОРОВ.csv'),
    paymentsCsv: read('ADMIN_ID/ОПЛАТЫ СБОРОВ.csv'),
    settingsCsv: read('ADMIN_ID/НАСТРОЙКИ.csv'),
    registryPlayers: reg.players,
  });
  const prepProblems = [
    ...plan.problems.map(p => `${p.id ?? ''}: ${p.error}`),
    ...plan.gamesProblems,
    ...journal.problems.map(p => `журнал ${p.team} ${p.date}: ${p.error}`),
    ...equip.problems.map(p => `экипировка строка ${p.line}: ${p.error}`),
    ...paysPlan.problems.map(p => `оплаты строка ${p.line}: ${p.error}`),
    ...indPlan.problems.map(p => p.error),
    ...campsPlan.problems.map(p => `сборы ${p.id ?? ''}: ${p.error}`),
    ...birth.problems.map(p => `даты рождения ${p.id}: ${p.error}`),
  ];
  if (plan.unmatched.length) prepProblems.push(`не найдены в реестре (события): ${plan.unmatched.join(', ')}`);
  if (paysPlan.unmatched.length) prepProblems.push(`не найдены в реестре (оплаты): ${paysPlan.unmatched.join(', ')}`);
  if (prepProblems.length) throw new Error(`CSV разобраны с ошибками, сверка остановлена:\n  ${prepProblems.join('\n  ')}`);

  // ---------- данные из Supabase ----------
  const players = await get(`players?club_id=eq.${CLUB_ID}&select=id,external_id,full_name,birth_date`);
  const groups = await get(`groups?club_id=eq.${CLUB_ID}&select=id,name`);
  const equipCatalog = await get(`equipment_catalog?club_id=eq.${CLUB_ID}&select=id,kit,price`);
  const equipOrders = await get(`equipment_orders?club_id=eq.${CLUB_ID}&select=id,external_ord_id,player_id,total,paid`);
  const equipLines = await get('equipment_order_lines?select=order_id,kit,size,quantity,unit_price');
  const tournaments = await get(`tournaments?club_id=eq.${CLUB_ID}&select=id,external_id,team,kind,name`);
  const matches = await get(`matches?club_id=eq.${CLUB_ID}&select=id,external_id,kind,goals_for,goals_against`);
  const matchPlayers = await get('match_players?select=match_id,player_id,played,goals');
  const matchFees = await get('match_fees?select=match_id,player_id,amount,paid');
  const tFees = await get('tournament_fees?select=tournament_id,player_id,amount,paid');
  const subs = await get('subscriptions?select=id,player_id,month,amount_due');
  const payments = await get('payments?select=id,player_id,amount,legacy_ref');
  const indSessions = await get(`individual_sessions?club_id=eq.${CLUB_ID}&select=id,external_id,starts_at`);
  const indBookings = await get('individual_bookings?select=session_id,player_id,paid');
  const dbCamps = await get(`camps?club_id=eq.${CLUB_ID}&select=id,external_id,booking_fee,active`);
  const dbCampTariffs = await get('camp_tariffs?select=id,camp_id,name,price,active');
  const dbCampParticipants = await get('camp_participants?select=id,camp_id,player_id,external_id,tariff_id,amount,status');
  const dbCampPayments = await get('camp_payments?select=id,camp_id,participant_id,player_id,amount,paid_on,kind,legacy_ref');
  const dbSettings = await get(`club_settings?club_id=eq.${CLUB_ID}&select=key,scope,value,updated_at`);

  const idToExt = new Map(players.map(p => [p.id, p.external_id]));
  const playerExt = id => idToExt.get(id);
  const matchById = new Map(matches.map(m => [m.id, m]));
  const tournamentById = new Map(tournaments.map(t => [t.id, t]));

  // ---------- проверки ----------
  const checks = [];
  const check = (name, expected, actual, details = []) => {
    const numeric = typeof expected === 'number';
    const ok = numeric ? sameMoney(expected, actual) : String(expected) === String(actual);
    checks.push({ name, expected, actual, ok, diff: numeric ? money(actual) - money(expected) : (ok ? 0 : null), details: ok ? [] : details });
  };
  const setDetails = (expected, actual, label = 'элемент') => {
    const missing = [...expected].filter(x => !actual.has(x)).sort();
    const extra = [...actual].filter(x => !expected.has(x)).sort();
    const take = a => a.slice(0, 20).join(', ') + (a.length > 20 ? ` … ещё ${a.length - 20}` : '');
    const out = [];
    if (missing.length) out.push(`нет в базе (${missing.length}): ${take(missing)}`);
    if (extra.length) out.push(`лишние в базе (${extra.length}): ${take(extra)}`);
    return out;
  };
  const mapDetails = (expected, actual, format = (k, e, a) => `${k}: ожидалось ${e}, в базе ${a}`) => {
    const missing = [...expected.keys()].filter(k => !actual.has(k)).sort();
    const extra = [...actual.keys()].filter(k => !expected.has(k)).sort();
    const diff = [...expected.keys()].filter(k => actual.has(k) && !sameMoney(expected.get(k), actual.get(k))).sort();
    const take = a => a.slice(0, 20).join(', ') + (a.length > 20 ? ` … ещё ${a.length - 20}` : '');
    const out = [];
    if (missing.length) out.push(`нет в базе (${missing.length}): ${take(missing)}`);
    if (extra.length) out.push(`лишние в базе (${extra.length}): ${take(extra)}`);
    if (diff.length) out.push(`суммы/значения (${diff.length}): ${take(diff.map(k => format(k, expected.get(k), actual.get(k))))}`);
    return out;
  };
  const setMap = (map, keyFn, valFn = v => v) => new Map([...map].map(([k, v]) => [keyFn(k, v), valFn(v)]));

  // игроки: только KS-…, гости GUEST-… — отдельно от реестра
  const dbKs = new Set(players.filter(p => /^KS-/.test(p.external_id || '')).map(p => p.external_id));
  check('Игроки (KS)', reg.players.length, dbKs.size, setDetails(new Set(reg.players.map(p => p.external_id)), dbKs));
  const dbGroups = new Set(groups.map(g => g.name));
  check('Группы', reg.groups.length, dbGroups.size, setDetails(new Set(reg.groups.map(g => g.name)), dbGroups));

  // экипировка
  const expOrders = new Map(equip.orders.map(o => [o.ext_id, o]));
  const dbOrders = new Map(equipOrders.map(o => [o.external_ord_id, o]));
  check('Экипировка: каталог', catalog.length, equipCatalog.length);
  check('Экипировка: заказы', expOrders.size, dbOrders.size, setDetails(new Set(expOrders.keys()), new Set(dbOrders.keys())));
  const expLines = equip.orders.reduce((a, o) => a + o.lines.length, 0);
  const allOrderIds = new Set(equipOrders.map(o => o.id));
  const dbEquipLines = equipLines.filter(l => allOrderIds.has(l.order_id));
  check('Экипировка: строки', expLines, dbEquipLines.length);
  check('Экипировка: сумма заказов', equip.orders.reduce((a, o) => a + o.total, 0), equipOrders.reduce((a, o) => a + Number(o.total), 0));
  check('Экипировка: оплачено', equip.orders.reduce((a, o) => a + o.paid, 0), equipOrders.reduce((a, o) => a + Number(o.paid), 0));
  check('Экипировка: сумма позиций', equip.orders.reduce((a, o) => a + o.line_sum, 0), dbEquipLines.reduce((a, l) => a + Number(l.unit_price) * Number(l.quantity), 0));

  // события
  const expTour = new Set(plan.tournaments.map(t => t.external_id));
  const dbTour = new Set(tournaments.map(t => t.external_id));
  check('Турниры', expTour.size, dbTour.size, setDetails(expTour, dbTour));
  const dbMatchExt = new Set(matches.map(m => m.external_id));
  check('Матчи: всего', plan.matches.length, matches.length, setDetails(new Set(plan.matches.map(m => m.external_id)), dbMatchExt));
  check('Матчи: товарищеские', plan.matches.filter(m => m.kind === 'friendly').length, matches.filter(m => m.kind === 'friendly').length);
  check('Матчи: игры', plan.matches.filter(m => m.kind === 'game').length, matches.filter(m => m.kind === 'game').length);

  const expScores = new Map([...scoreBy].map(([ext, s]) => [ext, s]));
  const dbScores = new Map(matches.filter(m => m.goals_for !== null && m.goals_against !== null).map(m => [m.external_id, m]));
  check('Счёт: матчей', expScores.size, dbScores.size, setDetails(new Set(expScores.keys()), new Set(dbScores.keys())));
  const scoreDiff = [...expScores.keys()].filter(ext => dbScores.has(ext) && (dbScores.get(ext).goals_for !== expScores.get(ext).goals_for || dbScores.get(ext).goals_against !== expScores.get(ext).goals_against));
  check('Счёт: голы за', [...expScores.values()].reduce((a, s) => a + s.goals_for, 0), [...dbScores.values()].reduce((a, m) => a + Number(m.goals_for), 0), scoreDiff.slice(0, 20).map(ext => `${ext}: ожидалось ${expScores.get(ext).goals_for}:${expScores.get(ext).goals_against}, в базе ${dbScores.get(ext).goals_for}:${dbScores.get(ext).goals_against}`));
  check('Счёт: голы против', [...expScores.values()].reduce((a, s) => a + s.goals_against, 0), [...dbScores.values()].reduce((a, m) => a + Number(m.goals_against), 0));

  const expMpRoster = new Set(plan.matchPlayers.filter(x => nameToExt.has(x.name)).map(x => x.match_ext + '|' + nameToExt.get(x.name)));
  const expMp = new Set(expMpRoster);
  for (const k of goalsBy.keys()) expMp.add(k);
  const dbMp = new Set(matchPlayers.map(r => {
    const ext = matchById.get(r.match_id)?.external_id;
    return ext ? `${ext}|${playerExt(r.player_id) || ''}` : null;
  }).filter(Boolean).filter(k => dbMatchExt.has(k.split('|')[0])));
  const dbMpRoster = new Set([...dbMp].filter(k => expMpRoster.has(k)));
  check('Игроки матчей: состав', expMpRoster.size, dbMpRoster.size, setDetails(expMpRoster, dbMpRoster));
  check('Игроки матчей: с бомбардирами', expMp.size, dbMp.size, setDetails(expMp, dbMp));
  const expGoals = new Map(goalsBy);
  const dbGoals = new Map();
  for (const r of matchPlayers) {
    const ext = matchById.get(r.match_id)?.external_id;
    const pext = playerExt(r.player_id);
    if (ext && pext && Number(r.goals)) dbGoals.set(ext + '|' + pext, (dbGoals.get(ext + '|' + pext) || 0) + Number(r.goals));
  }
  check('Голы игроков', [...expGoals.values()].reduce((a, n) => a + n, 0), [...dbGoals.values()].reduce((a, n) => a + n, 0), mapDetails(expGoals, dbGoals));

  const expMf = new Set(plan.matchFees.filter(x => nameToExt.has(x.name)).map(x => x.match_ext + '|' + nameToExt.get(x.name)));
  const dbMf = new Set(matchFees.map(r => {
    const ext = matchById.get(r.match_id)?.external_id;
    return ext ? `${ext}|${playerExt(r.player_id) || ''}` : null;
  }).filter(Boolean).filter(k => dbMatchExt.has(k.split('|')[0])));
  check('Взносы матчей', expMf.size, dbMf.size, setDetails(expMf, dbMf));
  const dbMfIds = new Set(matches.map(m => m.id));
  check('Взносы матчей: оплачено', plan.matchFees.filter(x => x.paid).length, matchFees.filter(x => x.paid && dbMfIds.has(x.match_id)).length);

  const expTf = new Set(plan.tFees.filter(x => nameToExt.has(x.name)).map(x => x.tournament_ext + '|' + nameToExt.get(x.name)));
  const dbTf = new Set(tFees.map(r => {
    const ext = tournamentById.get(r.tournament_id)?.external_id;
    return ext ? `${ext}|${playerExt(r.player_id) || ''}` : null;
  }).filter(Boolean).filter(k => dbTour.has(k.split('|')[0])));
  check('Взносы турниров', expTf.size, dbTf.size, setDetails(expTf, dbTf));
  const dbTourIds = new Set(tournaments.map(t => t.id));
  check('Взносы турниров: не оплачено', plan.tFees.filter(x => !x.paid).length, tFees.filter(x => !x.paid && dbTourIds.has(x.tournament_id)).length);

  // оплаты
  const dbSubs = new Map();
  for (const s of subs) {
    const pext = playerExt(s.player_id);
    if (!pext || !/^KS-/.test(pext)) continue;
    dbSubs.set(`${pext}|${monthOf(s.month)}`, s);
  }
  const expSubs = new Map([...paysPlan.subs.values()].map(s => [`${s.player_ext}|${s.month}`, s.amount_due]));
  const dbSubsAmount = new Map([...dbSubs].map(([k, s]) => [k, Number(s.amount_due)]));
  check('Абонементы', expSubs.size, dbSubsAmount.size, mapDetails(expSubs, dbSubsAmount));
  const expPays = new Map(paysPlan.pays.map(p => [p.ref, p.amount]));
  const dbPayments = payments.filter(p => /^PAY_ID /.test(p.legacy_ref || ''));
  const dbPays = new Map(dbPayments.map(p => [p.legacy_ref, Number(p.amount)]));
  check('Платежи', expPays.size, dbPays.size, mapDetails(expPays, dbPays));
  check('Платежи: сумма', [...expPays.values()].reduce((a, n) => a + n, 0), [...dbPays.values()].reduce((a, n) => a + n, 0));

  // индивидуальные
  const expIndSessions = new Set(indPlan.sessions.map(s => s.external_id));
  const dbIndSessions = new Set(indSessions.map(s => s.external_id));
  check('Индивидуальные: занятия', expIndSessions.size, dbIndSessions.size, setDetails(expIndSessions, dbIndSessions));
  const expIndBookings = new Map();
  for (const b of indPlan.bookings) {
    const sess = indPlan.sessions.find(s => s.people.includes(b));
    const pext = b.external_id || nameToExt.get(b.name);
    if (sess && pext) expIndBookings.set(`${sess.external_id}|${pext}`, b.paid);
  }
  const dbIndMap = new Map(indSessions.map(s => [s.id, s.external_id]));
  const dbIndBookings = new Map();
  for (const b of indBookings) {
    const sext = dbIndMap.get(b.session_id);
    const pext = playerExt(b.player_id);
    if (sext && pext) dbIndBookings.set(`${sext}|${pext}`, b.paid);
  }
  check('Индивидуальные: записи', expIndBookings.size, dbIndBookings.size, setDetails(new Set(expIndBookings.keys()), new Set(dbIndBookings.keys())));
  check('Индивидуальные: оплачено', [...expIndBookings.values()].filter(Boolean).length, [...dbIndBookings.values()].filter(Boolean).length);
  const expGuests = new Set(indPlan.guests.map(g => indPlan.bookings.find(b => b.name === g)?.external_id).filter(Boolean));
  // GUEST-… есть и у других импортов (посещаемость, сборы): сверяем только гостей индивидуальных
  const dbGuests = new Set(players.filter(p => expGuests.has(p.external_id)).map(p => p.external_id));
  check('Индивидуальные: гости', expGuests.size, dbGuests.size, setDetails(expGuests, dbGuests));

  // сборы и настройки
  const expCampExt = new Set(campsPlan.camps.map(c => c.external_id));
  const dbCampExt = new Map(dbCamps.map(c => [c.id, c.external_id]));
  const campIds = new Set(dbCamps.filter(c => expCampExt.has(c.external_id)).map(c => c.id));
  check('Сборы', expCampExt.size, dbCamps.length, setDetails(expCampExt, new Set(dbCamps.map(c => c.external_id))));

  const expTariffs = new Set(campsPlan.tariffs.map(t => `${t.camp_ext}|${t.name}`));
  const dbTariffs = new Set(dbCampTariffs.filter(t => campIds.has(t.camp_id)).map(t => `${dbCampExt.get(t.camp_id)}|${t.name}`));
  check('Сборы: тарифы', expTariffs.size, dbTariffs.size, setDetails(expTariffs, dbTariffs));

  const expCampParticipants = new Set(campsPlan.participants.map(p => `${p.camp_ext}|${p.external_id}`));
  const dbCampParticipantsSet = new Set(dbCampParticipants.filter(p => campIds.has(p.camp_id)).map(p => `${dbCampExt.get(p.camp_id)}|${p.external_id}`));
  check('Сборы: участники', expCampParticipants.size, dbCampParticipantsSet.size, setDetails(expCampParticipants, dbCampParticipantsSet));
  const dbCampParticipantsClub = dbCampParticipants.filter(p => campIds.has(p.camp_id));
  check('Сборы: записаны', campsPlan.counts.registered, dbCampParticipantsClub.filter(p => p.status === 'registered').length);
  check('Сборы: отказ', campsPlan.counts.declined, dbCampParticipantsClub.filter(p => p.status === 'declined').length);

  const expCampPays = new Map(campsPlan.payments.map(p => [p.legacy_ref, p.amount]));
  const dbCampPays = new Map(dbCampPayments.filter(p => campIds.has(p.camp_id)).map(p => [p.legacy_ref, Number(p.amount)]));
  check('Сборы: платежи', expCampPays.size, dbCampPays.size, mapDetails(expCampPays, dbCampPays));
  check('Сборы: сумма платежей', [...expCampPays.values()].reduce((a, n) => a + n, 0), [...dbCampPays.values()].reduce((a, n) => a + n, 0));

  const expSettings = new Map(campsPlan.settings.map(s => [`${s.key}|${s.scope}`, s.value]));
  const dbSettingsMap = new Map(dbSettings.map(s => [`${s.key}|${s.scope}`, s.value]));
  check('Настройки', expSettings.size, dbSettingsMap.size, setDetails(new Set(expSettings.keys()), new Set(dbSettingsMap.keys())));
  const settingsDiff = [...expSettings].filter(([k, v]) => dbSettingsMap.has(k) && dbSettingsMap.get(k) !== v);
  check('Настройки: значения', expSettings.size, expSettings.size - settingsDiff.length - [...expSettings.keys()].filter(k => !dbSettingsMap.has(k)).length,
    settingsDiff.slice(0, 20).map(([k, v]) => `${k}: ожидалось ${v ?? 'пусто'}, в базе ${dbSettingsMap.get(k) ?? 'пусто'}`));

  // даты рождения — отдельный отчёт, не в основной таблице
  const dbBirth = new Map(players.map(p => [p.external_id, p.birth_date ? String(p.birth_date).slice(0, 10) : null]));
  const birthMismatch = [];
  for (const [ext, date] of birth.dates) {
    if (!dbBirth.has(ext)) birthMismatch.push(`${ext}: в базе нет игрока`);
    else if (dbBirth.get(ext) !== date) birthMismatch.push(`${ext}: в CSV ${date}, в базе ${dbBirth.get(ext) || 'пусто'}`);
  }

  // ---------- вывод ----------
  console.log(`Выгрузка: ${path.basename(dir)}`);
  console.log(`Проверки: ${checks.length}, расхождений: ${checks.filter(c => !c.ok).length}\n`);
  printTable(checks);
  const failed = checks.filter(c => !c.ok);
  if (failed.length) {
    console.log('\nРасхождения:');
    for (const c of failed) {
      console.log(`\n${c.name}: ожидалось ${c.expected}, в базе ${c.actual}`);
      for (const d of c.details) console.log(`  ${d}`);
    }
  }
  console.log(`\nДаты рождения: строк в CSV ${birth.dates.size}, совпало ${birth.dates.size - birthMismatch.length}, расходится ${birthMismatch.length}`);
  for (const m of birthMismatch) console.log(`  ${m}`);
  if (birth.problems.length) {
    console.log('Ошибки разбора дат рождения:');
    for (const p of birth.problems) console.log(`  ${p.id}: ${p.error}`);
  }

  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`Ошибка: ${e.message}`); process.exit(2); });
}
