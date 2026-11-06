// Импорт списка первой волны: строки «Фамилия Имя» (можно CSV: имя в первой колонке, направление во второй) сопоставляются с активными игроками.
export type Dir = 'ind_sat' | 'ind_sun' | 'goalkeeper';
export interface PlayerRef { id: string; full_name: string }
export interface ImportLine { raw: string; name: string; dir: Dir | null }
export interface ImportResult {
  ok: { line: ImportLine; player: PlayerRef }[];
  ambiguous: { line: ImportLine; players: PlayerRef[] }[];
  missing: ImportLine[];
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

const dirOf = (s: string): Dir | null => {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/^(ind_sat|сб|суб)/.test(t)) return 'ind_sat';
  if (/^(ind_sun|вс|воск)/.test(t)) return 'ind_sun';
  if (/^(goalkeeper|гк|врат)/.test(t)) return 'goalkeeper';
  return null;
};

// Строки: пустые и заголовок («фамилия», «имя», «name») пропускаются; разделитель колонок ; или , или табуляция
export function parseLines(text: string): ImportLine[] {
  return text.split(/\r?\n/).map(raw => raw.trim()).filter(Boolean).flatMap((raw): ImportLine[] => {
    let cells = raw.split(/[;\t]/).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cells.length === 1) {
      // «Фамилия Имя, суббота»: направление после последней запятой
      const k = raw.lastIndexOf(',');
      if (k > 0 && dirOf(raw.slice(k + 1))) cells = [raw.slice(0, k).trim().replace(/^"|"$/g, ''), raw.slice(k + 1).trim()];
    }
    const name = cells[0] ?? '';
    if (!name || /^(фамилия|имя|фио|name|игрок|фамилия имя)$/i.test(name)) return [];
    return [{ raw, name, dir: dirOf(cells[1] ?? '') }];
  });
}

export function matchPlayers(lines: ImportLine[], players: PlayerRef[]): ImportResult {
  const byKey = new Map<string, PlayerRef[]>();
  for (const p of players) byKey.set(norm(p.full_name), [...(byKey.get(norm(p.full_name)) ?? []), p]);
  const res: ImportResult = { ok: [], ambiguous: [], missing: [] };
  for (const line of lines) {
    const found = byKey.get(norm(line.name)) ?? [];
    if (found.length === 1) res.ok.push({ line, player: found[0]! });
    else if (found.length > 1) res.ambiguous.push({ line, players: found });
    else res.missing.push(line);
  }
  return res;
}
