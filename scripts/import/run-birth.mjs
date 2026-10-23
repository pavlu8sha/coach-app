// Даты рождения → players.birth_date. Использование:
//   node scripts/import/run-birth.mjs --registry РЕЕСТР.csv --overrides "ДАТЫ РОЖДЕНИЯ.csv" --pay-dir ПАПКА_PAY_ID   — проверка
//   то же + --write — записать (обновляет только birth_date у существующих игроков по ID)
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { buildBirthPlan } from './birth.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), ovFile = arg('overrides'), payDir = arg('pay-dir');
if (!regFile || !ovFile || !payDir) { console.error('Укажите --registry, --overrides, --pay-dir'); process.exit(2); }

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const payFiles = fs.readdirSync(payDir).map(f => [f, f.match(/^(\d{2}\.\d{2})\.csv$/)]).filter(([, m]) => m)
  .map(([f, m]) => ({ month: m[1], text: fs.readFileSync(path.join(payDir, f), 'utf8') }));
const plan = buildBirthPlan({ registryPlayers: reg.players, overridesText: fs.readFileSync(ovFile, 'utf8'), payFiles });

const list = (title, a, n = 40) => console.log(`${title}: ${a.length}${a.length ? '\n  ' + a.slice(0, n).join('\n  ') + (a.length > n ? `\n  … ещё ${a.length - n}` : '') : ''}`);
console.log(`Игроков в реестре: ${reg.players.length}. Листы оплат: ${payFiles.map(f => f.month).join(', ')}`);
console.log(`Даты найдены: ${plan.assigned.length} (вручную ${plan.assigned.filter(a => a.source === 'вручную').length}, из файлов оплат ${plan.assigned.filter(a => a.source !== 'вручную').length})`);
list('Без даты рождения', plan.missing);
list('Возраст не подходит группе (проверить)', plan.outliers);
list('Разные даты у одного имени в разных месяцах (взята более поздняя)', plan.conflicts.map(c => `${c.name}: взято ${c.used}, в другом месяце ${c.other}`));
list('Несуществующие даты в файлах оплат', plan.badFile);
list('Несуществующие даты на листе «ДАТЫ РОЖДЕНИЯ»', plan.invalidOverrides);
list('ID с листа «ДАТЫ РОЖДЕНИЯ» нет в реестре', plan.ovUnknown);
list('Одинаковые имена в реестре (дата по имени неоднозначна)', plan.dupNames);
list('Даты в файлах оплат для имён, которых нет в реестре', plan.notInRegistry);

if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function rest(method, p, body, prefer = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  const t = await res.text(); return t ? JSON.parse(t) : null;
}
const db = await rest('GET', `players?club_id=eq.${CLUB_ID}&select=external_id&limit=2000`);
const have = new Set(db.map(p => p.external_id));
const rows = plan.assigned.filter(a => have.has(a.external_id));
for (const a of rows) await rest('PATCH', `players?club_id=eq.${CLUB_ID}&external_id=eq.${encodeURIComponent(a.external_id)}`, { birth_date: a.birth_date }, 'return=minimal');
console.log(`Записано дат рождения: ${rows.length} из ${plan.assigned.length}${rows.length < plan.assigned.length ? ` (остальных игроков нет в базе)` : ''}.`);
