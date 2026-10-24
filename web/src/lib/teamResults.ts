// Командные итоги по сыгранным матчам: без личных голов и передач, только результат команды.
export interface Played { played_on: string; opponent: string | null; goals_for: number; goals_against: number }

export interface TeamResults {
  games: number; wins: number; draws: number; losses: number;
  goalsFor: number; goalsAgainst: number;
  unbeaten: number; // матчей подряд без поражений, считая от самого свежего
  best: Played | null; // самая крупная победа (по разнице, затем по забитым)
}

export function teamResults(matches: Played[]): TeamResults {
  const sorted = [...matches].sort((a, b) => (a.played_on < b.played_on ? 1 : a.played_on > b.played_on ? -1 : 0)); // свежие первыми
  const r: TeamResults = { games: sorted.length, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, unbeaten: 0, best: null };
  let streak = true;
  for (const m of sorted) {
    const d = m.goals_for - m.goals_against;
    r.goalsFor += m.goals_for;
    r.goalsAgainst += m.goals_against;
    if (d > 0) r.wins++; else if (d < 0) r.losses++; else r.draws++;
    if (streak && d >= 0) r.unbeaten++; else streak = false;
    if (d > 0 && (!r.best || d > r.best.goals_for - r.best.goals_against || (d === r.best.goals_for - r.best.goals_against && m.goals_for > r.best.goals_for))) r.best = m;
  }
  return r;
}
