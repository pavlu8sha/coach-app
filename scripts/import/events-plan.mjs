// План импорта событий: турниры, матчи, игроки матчей, взносы (оплаченные и неоплаченные). Чистая функция, без сети.
import { parseCsv } from './registry.mjs';
import { parseEvents, parseFeePayments, tournamentFee, friendlyFee, NEWTON, SEASON_YEAR } from './events.mjs';
import { parseAmount } from './payments.mjs';

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// Те же правила, что в приложении (MatchesImport.js): явные соответствия U9_ALIAS_, затем сходство до 2 правок
const NAME_ALIAS = { 'kurbanoiv emin': 'Kurbanov Emin', 'ganakova varya': 'Ganakova Varvara', 'cherkasov misha': 'Cherkasov Mikhail',
  'sechko ilya': 'Siachko Ilia', 'grichshenikov sergey': 'Grichshenkov Sergey', 'grichshenikov mikhail': 'Grichshenkov Misha', 'german gio': 'German Georgiy', 'yarovoy vasya': 'Yarovoy Vasiliy', 'sechko vova': 'Siachko Vladimir' };
const SKIP_NAMES = new Set(['pashkin denis']);
const fkey = s => String(s).replace(/х/g, 'x').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
function lev(a, b) {
  let p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
}
export function resolveName(name, registryNames) {
  const alias = NAME_ALIAS[norm(name)];
  const target = alias || name;
  const exact = registryNames.find(r => norm(r) === norm(target));
  if (exact) return { name: exact, how: alias ? 'alias' : 'exact' };
  const k = fkey(target);
  const best = registryNames.map(r => [lev(k, fkey(r)), r]).sort((a, b) => a[0] - b[0]);
  if (best.length && best[0][0] <= 2 && (best.length < 2 || best[1][0] > best[0][0])) return { name: best[0][1], how: 'похоже' };
  return null;
}
const canon = s => norm(s);
const sd = s => { const m = String(s || '').trim().match(/^(\d{2})\.(\d{2})$/); return m ? `${SEASON_YEAR}-${m[2]}-${m[1]}` : null; };

// Листы GAMES_ID: каждый блок (команда + шапка) → {team, players:[{name, played:Map(date→bool), paid:Map(date→bool)}], seasonPaid:Map(name→bool)}
export function parseGamesFile(text, fileName) {
  const rows = parseCsv(text);
  const blocks = [];
  rows.forEach((r, i) => {
    if (!r[0] || r[0].trim() !== '№') return;
    const top = rows[i - 1] || [];
    let team = fileName.replace(/\.csv$/, '').replace(/ Friendly$/, '').replace(/\s*_.*$/, '').trim();
    if (team === 'U13') team = 'U13-A';
    if (/^U9-/.test((top[1] || '').trim())) team = top[1].trim();
    const hdr = r.map(x => (x || '').trim());
    const games = []; // {date, playedCol, paidCol}
    hdr.forEach((c, j) => {
      if (c !== 'Played') return;
      const d = sd((top[j] || '').trim()) || sd((top[j - 1] || '').trim());
      const paidCol = j - 1 >= 0 && hdr[j - 1] === 'Paid' ? j - 1 : null;
      games.push({ date: d, playedCol: j, paidCol });
    });
    // «Paid» один на сезон (чемпионат, U9) — отдельная колонка; в парах «Paid/Played» (товарищеские) — по дате
    const paidIdx = hdr.map((c, j) => (c === 'Paid' ? j : -1)).filter(j => j >= 0);
    const seasonPaidCol = paidIdx.length === 1 ? paidIdx[0] : null;
    if (seasonPaidCol !== null) for (const g of games) g.paidCol = null;
    const players = [];
    for (let k = i + 1; k < rows.length; k++) {
      const pr = rows[k];
      if (!pr || !/^\d+$/.test((pr[0] || '').trim())) { if (pr && (pr[0] || '').trim() === '№') break; continue; }
      const name = (pr[1] || '').trim(); if (!name) continue;
      const played = new Map(), paid = new Map();
      for (const g of games) {
        if (!g.date) continue;
        played.set(g.date, (pr[g.playedCol] || '').trim() === 'TRUE');
        if (g.paidCol !== null) paid.set(g.date, (pr[g.paidCol] || '').trim() === 'TRUE');
      }
      const seasonPaid = seasonPaidCol !== null ? (pr[seasonPaidCol] || '').trim() === 'TRUE' : null;
      players.push({ name, played, paid, seasonPaid });
    }
    blocks.push({ team, games, players });
  });
  return blocks;
}

export function buildPlan({ eventsCsv, feesCsv, gamesFiles, registryPlayers }) {
  const ev = parseEvents(eventsCsv);
  const fees = parseFeePayments(feesCsv);
  const reg = new Map(registryPlayers.map(p => [norm(p.full_name), p]));
  const regNames = registryPlayers.map(p => p.full_name);
  const unmatched = new Set();
  const resolved = new Map();
  const pl = name => {
    if (SKIP_NAMES.has(norm(name))) return null;
    if (resolved.has(name)) return resolved.get(name);
    const r = resolveName(name, regNames);
    if (!r) unmatched.add(name);
    resolved.set(name, r ? reg.get(norm(r.name)) : null);
    return resolved.get(name);
  };
  const problems = [...ev.problems];

  // турниры + Newton cup
  const tournaments = [...ev.tournaments, { ...NEWTON, fee: NEWTON.fee }];
  const tExt = new Map(tournaments.map(t => [t.external_id, t]));
  // матчи
  const matches = ev.matches.map(m => ({ ...m, fee: m.kind === 'friendly' ? friendlyFee(m.played_on) : null }));
  const mExt = new Map(matches.map(m => [m.external_id, m]));
  // соответствие «команда|дата» → событие (для листов GAMES_ID)
  const byTeamDate = new Map(matches.map(m => [m.team + '|' + m.played_on, m]));

  // отметки из GAMES_ID
  const matchPlayers = []; // {match_ext, name, played}
  const matchFees = [];    // {match_ext, name, amount, paid}
  const tFees = [];        // {tournament_ext, name, amount, paid}
  const seen = new Set();
  const gamesProblems = [];
  for (const f of gamesFiles) {
    for (const b of parseGamesFile(f.text, f.name)) {
      for (const g of b.games) {
        if (!g.date) continue;
        const m = byTeamDate.get(b.team + '|' + g.date);
        if (!m) { gamesProblems.push(`${b.team} ${g.date} нет в МАТЧАХ`); continue; }
        for (const p of b.players) {
          const pk = m.external_id + '|' + canon(p.name);
          if (seen.has(pk)) continue; seen.add(pk);
          const played = p.played.get(g.date);
          const paid = g.paidCol !== null ? p.paid.get(g.date) : null;
          if (m.kind === 'game') matchPlayers.push({ match_ext: m.external_id, name: p.name, played: !!played });
          if (m.kind === 'friendly' && (played || paid)) matchFees.push({ match_ext: m.external_id, name: p.name, amount: m.fee, paid: !!paid });
        }
      }
      // чемпионат: отметка «Paid» на сезон; неоплаченные — в турнир команды
      for (const t of tournaments.filter(t => t.team === b.team && t.kind === 'championship')) {
        for (const p of b.players) {
          if (p.seasonPaid === false) tFees.push({ tournament_ext: t.external_id, name: p.name, amount: t.fee, paid: false, source: 'GAMES' });
        }
      }
    }
  }

  // взносы из ВЗНОСЫ МАТЧЕЙ: оплаченные
  for (const r of fees) {
    if (tExt.has(r.event)) tFees.push({ tournament_ext: r.event, name: r.name, amount: r.amount, paid: r.paid, source: 'ВЗНОСЫ' });
    else if (mExt.has(r.event)) matchFees.push({ match_ext: r.event, name: r.name, amount: r.amount, paid: r.paid, source: 'ВЗНОСЫ' });
    else problems.push({ id: r.event, error: 'взнос без события' });
  }
  // Newton cup: все отмеченные оплатили и играли (лист без отметок «играл»)
  const nw = parseGamesFile(gamesFiles.find(f => /Newton/.test(f.name)).text, 'Newton cup');
  for (const b of nw) for (const p of b.players) tFees.push({ tournament_ext: NEWTON.external_id, name: p.name, amount: NEWTON.fee, paid: true, source: 'NEWTON' });

  // валидация: совпадение имён с реестром
  const allNames = [...matchPlayers, ...matchFees, ...tFees].map(x => x.name);
  for (const n of allNames) pl(n);

  return { tournaments, matches, matchPlayers, matchFees, tFees, unmatched: [...unmatched], resolved, problems, gamesProblems };
}
