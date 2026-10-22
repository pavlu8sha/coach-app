// План импорта событий: турниры, матчи, игроки матчей, взносы. Чистая функция, без сети.
// Правила: журнал «ВЗНОСЫ МАТЧЕЙ» — главный источник оплат; лист GAMES_ID — состав, «играл» и резерв для «не оплачено».
import { parseCsv } from './registry.mjs';
import { parseEvents, parseFeePayments, friendlyFee, NEWTON, SEASON_YEAR } from './events.mjs';
import { parseAmount } from './payments.mjs';

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// Соответствия имён — как в приложении (MatchesImport.js): явный список + сходство до 2 правок
const NAME_ALIAS = {
  'kurbanoiv emin': 'Kurbanov Emin', 'ganakova varya': 'Ganakova Varvara', 'cherkasov misha': 'Cherkasov Mikhail',
  'sechko ilya': 'Siachko Ilia', 'grichshenikov sergey': 'Grichshenkov Sergey', 'grichshenikov mikhail': 'Grichshenkov Misha',
  'german gio': 'German Georgiy', 'yarovoy vasya': 'Yarovoy Vasiliy', 'sechko vova': 'Siachko Vladimir',
};
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

// Лист GAMES_ID → блоки (команда, игры по датам, игроки с отметками)
export function parseGamesFile(text, fileName) {
  const rows = parseCsv(text);
  const heads = rows.map((r, i) => (r[0] || '').trim() === '№' ? i : -1).filter(i => i >= 0);
  return heads.map((hi, bi) => {
    const top = rows[hi - 1] || [];
    let team = fileName.replace(/\.csv$/, '').replace(/ Friendly$/, '').replace(/\s*_.*$/, '').trim();
    if (team === 'U13') team = 'U13-A';
    if (/^U9-/.test((top[1] || '').trim())) team = top[1].trim();
    const hdr = rows[hi].map(x => (x || '').trim());
    // «Paid» над чемпионатом (название «Championship …» в шапке над колонкой) — отметка на турнир;
    // «Paid» перед «Played» у товарищеских — оплата этой даты
    const labelAt = j => { for (let q = j; q >= 0; q--) if (/Championship|Festival/.test(top[q] || '')) return (top[q] || '').trim(); return ''; };
    const tournamentPaid = []; // {label, col}
    hdr.forEach((c, j) => {
      if (c !== 'Paid') return;
      const label = labelAt(j);
      if (label) tournamentPaid.push({ label, col: j });
    });
    const tPaidCols = new Set(tournamentPaid.map(t => t.col));
    const games = []; // {date, playedCol, paidCol}
    hdr.forEach((c, j) => {
      if (c !== 'Played') return;
      const d = sdate((top[j] || '').trim()) || sdate((top[j - 1] || '').trim());
      const paidCol = j - 1 >= 0 && hdr[j - 1] === 'Paid' && !tPaidCols.has(j - 1) ? j - 1 : null;
      games.push({ date: d, playedCol: j, paidCol });
    });
    const end = heads[bi + 1] ?? rows.length;
    const players = [];
    for (let k = hi + 1; k < end; k++) {
      const pr = rows[k];
      if (!pr || !/^\d+$/.test((pr[0] || '').trim())) continue;
      const name = (pr[1] || '').trim(); if (!name) continue;
      const played = new Map(), paid = new Map();
      for (const g of games) if (g.date) {
        played.set(g.date, (pr[g.playedCol] || '').trim() === 'TRUE');
        if (g.paidCol !== null) paid.set(g.date, (pr[g.paidCol] || '').trim() === 'TRUE');
      }
      const anyPlayed = games.some(g => (pr[g.playedCol] || '').trim() === 'TRUE');
      const tPaid = new Map(tournamentPaid.map(t => [t.label, (pr[t.col] || '').trim() === 'TRUE']));
      const tMarked = new Map(tournamentPaid.map(t => [t.label, (pr[t.col] || '').trim()]));
      players.push({ name, played, paid, anyPlayed, tPaid, tMarked });
    }
    return { team, games, tournamentPaid: tournamentPaid.map(t => t.label), players };
  });
}
function sdate(d) { const m = String(d || '').trim().match(/^(\d{2})\.(\d{2})$/); return m ? `${SEASON_YEAR}-${m[2]}-${m[1]}` : null; }

export function buildPlan({ eventsCsv, feesCsv, gamesFiles, registryPlayers }) {
  const ev = parseEvents(eventsCsv);
  const fees = parseFeePayments(feesCsv);
  const regNames = registryPlayers.map(p => p.full_name);
  const regByName = new Map(registryPlayers.map(p => [norm(p.full_name), p]));
  const unmatched = new Set();
  const resolved = new Map();
  const pl = name => {
    if (SKIP_NAMES.has(norm(name))) return null;
    if (resolved.has(name)) return resolved.get(name);
    const r = resolveName(name, regNames);
    if (!r) unmatched.add(name);
    resolved.set(name, r ? regByName.get(norm(r.name)) : null);
    return resolved.get(name);
  };
  const problems = [...ev.problems];

  const tournaments = [...ev.tournaments, { ...NEWTON }];
  const tExt = new Map(tournaments.map(t => [t.external_id, t]));
  // Даты, исправленные по журналу игр (подтверждено тренером): в листе МАТЧИ стояла 18.10, верно 17.10
  const DATE_FIX = { 'E-119': '2026-10-17' };
  const matches = ev.matches.map(m => { const played_on = DATE_FIX[m.external_id] ?? m.played_on; return { ...m, played_on, fee: m.kind === 'friendly' ? friendlyFee(played_on) : null }; });
  const mExt = new Map(matches.map(m => [m.external_id, m]));
  const byTeamDate = new Map(matches.map(m => [m.team + '|' + m.played_on, m]));

  // журнал оплат: оплачено (event|игрок)
  const ledger = new Map(); // key → {amount, source}
  for (const r of fees) {
    const p = pl(r.name);
    if (!p) continue;
    if (!tExt.has(r.event) && !mExt.has(r.event)) { problems.push({ id: r.event, error: 'взнос без события' }); continue; }
    if (r.paid) ledger.set(r.event + "|" + p.external_id, r.amount);
  }

  const matchPlayers = [], matchFees = [], tFees = [];
  const seenMP = new Set(), seenMF = new Set(), seenTF = new Set();
  const gamesProblems = [];
  const sheetPaid = new Map(); // турнир|игрок → TRUE в листе (для проверки «оплачено в листе, нет в журнале»)

  for (const f of gamesFiles) {
    for (const b of parseGamesFile(f.text, f.name)) {
      for (const g of b.games) {
        if (!g.date) continue;
        const m = byTeamDate.get(b.team + '|' + g.date);
        if (!m) { gamesProblems.push(`${b.team} ${g.date} нет в МАТЧАХ`); continue; }
        for (const pp of b.players) {
          const p = pl(pp.name); if (!p) continue;
          const played = !!pp.played.get(g.date);
          const sPaid = g.paidCol !== null ? !!pp.paid.get(g.date) : false;
          if (m.kind === 'game') {
            if (played && !seenMP.has(m.external_id + p.external_id)) { seenMP.add(m.external_id + p.external_id); matchPlayers.push({ match_ext: m.external_id, name: p.full_name, played: true }); }
          }
          // взнос только у тех, кто играл; отметка «оплатил» без игры в листе не учитывается
          if (m.kind === 'friendly' && played) {
            const k = m.external_id + p.external_id;
            if (!seenMF.has(k)) {
              seenMF.add(k);
              const lp = ledger.has(m.external_id + "|" + p.external_id);
              matchFees.push({ match_ext: m.external_id, name: p.full_name, amount: m.fee, paid: lp, src: lp ? 'ВЗНОСЫ' : 'нет оплаты' });
            }
          }
        }
      }
      // турниры: состав из листа; оплачено — журнал или отметка «Paid» на турнир
      for (const pp of b.players) {
        const p = pl(pp.name); if (!p) continue;
        for (const t of tournaments.filter(t => t.team === b.team && t.kind !== 'cup' && b.tournamentPaid.includes(t.name))) {
          const k = t.external_id + p.external_id;
          if (seenTF.has(k)) continue;
          const mark = pp.tMarked.get(t.name) || '';
          const inRoster = mark === 'TRUE' || mark === 'FALSE'; // как в приложении: в составе турнира только с отметкой Paid
          if (!inRoster) continue;
          seenTF.add(k);
          const lp = ledger.has(t.external_id + "|" + p.external_id);
          const sp = pp.tPaid.get(t.name) === true;
          if (sp && !lp) problems.push({ id: t.external_id, error: `${p.full_name}: в листе оплачено, в журнале нет` });
          tFees.push({ tournament_ext: t.external_id, name: p.full_name, amount: t.fee, paid: lp || sp, src: lp ? 'ВЗНОСЫ' : (sp ? 'GAMES' : 'нет оплаты') });
        }
      }
    }
  }

  // журнал: оплаты за турниры (чемпионат, фестиваль, Newton) и за товарищеские, которых не было в листах
  for (const [key, amount] of ledger) {
    const [ext, pid] = key.split('|');
    const name = registryPlayers.find(p => p.external_id === pid)?.full_name ?? pid;
    if (tExt.has(ext)) {
      if (!seenTF.has(ext + pid)) { seenTF.add(ext + pid); tFees.push({ tournament_ext: ext, name, amount, paid: true, src: 'ВЗНОСЫ' }); }
    } else if (mExt.has(ext)) {
      if (!seenMF.has(ext + pid)) { seenMF.add(ext + pid); matchFees.push({ match_ext: ext, name, amount, paid: true, src: 'ВЗНОСЫ' }); }
    }
  }
  // Newton cup: все отмеченные в листе оплатили и играли (отметок «играл» нет)
  const nwFile = gamesFiles.find(f => /Newton/.test(f.name));
  if (nwFile) for (const b of parseGamesFile(nwFile.text, 'Newton cup')) for (const pp of b.players) {
    const p = pl(pp.name); if (!p) continue;
    const k = NEWTON.external_id + p.external_id;
    if (!seenTF.has(k)) { seenTF.add(k); tFees.push({ tournament_ext: NEWTON.external_id, name: p.full_name, amount: NEWTON.fee, paid: true, src: 'NEWTON' }); }
  }

  return { tournaments, matches, matchPlayers, matchFees, tFees, unmatched: [...unmatched], resolved, problems, gamesProblems, sheetPaid };
}
