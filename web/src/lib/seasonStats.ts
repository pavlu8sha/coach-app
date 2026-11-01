export interface ScoredMatch { played_on: string; opponent?: string | null; goals_for: number | null; goals_against: number | null }

// Серия побед до последнего матча периода и самая крупная победа. Матчи без счёта не учитываются.
export function matchHighlights(list: ScoredMatch[]): { streak: number; best: (ScoredMatch & { goals_for: number; goals_against: number }) | null } {
  const done = list
    .filter((m): m is ScoredMatch & { goals_for: number; goals_against: number } => m.goals_for !== null && m.goals_against !== null)
    .sort((a, b) => (a.played_on < b.played_on ? 1 : a.played_on > b.played_on ? -1 : 0)); // новые сверху
  let streak = 0;
  for (const m of done) {
    if (m.goals_for > m.goals_against) streak++;
    else break;
  }
  let best: (typeof done)[number] | null = null;
  for (const m of done) {
    if (m.goals_for <= m.goals_against) continue;
    const d = m.goals_for - m.goals_against;
    if (!best || d > best.goals_for - best.goals_against || (d === best.goals_for - best.goals_against && m.goals_for > best.goals_for)) best = m;
  }
  return { streak, best };
}

// Начало текущего сезона: 1 сентября (до сентября — прошлого года).
export function seasonStart(iso: string): string {
  const y = Number(iso.slice(0, 4));
  return `${Number(iso.slice(5, 7)) >= 9 ? y : y - 1}-09-01`;
}
