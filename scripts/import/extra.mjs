// Дополнительные тренировки из листов EXTRA_ID (лист = дата «дд.мм», колонки №, ФИ, группа, Paid) в extra_sessions / extra_bookings.
// Чистые функции, без сети. Сумма и способ оплаты — из листов админ-файла «ДОПОЛНИТЕЛЬНЫЕ ТРЕНИРОВКИ» (ID, Дата, Сумма) и «ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ» (журнал).
import { parseCsv } from './registry.mjs';
import { resolveName } from './events-plan.mjs';
import { guestExt } from './individual.mjs';

// Ушли из клуба, но занимались на дополнительных тренировках (подтверждено владельцем 29.10): заводятся неактивными игроками GUEST-…,
// если их нет в реестре. Если владелец добавит их в РЕЕСТР, они найдутся как обычные игроки и GUEST-… не создаётся.
export const EXTRA_FORMER = ['Rybchinskiy Nikita', 'Sokovets Semen', 'Rak Dorian', 'Luitikov Mart', 'Luitikov Platon', 'Daniel van Rhoon', 'Imnaiishvili George'];
// Опечатки в листах дополнительных: написание → верное
export const EXTRA_ALIAS = { 'imnaishvili gosha': 'Imnaiishvili George' };
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// «14.09» → гггг-мм-дд; года в названии листа нет: берём year, а дату далеко в будущем относим к прошлому году
export function sheetDate(name, year, now = new Date()) {
  const m = /^(\d{1,2})\.(\d{2})/.exec(String(name).trim());
  if (!m) return null;
  let y = year;
  if (Date.UTC(y, +m[2] - 1, +m[1]) > now.getTime() + 60 * 86400000) y--;
  return `${y}-${m[2]}-${('0' + m[1]).slice(-2)}`;
}

// Лист даты → игроки с отметкой оплаты
export function parseExtraSheet(text) {
  const rows = parseCsv(text);
  const h = rows.slice(0, 5).findIndex(r => (r[0] || '').trim() === '№');
  if (h < 0) return [];
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (!/^\d+$/.test((rows[i][0] || '').trim())) break;
    const name = (rows[i][1] || '').trim();
    if (name) out.push({ name, paid: String(rows[i][3] || '').trim().toUpperCase() === 'TRUE' });
  }
  return out;
}

// Журнал оплат: ID тренировки + ФИ → последняя оплата (способ, сумма); «Отмена» после неё снимает оплату
export function replayExtraJournal(text) {
  const state = new Map();
  for (const r of parseCsv(text).slice(1)) {
    const id = (r[1] || '').trim(), name = (r[2] || '').trim(), type = (r[5] || '').trim();
    if (!id || !name) continue;
    const k = id + '|' + name.toLowerCase();
    if (type === 'Оплата') state.set(k, { method: (r[4] || '').trim() || null, amount: Number(r[3]) || null });
    else if (type === 'Отмена') state.delete(k);
  }
  return state;
}

// Лист цен: ID, Дата, Сумма → карта ID → сумма
export function parseExtraPrices(text) {
  const map = new Map();
  for (const r of parseCsv(text).slice(1)) if ((r[0] || '').trim()) map.set(r[0].trim(), Number(String(r[2]).replace(',', '.')) || 0);
  return map;
}

export function buildExtraPlan({ registryNames, sheets, prices = new Map(), journal = new Map(), year, defaultAmount = 0, now = new Date() }) {
  const sessions = [], problems = [], former = new Map();
  for (const { name: sheet, text } of sheets) {
    const date = sheetDate(sheet, year, now);
    if (!date) continue;
    const id = `${sheet}|${date}`;
    const people = [];
    for (const p of parseExtraSheet(text)) {
      let hit = resolveName(p.name, registryNames);
      if (!hit) {
        const target = EXTRA_ALIAS[norm(p.name)] ?? p.name;
        const f = EXTRA_FORMER.find(x => norm(x) === norm(target));
        if (f) { hit = { name: f }; former.set(guestExt(f), { external_id: guestExt(f), full_name: f }); }
      }
      if (!hit) { problems.push({ error: `${sheet}: игрока «${p.name}» нет в реестре` }); continue; }
      const j = journal.get(id + '|' + p.name.toLowerCase());
      if (people.some(x => x.name === hit.name)) continue; // одно имя в листе дважды (в том числе из-за опечатки): одна запись
      people.push({ name: hit.name, paid: p.paid, method: p.paid ? (j?.method ?? null) : null, paid_amount: p.paid ? (j?.amount ?? null) : null });
    }
    sessions.push({ external_id: id, starts_on: date, amount: prices.get(id) ?? defaultAmount, people });
  }
  return { sessions, problems, former: [...former.values()] };
}
