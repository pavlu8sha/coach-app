// Только чтение: сверка листа заказов с выгрузкой из новой базы.
//   node scripts/import/run-equipment-compare-db.mjs КАТАЛОГ.csv СЕЗОН.csv БАЗА.csv
// БАЗА.csv — результат запроса из scripts/import/equipment-db-export.sql (владелец запускает в SQL Editor и скачивает CSV).
import fs from 'node:fs';
import { parseCatalog, parseSeason } from './equipment.mjs';
import { parseDbExport, compareWithDb } from './equipment-compare-db.mjs';

const [catFile, seasonFile, dbFile] = process.argv.slice(2);
if (!catFile || !seasonFile || !dbFile) { console.error('Укажите КАТАЛОГ.csv СЕЗОН.csv БАЗА.csv'); process.exit(2); }
const kits = new Map(parseCatalog(fs.readFileSync(catFile, 'utf8')).map(k => [k.kit, k.price]));
const sheet = parseSeason(fs.readFileSync(seasonFile, 'utf8'), kits).orders;
const r = compareWithDb(sheet, parseDbExport(fs.readFileSync(dbFile, 'utf8')));
console.log(`Лист: ${sheet.length}, расхождений по полям: ${r.diffs.length}, только в листе: ${r.onlySheet.length}, только в базе: ${r.onlyDb.length}`);
r.diffs.forEach(d => console.log('  ' + JSON.stringify(d)));
if (r.onlySheet.length) console.log('Только в листе (новые после миграции?): ' + r.onlySheet.join(', '));
if (r.onlyDb.length) console.log('Только в базе: ' + r.onlyDb.join(', '));
