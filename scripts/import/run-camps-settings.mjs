import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { buildCampsPlan, manualToAdopt } from './camps.mjs';
import { getAll } from './rest-all.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const arg = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const argDir = arg('export') || arg('dir') || args.find(a => !a.startsWith('--'));
if (!argDir) { console.error('Укажите папку выгрузки: --export "migration-export …"'); process.exit(2); }
const dir = path.resolve(argDir);
const read = p => fs.readFileSync(path.join(dir, p), 'utf8');
const registryFile = arg('registry') || path.join(dir, 'ATT_ID/РЕЕСТР ИГРОКОВ.csv');
const reg = parseRegistry(fs.readFileSync(registryFile, 'utf8'));
if (reg.problems.length) { console.error(`Реестр разобран с ошибками: ${reg.problems.length}`); process.exit(1); }

const plan = buildCampsPlan({
  campsCsv: read('ADMIN_ID/СБОРЫ.csv'),
  tariffsCsv: read('ADMIN_ID/ТАРИФЫ СБОРОВ.csv'),
  participantsCsv: read('ADMIN_ID/УЧАСТНИКИ СБОРОВ.csv'),
  paymentsCsv: read('ADMIN_ID/ОПЛАТЫ СБОРОВ.csv'),
  settingsCsv: read('ADMIN_ID/НАСТРОЙКИ.csv'),
  registryPlayers: reg.players,
});

console.log(`Сборы ${plan.camps.length}, тарифы ${plan.tariffs.length}, участники ${plan.participants.length} (записан ${plan.counts.registered}, отказ ${plan.counts.declined}), платежи ${plan.payments.length} на ${plan.paymentSum} ₾, настройки ${plan.settings.length}`);
console.log(`Проблем: ${plan.problems.length}`);
for (const p of plan.problems) console.log(`  ${p.id ?? ''}: ${p.error}`);
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (plan.problems.length) { console.error('Есть проблемы разбора — запись остановлена.'); process.exit(1); }

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL (без /rest/v1), SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const base = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function rest(method, p, body, prefer = '') {
  const res = await fetch(`${base}/rest/v1/${p}`, {
    method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p.split('?')[0]}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const MERGE = 'resolution=merge-duplicates,return=minimal';
async function upsertAll(table, onConflict, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await rest('POST', `${table}?on_conflict=${onConflict}`, rows.slice(i, i + 500), MERGE);
  }
}

let dbPlayers = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id,full_name`);
const playerId = new Map(dbPlayers.map(p => [p.external_id, p.id]));
const guestRows = [];
for (const p of plan.participants) {
  if (!p.player_ext) {
    p.player_ext = `GUEST-CAMP-${p.external_id}`;
    if (!playerId.has(p.player_ext)) guestRows.push({ club_id: CLUB_ID, external_id: p.player_ext, full_name: p.full_name, status: 'inactive' });
  }
}
if (guestRows.length) {
  await rest('POST', 'players', guestRows, 'return=minimal');
  dbPlayers = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id,full_name`);
  for (const p of dbPlayers) playerId.set(p.external_id, p.id);
}
const absent = [...new Set(plan.participants.map(p => p.player_ext).filter(x => !playerId.has(x)))];
if (absent.length) { console.error('Игроки не найдены в базе (сначала реестр): ' + absent.join(', ')); process.exit(1); }

await upsertAll('camps', 'club_id,external_id', plan.camps.map(c => ({
  club_id: CLUB_ID, external_id: c.external_id, name: c.name, location: c.location,
  starts_on: c.starts_on, ends_on: c.ends_on, booking_fee: c.booking_fee,
  booking_deadline: c.booking_deadline, full_payment_deadline: c.full_payment_deadline, active: c.active,
})));
const dbCamps = await getAll(rest, `camps?club_id=eq.${CLUB_ID}&select=id,external_id`);
const campId = new Map(dbCamps.map(c => [c.external_id, c.id]));

await upsertAll('camp_tariffs', 'camp_id,name', plan.tariffs.map(t => ({
  camp_id: campId.get(t.camp_ext), name: t.name, price: t.price, active: t.active,
})));
const dbTariffs = await getAll(rest, `camp_tariffs?select=id,camp_id,name`);
const tariffId = new Map(dbTariffs.map(t => [`${t.camp_id}|${t.name}`, t.id]));

// участники, добавленные вручную в приложении (без CP-…), получают свой номер из листа, а не дублируются
const adopt = manualToAdopt({ participants: plan.participants, dbParticipants: await getAll(rest, 'camp_participants?select=id,camp_id,player_id,external_id'), campId, playerId });
for (const a of adopt) await rest('PATCH', `camp_participants?id=eq.${a.id}`, { external_id: a.external_id }, 'return=minimal');
if (adopt.length) console.log(`Участники сборов, добавленные вручную, получили номер из листа: ${adopt.map(a => a.external_id).join(', ')}`);
await upsertAll('camp_participants', 'camp_id,external_id', plan.participants.map(p => ({
  camp_id: campId.get(p.camp_ext), external_id: p.external_id, player_id: playerId.get(p.player_ext),
  tariff_id: tariffId.get(`${campId.get(p.camp_ext)}|${p.tariff}`), amount: p.amount,
  tshirt_size: p.tshirt_size, comment: p.comment, status: p.status, registered_on: p.registered_on,
})));
const dbParticipants = await getAll(rest, `camp_participants?select=id,camp_id,external_id`);
const participantId = new Map(dbParticipants.map(p => [`${p.camp_id}|${p.external_id}`, p.id]));

const existingPays = new Set((await getAll(rest, 'camp_payments?select=legacy_ref')).map(p => p.legacy_ref));
const newPays = plan.payments.filter(p => !existingPays.has(p.legacy_ref)).map(p => ({
  camp_id: campId.get(p.camp_ext), participant_id: participantId.get(`${campId.get(p.camp_ext)}|${p.participant_ext}`),
  player_id: playerId.get(p.player_ext), amount: p.amount, paid_on: p.paid_on, kind: p.kind,
  method: p.method, comment: p.comment, legacy_ref: p.legacy_ref,
}));
for (let i = 0; i < newPays.length; i += 500) await rest('POST', 'camp_payments', newPays.slice(i, i + 500), 'return=minimal');

await upsertAll('club_settings', 'club_id,key,scope', plan.settings.map(s => ({
  club_id: CLUB_ID, key: s.key, scope: s.scope, value: s.value, updated_at: s.updated_at,
})));

console.log(`Записано: сборы ${plan.camps.length}, тарифы ${plan.tariffs.length}, участники ${plan.participants.length}, платежи ${newPays.length} (уже было ${plan.payments.length - newPays.length}), настройки ${plan.settings.length}.`);
