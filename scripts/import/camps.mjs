import { parseCsv, isoDate } from './registry.mjs';
import { parseAmount } from './payments.mjs';

const s = v => String(v ?? '').trim();
const yes = v => ['да', 'true', '1', 'yes'].includes(s(v).toLowerCase());
const STATUS = { 'записан': 'registered', 'отказ': 'declined', registered: 'registered', declined: 'declined' };
const KIND = { 'бронь': 'booking', 'оплата': 'payment', 'возврат': 'refund', booking: 'booking', payment: 'payment', refund: 'refund' };
const METHOD = { 'наличные': 'cash', 'перевод': 'transfer', 'карта': 'card', cash: 'cash', transfer: 'transfer', card: 'card' };

export function parseCamps(text) {
  const camps = [], problems = [];
  for (const r of parseCsv(text).slice(1)) {
    if (!s(r[0]) && !s(r[1])) continue;
    try {
      const c = {
        external_id: s(r[0]),
        name: s(r[1]),
        location: s(r[2]) || null,
        starts_on: isoDate(r[3]),
        ends_on: isoDate(r[4]),
        booking_fee: parseAmount(r[5]),
        booking_deadline: isoDate(r[6]),
        full_payment_deadline: isoDate(r[7]),
        active: r[8] === undefined || s(r[8]) === '' ? true : yes(r[8]),
      };
      if (!c.external_id || !c.name || !c.starts_on || !c.ends_on) throw new Error('нет ID, названия или дат');
      camps.push(c);
    } catch (e) {
      problems.push({ line: camps.length + 2, id: s(r[0]), error: e.message });
    }
  }
  return { camps, problems };
}

export function parseCampTariffs(text) {
  const tariffs = [], problems = [];
  for (const r of parseCsv(text).slice(1)) {
    if (!s(r[0]) && !s(r[1])) continue;
    try {
      const t = { camp_ext: s(r[0]), name: s(r[1]), price: parseAmount(r[2]), active: s(r[3]) === '' ? true : yes(r[3]) };
      if (!t.camp_ext || !t.name) throw new Error('нет ID сбора или тарифа');
      tariffs.push(t);
    } catch (e) {
      problems.push({ line: tariffs.length + 2, id: s(r[0]), error: e.message });
    }
  }
  return { tariffs, problems };
}

export function parseCampParticipants(text) {
  const participants = [], problems = [];
  for (const r of parseCsv(text).slice(1)) {
    if (!s(r[0]) && !s(r[1])) continue;
    try {
      const rawStatus = s(r[9]).toLowerCase();
      const status = STATUS[rawStatus];
      if (!status) throw new Error('статус не распознан: ' + s(r[9]));
      const p = {
        external_id: s(r[0]),
        camp_ext: s(r[1]),
        player_ext: s(r[2]) || null,
        full_name: s(r[3]),
        group_name: s(r[4]) || null,
        tariff: s(r[5]),
        amount: parseAmount(r[6]),
        tshirt_size: s(r[7]) || null,
        comment: s(r[8]) || null,
        status,
        registered_on: isoDate(r[10]),
        guest: yes(r[11]),
      };
      if (!p.external_id || !p.camp_ext || !p.full_name || !p.tariff) throw new Error('нет ID записи, сбора, ФИ или тарифа');
      if (!p.guest && !p.player_ext) throw new Error('нет ID игрока');
      participants.push(p);
    } catch (e) {
      problems.push({ line: participants.length + 2, id: s(r[0]), error: e.message });
    }
  }
  return { participants, problems };
}

export function parseCampPayments(text) {
  const payments = [], problems = [];
  for (const r of parseCsv(text).slice(1)) {
    if (!s(r[2]) && !s(r[3])) continue;
    try {
      const paid_on = isoDate(r[1] || r[0]);
      const kind = KIND[s(r[7]).toLowerCase()];
      if (!kind) throw new Error('тип оплаты не распознан: ' + s(r[7]));
      const p = {
        camp_ext: s(r[2]),
        participant_ext: s(r[3]),
        player_ext: s(r[4]) || null,
        full_name: s(r[5]),
        amount: parseAmount(r[6]),
        kind,
        method: METHOD[s(r[8]).toLowerCase()] ?? (s(r[8]) || null),
        comment: s(r[9]) || null,
        paid_on,
      };
      if (!p.camp_ext || !p.participant_ext || !p.paid_on) throw new Error('нет сбора, записи или даты');
      p.legacy_ref = `CAMP_PAY ${p.camp_ext} ${p.participant_ext} ${p.paid_on}`;
      payments.push(p);
    } catch (e) {
      problems.push({ line: payments.length + 2, id: s(r[3]), error: e.message });
    }
  }
  return { payments, problems };
}

export function parseSettings(text) {
  const settings = [], problems = [];
  for (const r of parseCsv(text).slice(1)) {
    if (!s(r[0])) continue;
    try {
      const item = {
        key: s(r[0]),
        scope: s(r[1]),
        value: s(r[2]) || null,
        updated_at: isoDate(r[3]),
      };
      settings.push(item);
    } catch (e) {
      problems.push({ line: settings.length + 2, id: s(r[0]), error: e.message });
    }
  }
  return { settings, problems };
}

export function buildCampsPlan({ campsCsv, tariffsCsv, participantsCsv, paymentsCsv, settingsCsv, registryPlayers = [] }) {
  const camps = parseCamps(campsCsv);
  const tariffs = parseCampTariffs(tariffsCsv);
  const participants = parseCampParticipants(participantsCsv);
  const payments = parseCampPayments(paymentsCsv);
  const settings = parseSettings(settingsCsv);
  const problems = [...camps.problems, ...tariffs.problems, ...participants.problems, ...payments.problems, ...settings.problems];

  const campExt = new Set(camps.camps.map(c => c.external_id));
  const registry = new Set(registryPlayers.map(p => p.external_id));
  const tariffByCamp = new Map(tariffs.tariffs.map(t => [t.camp_ext + '|' + t.name, t]));
  const participantByExt = new Map(participants.participants.map(p => [p.external_id, p]));

  for (const t of tariffs.tariffs) {
    if (!campExt.has(t.camp_ext)) problems.push({ id: t.camp_ext, error: `тариф ${t.name}: нет сбора` });
  }
  for (const p of participants.participants) {
    if (!campExt.has(p.camp_ext)) problems.push({ id: p.external_id, error: 'нет сбора' });
    if (!tariffByCamp.has(p.camp_ext + '|' + p.tariff)) problems.push({ id: p.external_id, error: `нет тарифа: ${p.tariff}` });
    if (!p.guest && p.player_ext && !registry.has(p.player_ext)) problems.push({ id: p.external_id, error: `нет игрока: ${p.player_ext}` });
  }
  for (const p of payments.payments) {
    const participant = participantByExt.get(p.participant_ext);
    if (!participant) problems.push({ id: p.participant_ext, error: 'нет участника' });
    else if (participant.camp_ext !== p.camp_ext) problems.push({ id: p.participant_ext, error: 'участник из другого сбора' });
    if (!p.player_ext) { p.player_ext = participant?.player_ext ?? null; p.guest = participant?.guest ?? false; }
  }
  const duplicate = (arr, key, label) => {
    const seen = new Set();
    for (const x of arr) {
      const k = key(x);
      if (seen.has(k)) problems.push({ id: x.external_id ?? x.key, error: `повтор ${label}: ${k}` });
      seen.add(k);
    }
  };
  duplicate(camps.camps, c => c.external_id, 'сбора');
  duplicate(tariffs.tariffs, t => t.camp_ext + '|' + t.name, 'тарифа');
  duplicate(participants.participants, p => p.external_id, 'участника');
  duplicate(settings.settings, x => x.key + '|' + x.scope, 'настройки');

  const counts = { registered: 0, declined: 0 };
  for (const p of participants.participants) counts[p.status]++;
  return {
    camps: camps.camps,
    tariffs: tariffs.tariffs,
    participants: participants.participants,
    payments: payments.payments,
    settings: settings.settings,
    problems,
    counts,
    paymentSum: payments.payments.reduce((a, p) => a + p.amount, 0),
  };
}
