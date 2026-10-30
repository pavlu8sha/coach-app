import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { guardEquipment, totalsOf } from '../../scripts/import/equipment-guard.mjs';
import { ROOT, startFake, runScript } from './fake-rest.mjs';

const H = '№,Дата заказа,ФИ ребёнка,Комплект,Размер,Надпись,Номер,Рассрочка,Сумма заказа,Оплачено,ID игрока,Локация,ID заказа,Кол-во\n';
function files(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-'));
  const f = (n, t) => { fs.writeFileSync(path.join(dir, n), t); return path.join(dir, n); };
  return {
    cat: f('cat.csv', 'Комплект,Цена\nИгровая форма,200\n'),
    season: f('season.csv', H + rows),
    reg: f('reg.csv', 'a\nb\nc\nKS-0001,Ivanov Ivan,U9-A,Park,Активен,01.09.2026,,\nKS-0002,Petrov Petr,U9-A,Park,Активен,01.09.2026,,\n'),
  };
}
const row = (no, name, pid, oid, paid = 200) => `${no},01.09.2026,${name},Игровая форма,140,IVANOV,8,Нет,200,${paid},${pid},Park,${oid},1\n`;
const players = [{ id: 'p1', external_id: 'KS-0001' }, { id: 'p2', external_id: 'KS-0002' }];
const dbOrder = (o = {}) => ({ id: 'o1', external_ord_id: 'ORD-0001', player_id: 'p1', inscription: 'IVANOV', number: '8', installment: false, total: 200, paid: 200, ...o });
const dbLines = [{ order_id: 'o1', kit: 'Игровая форма', size: '140', quantity: 1 }];
const run = async (x, tables, extra = []) => {
  const fake = await startFake({ players, equipment_orders: [dbOrder()], equipment_order_lines: dbLines, ...tables });
  try { const r = await runScript('run-equipment.mjs', [x.cat, x.season, '--registry', x.reg, ...extra], fake.url); return { ...r, writes: fake.writes(), calls: fake.calls }; }
  finally { await fake.close(); }
};

test('заказ совпадает с реестром и базой: запись идёт, строки заказа пересоздаются', async () => {
  const r = await run(files(row(1, 'Ivanov Ivan', 'KS-0001', 'ORD-0001')), {}, ['--write']);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Лист: заказов 1, строк 1, сумма 200 ₾, оплачено 200 ₾/);
  assert.match(r.stdout, /База: заказов 1, строк 1, сумма 200 ₾, оплачено 200 ₾/);
  assert.deepEqual(r.writes.map(c => c.method + ' ' + c.table), ['POST equipment_catalog', 'POST equipment_orders', 'DELETE equipment_order_lines', 'POST equipment_order_lines']);
});

test('заказ того же номера у другого игрока в базе (подмена #277): запись останавливается до любых записей', async () => {
  const x = files(row(1, 'Ivanov Ivan', 'KS-0001', 'ORD-0001'));
  const r = await run(x, { equipment_orders: [dbOrder({ player_id: 'p2' })] }, ['--write']);
  assert.equal(r.code, 1);
  assert.equal(r.writes.length, 0);
  assert.match(r.stdout, /игрок заказа в листе и в базе разный/);
  const ok = await run(x, { equipment_orders: [dbOrder({ player_id: 'p2' })] }, ['--write', '--accept-warnings']);
  assert.equal(ok.code, 0);
  assert.ok(ok.writes.length > 0);
});

test('ФИ в заказе не совпадает с реестром по ID игрока: остановка; проверка без --write тоже сообщает кодом 1', async () => {
  const r = await run(files(row(1, 'Petrov Petr', 'KS-0001', 'ORD-0001')), {}, []);
  assert.equal(r.code, 1);
  assert.equal(r.writes.length, 0);
  assert.match(r.stdout, /ФИ в заказе не совпадает с реестром/);
});

test('в базе оплачено больше, чем в листе (оплата из приложения): остановка', async () => {
  const r = await run(files(row(1, 'Ivanov Ivan', 'KS-0001', 'ORD-0001', 100)), {}, ['--write']);
  assert.equal(r.code, 1);
  assert.equal(r.writes.length, 0);
  assert.match(r.stdout, /в базе оплачено больше, чем в листе/);
});

test('дубль ID заказа и заказ без ID блокируют запись', async () => {
  const dup = await run(files(row(1, 'Ivanov Ivan', 'KS-0001', 'ORD-0001') + row(2, 'Petrov Petr', 'KS-0002', 'ORD-0001')), {}, ['--write']);
  assert.equal(dup.code, 1); assert.equal(dup.writes.length, 0); assert.match(dup.stdout, /дубль ID заказа/);
  const noId = await run(files(row(1, 'Ivanov Ivan', 'KS-0001', '')), {}, ['--write']);
  assert.equal(noId.code, 1); assert.equal(noId.writes.length, 0);
});

test('без --write запросов на запись нет, расхождения по ID заказа показаны', async () => {
  const r = await run(files(row(1, 'Ivanov Ivan', 'KS-0001', 'ORD-0001', 150)), { equipment_orders: [dbOrder({ paid: 100 })] }, []);
  assert.equal(r.code, 0);
  assert.equal(r.writes.length, 0);
  assert.match(r.stdout, /"ord":"ORD-0001","field":"paid","sheet":150,"db":100/);
});

test('totalsOf и guardEquipment без базы: считает суммы, сверку пропускает', () => {
  const orders = [{ ext_id: 'ORD-1', player_ext: 'KS-0001', name: 'Ivanov Ivan', total: 200, paid: 100, lines: [{}, {}], src_row: 2 }];
  assert.deepEqual(totalsOf(orders), { orders: 1, total: 200, paid: 100, lines: 2 });
  const g = guardEquipment({ orders, registry: [{ external_id: 'KS-0001', full_name: 'Ivanov Ivan' }] });
  assert.equal(g.dbTotals, null);
  assert.deepEqual([g.errors.length, g.warnings.length], [0, 0]);
});

// final-import --show-only: что и в каком порядке будет запущено и где добавляется --write
function exportDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  for (const n of ['РЕЕСТР ИГРОКОВ', 'РАСПИСАНИЕ', 'Тренировки', 'МАТЧИ', 'ВЗНОСЫ МАТЧЕЙ', 'Игры', 'ДАТЫ РОЖДЕНИЯ', 'ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ', 'ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ', 'КАТАЛОГ ЭКИПИРОВКИ', 'СЕЗОН 2026-2027']) fs.writeFileSync(path.join(dir, n + '.csv'), '');
  for (const d of ['PAY_ID', 'GAMES_ID', 'ATT_ID', 'IND_ID', 'EXTRA_ID']) fs.mkdirSync(path.join(dir, d));
  return dir;
}
const showOnly = args => new Promise(resolve => {
  const env = { PATH: process.env.PATH, SUPABASE_URL: 'http://127.0.0.1:1', CLUB_ID: 'c' };
  const p = spawn(process.execPath, [path.join(ROOT, 'scripts/import/final-import.mjs'), '--dir', exportDir(), '--show-only', ...args], { env, cwd: ROOT });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => resolve({ code, out }));
});
const steps = out => [...out.matchAll(/^node scripts\/import\/(\S+)(.*)$/gm)].map(m => ({ script: m[1], args: m[2] }));

test('final-import Daily: без посещаемости и матчей; Final: с ними; --new-only у матчей', async () => {
  const daily = steps((await showOnly(['--mode', 'Daily'])).out).map(s => s.script);
  assert.ok(!daily.includes('run-attendance.mjs') && !daily.includes('run-events.mjs'));
  const fin = steps((await showOnly(['--mode', 'Final'])).out);
  assert.ok(fin.some(s => s.script === 'run-attendance.mjs'));
  assert.match(fin.find(s => s.script === 'run-events.mjs').args, /--new-only/);
});

test('final-import --staff-only: единственный шаг run-events --staff-only', async () => {
  const s = steps((await showOnly(['--mode', 'Final', '--staff-only'])).out);
  assert.equal(s.length, 1);
  assert.equal(s[0].script, 'run-events.mjs');
  assert.match(s[0].args, /--staff-only/);
});

test('final-import --write: предпроверки экипировки, оплат и посещаемости первыми шагами и без --write, остальные шаги с --write', async () => {
  const s = steps((await showOnly(['--mode', 'Final', '--write'])).out);
  assert.deepEqual(s.slice(0, 3).map(x => x.script), ['run-equipment.mjs', 'run-payments.mjs', 'run-attendance.mjs']);
  assert.ok(s.slice(0, 3).every(x => !/--write/.test(x.args)));
  assert.ok(s.slice(3).every(x => /--write/.test(x.args)));
  // в режиме Daily посещаемости нет, предпроверок две
  const daily = steps((await showOnly(['--mode', 'Daily', '--write'])).out);
  assert.deepEqual(daily.slice(0, 2).map(x => x.script), ['run-equipment.mjs', 'run-payments.mjs']);
  assert.ok(!daily.some(x => x.script === 'run-attendance.mjs'));
  const eq = s.filter(x => x.script === 'run-equipment.mjs');
  assert.equal(eq.length, 2);
  assert.ok(/--registry/.test(eq[1].args));
  // без --write предпроверки нет, и ни один шаг не пишет
  const dry = steps((await showOnly(['--mode', 'Final'])).out);
  assert.equal(dry.filter(x => x.script === 'run-equipment.mjs').length, 1);
  assert.ok(dry.every(x => !/--write/.test(x.args)));
});

test('--accept-equipment-warnings передаётся шагам экипировки', async () => {
  const s = steps((await showOnly(['--mode', 'Daily', '--write', '--accept-equipment-warnings'])).out).filter(x => x.script === 'run-equipment.mjs');
  assert.equal(s.length, 2);
  assert.ok(s.every(x => /--accept-warnings/.test(x.args)));
});

test('--accept-unmatched-payments передаётся шагам оплат как --accept-unmatched', async () => {
  const s = steps((await showOnly(['--mode', 'Daily', '--write', '--accept-unmatched-payments'])).out).filter(x => x.script === 'run-payments.mjs');
  assert.equal(s.length, 2);
  assert.ok(s.every(x => /--accept-unmatched/.test(x.args)));
  const none = steps((await showOnly(['--mode', 'Daily', '--write'])).out).filter(x => x.script === 'run-payments.mjs');
  assert.ok(none.every(x => !/--accept-unmatched/.test(x.args)));
});
