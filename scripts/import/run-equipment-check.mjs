// Только чтение: проверка листа заказов перед run-equipment.mjs --write.
//   node scripts/import/run-equipment-check.mjs КАТАЛОГ.csv СЕЗОН.csv РЕЕСТР.csv [--baseline СЕЗОН_эталон.csv]
// Код выхода 1 — есть ошибки (запись запрещена), 0 — ошибок нет (предупреждения и расхождения разобрать вручную).
import fs from 'node:fs';
import { parseCatalog } from './equipment.mjs';
import { checkEquipment, parseSeason, parseRegistry } from './equipment-check.mjs';

const args = process.argv.slice(2);
const bi = args.indexOf('--baseline');
const basePath = bi >= 0 ? args.splice(bi, 2)[1] : null;
const [catFile, seasonFile, regFile] = args;
if (!catFile || !seasonFile || !regFile) { console.error('Укажите КАТАЛОГ.csv СЕЗОН.csv РЕЕСТР.csv [--baseline СЕЗОН.csv]'); process.exit(2); }
const kits = new Map(parseCatalog(fs.readFileSync(catFile, 'utf8')).map(k => [k.kit, k.price]));
const read = f => parseSeason(fs.readFileSync(f, 'utf8'), kits);
const season = read(seasonFile), baseline = basePath ? read(basePath).orders : null;
const r = checkEquipment({ season: season.orders, registry: parseRegistry(fs.readFileSync(regFile, 'utf8')).players, baseline });
console.log(`Заказов ${season.orders.length}, проблем разбора ${season.problems.length}, ошибок ${r.errors.length}, предупреждений ${r.warnings.length}, расхождений с эталоном ${r.diffs.length}`);
for (const [t, a] of [['ОШИБКИ', r.errors], ['ПРЕДУПРЕЖДЕНИЯ', r.warnings], ['РАСХОЖДЕНИЯ С ЭТАЛОНОМ', r.diffs]]) {
  if (!a.length) continue;
  console.log(`\n${t}:`); a.forEach(x => console.log('  ' + JSON.stringify(x)));
}
process.exit(r.errors.length || season.problems.length ? 1 : 0);
