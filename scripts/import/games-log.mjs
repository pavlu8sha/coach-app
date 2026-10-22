// Журнал игр (лист «Игры» из таблицы тренеров): счёт и бомбардиры. Чистая функция, без сети.
// Счёт «3:0 (техн.)» и «1:2 (пен.)» — берётся число до скобок; пометка сохраняется в note.
import { parseCsv } from './registry.mjs';
import { resolveName } from './events-plan.mjs';

// Фамилии из журнала, которые не совпадают с реестром: однозначное соответствие (одна фамилия в реестре)
const SCORER_ALIAS = {
  'procenko': 'Protsenko Kostya', 'holubov': 'Holubov Denys', 'janashvili': 'Janashvili Luka',
  'plakhotnik': 'Plakhotnik Kirill', 'liashenko': 'Liashenko Kyryl',
};
// Не игроки: автогол соперника и отметка «-» (без бомбардира)
const NOT_PLAYER = new Set(['автогол', '-', '']);

const sdate = s => { const m = String(s || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// «Name - 3, Name - 2, Name» → [{name, goals}]
export function parseScorers(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(.*?)\s*-\s*(\d+)$/);
    return m ? { name: m[1].trim(), goals: Number(m[2]) } : { name: s, goals: 1 };
  });
}

export function parseGamesLog(text, registryNames) {
  const rows = parseCsv(text).slice(1);
  const games = [], problems = [];
  for (const r of rows) {
    const date = sdate(r[0]); const team = (r[1] || '').trim(); const score = (r[3] || '').trim();
    if (!date || !team || !score) continue;   // строки тренировок и пустые — не игры
    const m = score.match(/^(\d+):(\d+)\s*(\((.*)\))?$/);
    if (!m) { problems.push({ team, date, error: `счёт не разобран: ${score}` }); continue; }
    const scorers = parseScorers(r[4]).filter(s => !NOT_PLAYER.has(s.name.toLowerCase())).map(s => {
      const alias = SCORER_ALIAS[s.name.toLowerCase()];
      const res = alias ? { name: alias } : resolveName(s.name, registryNames);
      if (!res) problems.push({ team, date, error: `бомбардир не найден в реестре: ${s.name}` });
      return { ...s, registry_name: res ? res.name : null };
    });
    games.push({ team, date, opponent: (r[2] || '').trim() || null, goals_for: Number(m[1]), goals_against: Number(m[2]), note: m[4] || null, scorers });
  }
  return { games, problems };
}
