// Дозапись состава существующих матчей (--new-only --fill-lineups): только чистые функции.
// В старом приложении у игрока стоит «играл», а в составе матча в базе его нет (строки нет вообще). Такие строки добавляются;
// существующие строки состава (в том числе правленные в приложении) не меняются и не удаляются.

// matchPlayers: [{ match_ext, name }]; goalsBy: Map «E-xxx|имя» → голы; midOf: ext → id матча в базе (только существующие);
// playerId: имя → id игрока; dbLineups: Map id матча → Set id игроков (строки match_players в базе).
// Матч без единой строки состава сюда не попадает: им занимается обычный --new-only (состав пишется целиком).
export function missingLineup({ matchPlayers, goalsBy, midOf, playerId, dbLineups }) {
  const want = new Map();
  for (const x of matchPlayers) want.set(`${x.match_ext}|${x.name}`, { match_ext: x.match_ext, name: x.name });
  for (const k of goalsBy.keys()) { const [ext, name] = k.split('|'); if (!want.has(k)) want.set(k, { match_ext: ext, name }); }
  const out = [];
  for (const w of want.values()) {
    const match_id = midOf(w.match_ext), player_id = playerId(w.name);
    const have = match_id ? dbLineups.get(match_id) : null;
    if (!match_id || !player_id || !have || have.has(player_id)) continue;
    out.push({ ...w, match_id, player_id, goals: goalsBy.get(`${w.match_ext}|${w.name}`) || 0 });
  }
  return out.sort((a, b) => a.match_ext.localeCompare(b.match_ext) || a.name.localeCompare(b.name));
}
