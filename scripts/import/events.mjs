// Разбор событий и взносов: лист МАТЧИ, ВЗНОСЫ МАТЧЕЙ, листы GAMES_ID. Чистые функции, без сети.
import { parseCsv } from './registry.mjs';
import { parseAmount } from './payments.mjs';

export const SEASON_YEAR = 2026;
export const FRIENDLY_CHANGE = '2026-08-01'; // товарищеская: 20 ₾ до этой даты, 25 ₾ с неё
export const NEWTON = { external_id: 'NEWTON-2014-2015-06-14', team: 'U12', kind: 'cup', name: 'Newton cup 2014-2015', fee: 50, starts_on: '2026-06-14' };

const iso = d => { const m = String(d || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const sheetDate = d => { const m = String(d || '').trim().match(/^(\d{2})\.(\d{2})$/); return m ? `${SEASON_YEAR}-${m[2]}-${m[1]}` : null; };

export function friendlyFee(isoDate) {
  return isoDate < FRIENDLY_CHANGE ? 20 : 25;
}
export function tournamentFee(team, kind) {
  if (kind === 'festival') return 100;
  if (kind === 'championship') return team === 'U13-A' ? 300 : 200;
  throw new Error('нет правила взноса: ' + kind + ' ' + team);
}

// МАТЧИ: турниры (Чемпионат/Фестиваль), товарищеские игры и игры внутри турнира
export function parseEvents(text) {
  const rows = parseCsv(text).slice(1);
  const tournaments = [], matches = [], problems = [];
  for (const r of rows) {
    const [id, team, type, name, date, feeCell, tid, opponent, gf, ga] = r.map(x => (x || '').trim());
    if (!id) continue;
    try {
      if (type === 'Чемпионат' || type === 'Фестиваль') {
        const kind = type === 'Чемпионат' ? 'championship' : 'festival';
        tournaments.push({ external_id: id, team, kind, name, fee: feeCell ? parseAmount(feeCell) : tournamentFee(team, kind), starts_on: iso(date) });
      } else if (type === 'Товарищеская') {
        const d = iso(date);
        if (!d) throw new Error('товарищеская без даты');
        matches.push({ external_id: id, team, kind: 'friendly', tournament_ext: null, played_on: d, opponent: opponent || null, goals_for: null, goals_against: null, fee: friendlyFee(d) });
      } else if (type === 'Игра') {
        const d = iso(date);
        if (!d) { problems.push({ id, error: 'игра без даты' }); continue; }
        matches.push({ external_id: id, team, kind: 'game', tournament_ext: tid || null, played_on: d, opponent: opponent || null,
          goals_for: gf === '' ? null : Number(gf), goals_against: ga === '' ? null : Number(ga), fee: null });
      }
    } catch (e) { problems.push({ id, error: e.message }); }
  }
  return { tournaments, matches, problems };
}

// ВЗНОСЫ МАТЧЕЙ: суммы по событию и игроку (0 — скидка/бесплатно, paid = TRUE)
export function parseFeePayments(text) {
  return parseCsv(text).slice(1).filter(r => (r[0] || '').trim()).map(r => ({
    event: r[0].trim(), player_ext: (r[1] || '').trim(), name: (r[2] || '').trim(),
    paid: (r[3] || '').trim() === 'TRUE', amount: parseAmount(r[4]), comment: (r[7] || '').trim(),
  }));
}

// Лист GAMES_ID: отметки по датам. Для товарищеских — пары «Paid/Played» на дату; для турниров — Paid один на сезон.
export function parseGamesSheet(text) {
  const rows = parseCsv(text);
  const h = rows.findIndex(r => (r[0] || '').trim() === '№');
  if (h < 0) return { players: [], played: [], paidPairs: [], seasonPaid: null };
  const hdr = rows[h].map(x => (x || '').trim());
  const top = h > 0 ? rows[h - 1] : [];
  const players = [];
  for (const r of rows.slice(h + 1)) {
    if (!r || !/^\d+$/.test((r[0] || '').trim())) continue;
    const name = (r[1] || '').trim(); if (!name) continue;
    players.push({ name, cells: r });
  }
  // колонки игр: «Played» с датой над ней (или слева, если дата над Paid)
  const played = [];
  hdr.forEach((c, j) => {
    if (c !== 'Played') return;
    const d = (top[j] || '').trim() || (top[j - 1] || '').trim();
    const paidCol = j - 1 >= 0 && hdr[j - 1] === 'Paid' ? j - 1 : null;
    played.push({ date: sheetDate(d), col: j, paidCol });
  });
  const seasonPaidCol = hdr.indexOf('Paid') >= 0 && !played.some(p => p.paidCol === hdr.indexOf('Paid')) ? hdr.indexOf('Paid') : null;
  return { players, played, seasonPaidCol };
}
