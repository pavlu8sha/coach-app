// Лист «УЧАСТИЕ» старого приложения (Состав игр: событие, игрок, «играл», голы в колонке K). Только чистые функции.
// Итоговый импорт брал «играл» из листов GAMES, а у игр турниров там отметок по датам нет: в базе остались только забившие.
import { parseCsv } from './registry.mjs';

/** УЧАСТИЕ.csv (колонки: A событие E-xxx, B игрок KS-xxxx, C ФИ, D играл TRUE/FALSE, …, K голы) → [{event, player, played, goals}] */
export function parseParticipation(text) {
  const [, ...rows] = parseCsv(text).filter(r => r.some(x => String(x).trim()));
  return rows.map(r => ({ event: (r[0] || '').trim(), player: (r[1] || '').trim(), played: (r[3] || '').trim().toUpperCase() === 'TRUE', goals: Number(r[10]) || 0 }))
    .filter(x => x.event && x.player);
}

/**
 * rows — parseParticipation; midOf: событие → id матча в базе; pidOf: KS-xxxx → id игрока в базе;
 * dbLineups: Map id матча → Map id игрока → {played, goals}. Добавляются только отсутствующие строки с played = TRUE;
 * существующие строки не меняются. Остальное (нет матча, нет игрока) возвращается в skipped для отчёта.
 */
export function missingFromParticipation({ rows, midOf, pidOf, dbLineups }) {
  const add = [], skipped = { noMatch: new Set(), noPlayer: new Set() };
  const seen = new Set();
  for (const x of rows) {
    if (!x.played) continue;
    const match_id = midOf(x.event);
    if (!match_id) { skipped.noMatch.add(x.event); continue; }
    const player_id = pidOf(x.player);
    if (!player_id) { skipped.noPlayer.add(x.player); continue; }
    const key = match_id + '|' + player_id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dbLineups.get(match_id)?.has(player_id)) continue;
    add.push({ event: x.event, match_id, player_id, played: true, goals: x.goals });
  }
  return { add, skipped };
}
