export const SEVERITY = {
  parents: 'влияет на родителей',
  staff: 'влияет на тренеров/администратора',
  hygiene: 'гигиена',
};

export const SEVERITY_ORDER = ['parents', 'staff', 'hygiene'];

const arr = value => (Array.isArray(value) ? value : []);
const num = value => Number(value || 0);
const money = value => Math.round(num(value) * 100) / 100;
const sameMoney = (a, b) => Math.abs(money(a) - money(b)) < 0.005;
const monthOf = value => `${String(value || '').slice(0, 7)}-01`;

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function normalizeName(value) {
  return normalizeText(value).replace(/ё/g, 'е');
}

function tbilisiParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tbilisi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = type => parts.find(x => x.type === type)?.value || '';
  return { year: part('year'), month: part('month'), day: part('day') };
}

export function tbilisiToday(now = new Date()) {
  const p = tbilisiParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

export function tbilisiDay(value) {
  const p = tbilisiParts(value);
  return `${p.year}-${p.month}-${p.day}`;
}

const playerText = p => (p ? `${p.full_name || 'без имени'} (${p.external_id || p.id})` : 'игрок не найден');
const groupText = g => (g ? `${g.name || 'без названия'} (${g.id})` : 'группа не найдена');
const matchText = m => (m ? `${m.played_on || '—'} ${m.team || '—'} (${m.id})` : 'матч не найден');

function issue(id, title, severity, description, items) {
  return { id, title, severity, description, items, total: items.length };
}

const clubPlayers = data => arr(data.players).filter(p => p.club_id === data.clubId);
const clubGroups = data => arr(data.groups).filter(g => g.club_id === data.clubId);
const clubMatches = data => arr(data.matches).filter(m => m.club_id === data.clubId);
const clubPlayerIds = data => new Set(clubPlayers(data).map(p => p.id));
const clubSessionIds = data => {
  const groupIds = new Set(clubGroups(data).map(g => g.id));
  return new Set(arr(data.sessions).filter(s => groupIds.has(s.group_id)).map(s => s.id));
};

// Команды матчей без группы: U12 играла только на Newton cup, записанном как матч (решение владельца, #172)
export const TEAMS_WITHOUT_GROUP = ['U12'];

export function checkMatchTeams(data = {}) {
  // как в can_see_team (миграция 0048): команда = название группы или название без суффикса -A/-B/-C
  const names = new Set(clubGroups(data).flatMap(g => [normalizeName(g.name), normalizeName(g.name).replace(/-[abc]$/, '')]).filter(Boolean));
  const items = clubMatches(data)
    .filter(m => !names.has(normalizeName(m.team)) && !TEAMS_WITHOUT_GROUP.map(normalizeName).includes(normalizeName(m.team)))
    .map(m => `${matchText(m)}: команда «${m.team || ''}» не совпадает с названием группы клуба`);
  return issue(
    'match-team',
    'Матчи: команда не совпадает с группой',
    'parents',
    'matches.team должен совпадать с groups.name клуба (пробелы и регистр не важны). Иначе матч не виден родителям и тренерам.',
    items,
  );
}

export function checkGoalsVsScore(data = {}) {
  const goals = new Map();
  for (const row of arr(data.matchPlayers)) {
    if (!row.played) continue;
    const key = row.match_id;
    goals.set(key, (goals.get(key) || 0) + num(row.goals));
  }
  const items = [];
  for (const m of clubMatches(data)) {
    if (m.goals_for === null || m.goals_for === undefined) continue;
    const total = goals.get(m.id) || 0;
    if (total > num(m.goals_for)) {
      items.push(`${matchText(m)}: у игроков ${total} гол(ов), в счёте ${m.goals_for}`);
    }
  }
  return issue(
    'goals-vs-score',
    'Матчи: голы игроков больше счёта',
    'staff',
    'Сумма match_players.goals (только played) не должна превышать matches.goals_for: такой матч нельзя пересохранить в приложении.',
    items,
  );
}

export function checkGoalsWithoutPlaying(data = {}) {
  const matchIds = new Set(clubMatches(data).map(m => m.id));
  const matches = new Map(arr(data.matches).map(m => [m.id, m]));
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const items = arr(data.matchPlayers)
    .filter(row => matchIds.has(row.match_id) && num(row.goals) > 0 && !row.played)
    .map(row => `${matchText(matches.get(row.match_id))}: ${playerText(players.get(row.player_id))} — ${row.goals} гол(ов), но played = false`);
  return issue(
    'goals-without-playing',
    'Матчи: голы без участия',
    'staff',
    'match_players с goals > 0 и played = false. Приложение не даст сохранить такой состав.',
    items,
  );
}

// Матчи до этой даты (весна 2026, перенос из старого файла): счёта нет и в старых таблицах, пустым оставлен намеренно (решение владельца, #179)
export const SCORE_ARCHIVE_BEFORE = '2026-09-01';

export function checkLineups(data = {}) {
  const roster = new Set(arr(data.matchPlayers).map(row => row.match_id));
  const today = data.today || tbilisiToday();
  const items = [];
  for (const m of clubMatches(data)) {
    const hasScore = m.goals_for !== null && m.goals_for !== undefined && m.goals_against !== null && m.goals_against !== undefined;
    const hasRoster = roster.has(m.id);
    if (String(m.played_on || '') < today && hasScore && !hasRoster) {
      items.push(`${matchText(m)}: матч в прошлом со счётом, но без состава`);
    }
    if (hasRoster && !hasScore && String(m.played_on || '') >= SCORE_ARCHIVE_BEFORE) {
      items.push(`${matchText(m)}: состав есть, но счёт не заполнен`);
    }
  }
  return issue(
    'lineups',
    'Матчи: состав и счёт',
    'staff',
    'Матч в прошлом со счётом должен иметь состав; состав без счёта не даёт начислить баллы за результат.',
    items,
  );
}

export function checkRosterPlayers(data = {}) {
  const matches = new Map(arr(data.matches).map(m => [m.id, m]));
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const items = [];
  for (const row of arr(data.matchPlayers)) {
    const m = matches.get(row.match_id);
    const p = players.get(row.player_id);
    if (!m) {
      items.push(`состав ${row.match_id}/${row.player_id}: матч не найден`);
      continue;
    }
    if (m.club_id !== data.clubId) continue;
    if (!p) {
      items.push(`${matchText(m)}: игрок ${row.player_id} не найден`);
    } else if (p.club_id !== m.club_id) {
      items.push(`${matchText(m)}: ${playerText(p)} из другого клуба (${p.club_id})`);
    }
  }
  return issue(
    'roster-players',
    'Матчи: игроки состава не из клуба',
    'staff',
    'match_players должен ссылаться на существующих игроков того же клуба, что и матч.',
    items,
  );
}

export function checkPlayerGroups(data = {}) {
  const groups = new Map(arr(data.groups).map(g => [g.id, g]));
  const items = [];
  for (const p of clubPlayers(data)) {
    if (p.status !== 'active') continue;
    if (!p.group_id) {
      items.push(`${playerText(p)}: активный игрок без группы`);
      continue;
    }
    const g = groups.get(p.group_id);
    if (!g) {
      items.push(`${playerText(p)}: группа ${p.group_id} не найдена`);
    } else if (!String(g.name || '').trim()) {
      items.push(`${playerText(p)}: группа ${g.id} с пустым названием`);
    }
  }
  return issue(
    'player-groups',
    'Игроки без группы',
    'parents',
    'Активные игроки без group_id, с несуществующей группой или группой без названия. Отдельного признака активности группы в схеме нет.',
    items,
  );
}

export function checkDuplicatePlayers(data = {}) {
  const byName = new Map();
  for (const p of clubPlayers(data)) {
    if (p.status !== 'active') continue;
    const key = normalizeName(p.full_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }
  const items = [];
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    items.push(`${group[0].full_name}: ${group.map(p => `${playerText(p)}${p.group_id ? `, группа ${p.group_id}` : ', без группы'}`).join('; ')}`);
  }
  return issue(
    'duplicate-players',
    'Игроки: дубли по ФИ',
    'hygiene',
    'Активные игроки с одинаковым full_name после нормализации (пробелы, регистр, ё/е).',
    items,
  );
}

export function checkMissingBirthDates(data = {}) {
  const items = clubPlayers(data)
    .filter(p => p.status === 'active' && !p.birth_date)
    .map(p => `${playerText(p)}${p.group_id ? `, группа ${p.group_id}` : ', без группы'}`);
  return issue(
    'birth-dates',
    'Игроки: активные без даты рождения',
    'hygiene',
    'По handoff активных без даты рождения должно быть 4; список нужен, чтобы запросить даты у владельца.',
    items,
  );
}

export function checkPaymentsWithoutPlayer(data = {}) {
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const items = arr(data.payments)
    .filter(p => {
      const player = players.get(p.player_id);
      return !player || player.club_id === data.clubId;
    })
    .filter(p => !players.has(p.player_id))
    .map(p => `платёж ${p.id} от ${p.paid_on || '—'} на ${p.amount}: игрок ${p.player_id} не найден`);
  return issue(
    'payments-without-player',
    'Платежи без игрока',
    'staff',
    'payments.player_id должен ссылаться на существующего игрока клуба.',
    items,
  );
}

// Оплата за следующий месяц принимается с 22-го числа и записывается 1-м числом следующего месяца: это не ошибка
export function isPrepayment(paidOn, today) {
  const t = String(today || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number(t.slice(8)) < 22) return false;
  const next = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return String(paidOn || '') === next;
}

export function checkFuturePayments(data = {}) {
  const today = data.today || tbilisiToday();
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const items = arr(data.payments)
    .filter(p => players.get(p.player_id)?.club_id === data.clubId)
    .filter(p => String(p.paid_on || '') > today && !isPrepayment(p.paid_on, today))
    .map(p => `платёж ${p.id}: ${playerText(players.get(p.player_id))}, дата ${p.paid_on} в будущем (сегодня ${today})`);
  return issue(
    'future-payments',
    'Платежи с датой в будущем',
    'staff',
    'Дата payments.paid_on не должна быть позже сегодняшнего дня по Тбилиси (кроме оплаты за следующий месяц с 22-го числа: дата 1-е следующего месяца).',
    items,
  );
}

export function checkSubscriptionsWithoutGroup(data = {}) {
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const items = arr(data.subscriptions)
    .filter(s => players.get(s.player_id)?.club_id === data.clubId && !s.group_id)
    .map(s => `${playerText(players.get(s.player_id))}, месяц ${monthOf(s.month)}: абонемент без группы`);
  return issue(
    'subscriptions-without-group',
    'Абонементы без группы',
    'staff',
    'У subscriptions.group_id пустой: долг будет считаться по текущей группе игрока или не посчитается.',
    items,
  );
}

export function checkPaymentsWithoutSubscription(data = {}) {
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const subs = new Set(arr(data.subscriptions).map(s => `${s.player_id}|${monthOf(s.month)}`));
  const items = arr(data.payments)
    .filter(p => players.get(p.player_id)?.club_id === data.clubId)
    .filter(p => !subs.has(`${p.player_id}|${monthOf(p.paid_on)}`))
    .map(p => `платёж ${p.id}: ${playerText(players.get(p.player_id))}, месяц ${monthOf(p.paid_on)} — строки абонемента нет`);
  return issue(
    'payments-without-subscription',
    'Платежи без строки абонемента',
    'parents',
    'Для каждого платежа за месяц у игрока должна быть строка subscriptions за этот месяц, иначе долг считается неверно.',
    items,
  );
}

export function checkSubscriptionAmounts(data = {}) {
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const paid = new Map();
  for (const p of arr(data.payments)) {
    if (players.get(p.player_id)?.club_id !== data.clubId) continue;
    const key = `${p.player_id}|${monthOf(p.paid_on)}`;
    paid.set(key, (paid.get(key) || 0) + num(p.amount));
  }
  const items = [];
  for (const s of arr(data.subscriptions)) {
    const player = players.get(s.player_id);
    if (player?.club_id !== data.clubId) continue;
    const actual = paid.get(`${s.player_id}|${monthOf(s.month)}`) || 0;
    if (!sameMoney(s.amount_due, actual)) {
      items.push(`${playerText(player)}, месяц ${monthOf(s.month)}: в абонементе ${money(s.amount_due)}, платежей ${money(actual)}`);
    }
  }
  return issue(
    'subscription-amounts',
    'Абонементы: сумма не равна платежам',
    'hygiene',
    'Строки, пришедшие из импорта, имеют amount_due = сумме payments за месяц. Строки, созданные приложением («Создать абонементы на месяц», миграция 0032), хранят цену абонемента, поэтому при частичной оплате расхождение нормально. Долг считается по цене и платежам, а не по этому полю: смотрите только строки, где платежей БОЛЬШЕ суммы.',
    items,
  );
}

export function checkGroupPrices(data = {}) {
  const today = data.today || tbilisiToday();
  const month = monthOf(today);
  const individual = normalizeName('Индивидуальные / Вратарские');
  const activeGroupIds = new Set(clubPlayers(data).filter(p => p.status === 'active' && p.group_id).map(p => p.group_id));
  const prices = arr(data.prices).filter(p => p.club_id === data.clubId && p.kind === 'subscription');
  const valid = (price, groupId) =>
    price.group_id === groupId || price.group_id === null || price.group_id === undefined
      ? String(price.valid_from || '') <= month && (!price.valid_to || String(price.valid_to) >= month)
      : false;
  const items = clubGroups(data)
    .filter(g => activeGroupIds.has(g.id) && normalizeName(g.name) !== individual)
    .filter(g => !prices.some(p => valid(p, g.id)))
    .map(g => `${groupText(g)}: нет цены абонемента на ${month} (ни своей, ни общей)`);
  return issue(
    'group-prices',
    'Цены: у группы нет цены абонемента',
    'parents',
    'Если tariff_for не находит цену на текущий месяц, долг группе не считается. Группа «Индивидуальные / Вратарские» исключена по правилам долга.',
    items,
  );
}

export function checkPointEvents(data = {}) {
  const playerIds = clubPlayerIds(data);
  const matches = new Map(arr(data.matches).map(m => [m.id, m]));
  const sessions = new Map(arr(data.sessions).map(s => [s.id, s]));
  const rules = new Map(arr(data.rules).map(r => [r.id, r]));
  const roster = new Map(arr(data.matchPlayers).map(row => [`${row.match_id}|${row.player_id}`, row]));
  const items = [];
  for (const e of arr(data.pointEvents)) {
    if (!playerIds.has(e.player_id) || !['match', 'session'].includes(e.source_type)) continue;
    if (e.source_type === 'match' && !matches.has(e.source_id)) {
      items.push(`начисление ${e.id}: матч ${e.source_id} удалён`);
      continue;
    }
    if (e.source_type === 'session' && !sessions.has(e.source_id)) {
      items.push(`начисление ${e.id}: занятие ${e.source_id} удалено`);
      continue;
    }
    const rule = rules.get(e.rule_id);
    if (!rule) {
      items.push(`начисление ${e.id}: правило ${e.rule_id} не найдено`);
      continue;
    }
    let expected = num(rule.points);
    if (e.source_type === 'match' && rule.code === 'match_goal') {
      const row = roster.get(`${e.source_id}|${e.player_id}`);
      if (!row) {
        items.push(`начисление ${e.id}: гол за матч ${e.source_id}, но строки состава нет`);
        continue;
      }
      expected = num(rule.points) * num(row.goals);
    }
    if (num(e.points) !== expected) {
      items.push(`начисление ${e.id} (${rule.code}): ${e.points} баллов, по правилу ожидается ${expected}`);
    }
  }
  return issue(
    'point-events',
    'Журнал баллов: сироты и несоответствие правилу',
    'parents',
    'Автоначисления match/session не должны ссылаться на удалённый источник; баллы должны совпадать с rule.points (для гола — с числом голов).',
    items,
  );
}

export function checkSessionsWithoutAttendance(data = {}) {
  const today = data.today || tbilisiToday();
  const sessionIds = clubSessionIds(data);
  const marked = new Set(arr(data.attendance).map(a => a.session_id));
  const items = arr(data.sessions)
    .filter(s => sessionIds.has(s.id))
    .filter(s => tbilisiDay(s.starts_at) < today && !marked.has(s.id))
    .map(s => `занятие ${s.id} (${tbilisiDay(s.starts_at)}): нет ни одной отметки посещаемости`);
  return issue(
    'sessions-without-attendance',
    'Занятия без отметок посещаемости',
    'staff',
    'Прошедшее занятие группы должно иметь attendance; иначе тренер не видит состав и баллы не начислены.',
    items,
  );
}

export function checkGroupsWithoutSchedule(data = {}) {
  const groupIds = new Set(arr(data.weeklySchedule).map(s => s.group_id));
  const active = new Map();
  for (const p of clubPlayers(data)) {
    if (p.status === 'active' && p.group_id) active.set(p.group_id, (active.get(p.group_id) || 0) + 1);
  }
  const items = clubGroups(data)
    .filter(g => active.has(g.id) && !groupIds.has(g.id))
    .map(g => `${groupText(g)}: ${active.get(g.id)} активных игроков, но weekly_schedule пуст`);
  return issue(
    'groups-without-schedule',
    'Группы без расписания',
    'staff',
    'У группы с активными игроками должна быть хотя бы одна строка weekly_schedule, иначе тренер не откроет занятие.',
    items,
  );
}

export function checkMultipleSessionsPerDay(data = {}) {
  const sessionIds = clubSessionIds(data);
  const groups = new Map(arr(data.groups).map(g => [g.id, g]));
  const byDay = new Map();
  for (const s of arr(data.sessions)) {
    if (!sessionIds.has(s.id)) continue;
    const key = `${s.group_id}|${tbilisiDay(s.starts_at)}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }
  const items = [];
  for (const [key, rows] of byDay) {
    if (rows.length < 2) continue;
    const [groupId, day] = key.split('|');
    items.push(`${groupText(groups.get(groupId))}, ${day}: ${rows.length} занятия (${rows.map(s => s.id).join(', ')})`);
  }
  return issue(
    'multiple-sessions',
    'Несколько занятий в один день у группы',
    'hygiene',
    'Проверьте, не дублируются ли sessions: у одной группы в один день несколько записей.',
    items,
  );
}

export function checkGuardianVersions(data = {}) {
  const playerIds = clubPlayerIds(data);
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const testVersions = new Set(['test-2026-10', 'link-request-v0']);
  const items = arr(data.playerGuardians)
    .filter(g => playerIds.has(g.player_id) && testVersions.has(g.consent_version))
    .map(g => `${playerText(players.get(g.player_id))}, пользователь ${g.user_id}: тестовая связь ${g.consent_version}`);
  return issue(
    'test-guardian-links',
    'Согласия: тестовые связи',
    'hygiene',
    'Связи с consent_version test-2026-10 или link-request-v0 не содержат настоящего согласия; владелец решил их удалить.',
    items,
  );
}

export function checkGuardianClubs(data = {}) {
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const byUser = new Map();
  for (const g of arr(data.playerGuardians)) {
    if (g.consent_revoked_at) continue;
    const player = players.get(g.player_id);
    if (!player) continue;
    if (!byUser.has(g.user_id)) byUser.set(g.user_id, new Set());
    byUser.get(g.user_id).add(player.club_id);
  }
  const items = [];
  for (const [userId, clubs] of byUser) {
    if (clubs.size > 1) items.push(`пользователь ${userId}: действующие связи с детьми в клубах ${[...clubs].join(', ')}`);
  }
  return issue(
    'guardian-clubs',
    'Согласия: ребёнок в другом клубе',
    'hygiene',
    'У одного родителя действующие связи с детьми из разных клубов — проверьте, не ошибка ли это.',
    items,
  );
}

export function checkOldLinkRequests(data = {}) {
  const playerIds = clubPlayerIds(data);
  const players = new Map(arr(data.players).map(p => [p.id, p]));
  const now = data.now ? Date.parse(data.now) : Date.parse(`${data.today || tbilisiToday()}T00:00:00Z`);
  const items = arr(data.linkRequests)
    .filter(r => playerIds.has(r.player_id) && r.status === 'pending')
    .filter(r => Number.isFinite(Date.parse(r.created_at)) && Date.parse(r.created_at) < now - 14 * 24 * 60 * 60 * 1000)
    .map(r => `запрос ${r.id}: ${playerText(players.get(r.player_id))}, создан ${r.created_at}`);
  return issue(
    'old-link-requests',
    'Запросы на связь старше 14 дней',
    'staff',
    'link_requests в статусе pending старше 14 дней — администратору нужно принять решение или отклонить.',
    items,
  );
}

export function checkUsers(data = {}) {
  const users = arr(data.users);
  const items = [];
  for (const u of users) {
    if (u.telegram_id === null || u.telegram_id === undefined || String(u.telegram_id).trim() === '') {
      items.push(`пользователь ${u.id}: нет telegram_id`);
    }
  }
  const byTelegram = new Map();
  for (const u of users) {
    if (u.telegram_id === null || u.telegram_id === undefined) continue;
    const key = String(u.telegram_id);
    if (!byTelegram.has(key)) byTelegram.set(key, []);
    byTelegram.get(key).push(u);
  }
  for (const [telegramId, rows] of byTelegram) {
    if (rows.length > 1) items.push(`telegram_id ${telegramId}: пользователи ${rows.map(u => u.id).join(', ')}`);
  }
  return issue(
    'users',
    'Пользователи: telegram_id',
    'staff',
    'users без telegram_id и дубли по telegram_id. Без Telegram ID вход и уведомления не работают.',
    items,
  );
}

export function checkCoachesOutsideClub(data = {}) {
  const groups = new Map(arr(data.groups).map(g => [g.id, g]));
  const items = [];
  for (const row of arr(data.coachGroups)) {
    const group = groups.get(row.group_id);
    if (!group) {
      items.push(`тренер ${row.user_id}: группа ${row.group_id} не найдена`);
    } else if (group.club_id !== data.clubId) {
      items.push(`тренер ${row.user_id}: ${groupText(group)} из клуба ${group.club_id}`);
    }
  }
  return issue(
    'coaches-outside-club',
    'Тренеры вне клуба',
    'hygiene',
    'coach_groups не должен назначать тренера на группы другого клуба. Привязки администратора к клубу в схеме нет.',
    items,
  );
}

export function runChecks(data = {}) {
  const prepared = {
    ...data,
    today: data.today || tbilisiToday(),
    now: data.now || new Date().toISOString(),
  };
  return [
    checkMatchTeams(prepared),
    checkGoalsVsScore(prepared),
    checkGoalsWithoutPlaying(prepared),
    checkLineups(prepared),
    checkRosterPlayers(prepared),
    checkPlayerGroups(prepared),
    checkDuplicatePlayers(prepared),
    checkMissingBirthDates(prepared),
    checkPaymentsWithoutPlayer(prepared),
    checkFuturePayments(prepared),
    checkSubscriptionsWithoutGroup(prepared),
    checkPaymentsWithoutSubscription(prepared),
    checkSubscriptionAmounts(prepared),
    checkGroupPrices(prepared),
    checkPointEvents(prepared),
    checkSessionsWithoutAttendance(prepared),
    checkGroupsWithoutSchedule(prepared),
    checkMultipleSessionsPerDay(prepared),
    checkGuardianVersions(prepared),
    checkGuardianClubs(prepared),
    checkOldLinkRequests(prepared),
    checkUsers(prepared),
    checkCoachesOutsideClub(prepared),
  ];
}

export function hasActionable(checks = []) {
  return checks.some(c => c.items.length > 0 && (c.severity === 'parents' || c.severity === 'staff'));
}

export function countBySeverity(checks = []) {
  const result = { parents: 0, staff: 0, hygiene: 0 };
  for (const c of checks) {
    if (result[c.severity] !== undefined) result[c.severity] += c.items.length;
  }
  return result;
}

export function formatReport(checks = [], { limit = 20 } = {}) {
  const head = ['Проверка', 'Проблем', 'Серьёзность'];
  const rows = checks.map(c => [c.title, String(c.items.length), SEVERITY[c.severity] || c.severity]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = `+${widths.map(w => '-'.repeat(w + 2)).join('+')}+`;
  const row = cells => `| ${cells.map((c, i) => (i === 1 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join(' | ')} |`;
  const totals = countBySeverity(checks);
  const total = checks.reduce((sum, c) => sum + c.items.length, 0);
  const out = [
    'Проверка согласованности данных',
    `Проверок: ${checks.length}; проблем: ${total}; влияет на родителей: ${totals.parents}; влияет на тренеров/администратора: ${totals.staff}; гигиена: ${totals.hygiene}`,
    line,
    row(head),
    line,
    ...rows.map(row),
    line,
  ];
  for (const c of checks) {
    if (!c.items.length) continue;
    out.push('');
    out.push(`${c.title} — ${c.items.length} (${SEVERITY[c.severity] || c.severity})`);
    out.push(c.description);
    for (const item of c.items.slice(0, limit)) out.push(`  - ${item}`);
    if (c.items.length > limit) out.push(`  … ещё ${c.items.length - limit}`);
  }
  return out.join('\n');
}
