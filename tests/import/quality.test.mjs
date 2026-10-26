import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkCoachesOutsideClub,
  checkDuplicatePlayers,
  checkFuturePayments,
  isPrepayment,
  checkGoalsVsScore,
  checkGoalsWithoutPlaying,
  checkGroupPrices,
  checkGroupsWithoutSchedule,
  checkGuardianClubs,
  checkGuardianVersions,
  checkLineups,
  checkMatchTeams,
  checkMissingBirthDates,
  checkMultipleSessionsPerDay,
  checkOldLinkRequests,
  checkPaymentsWithoutPlayer,
  checkPaymentsWithoutSubscription,
  checkPlayerGroups,
  checkPointEvents,
  checkRosterPlayers,
  checkSessionsWithoutAttendance,
  checkSubscriptionAmounts,
  checkSubscriptionsWithoutGroup,
  checkUsers,
  countBySeverity,
  formatReport,
  hasActionable,
  runChecks,
  tbilisiToday,
} from '../../scripts/import/quality-checks.mjs';

const empty = {
  groups: [],
  players: [],
  matches: [],
  matchPlayers: [],
  subscriptions: [],
  payments: [],
  prices: [],
  pointEvents: [],
  rules: [],
  sessions: [],
  attendance: [],
  weeklySchedule: [],
  playerGuardians: [],
  linkRequests: [],
  users: [],
  coachGroups: [],
};

const make = overrides => ({
  clubId: 'C1',
  today: '2026-10-23',
  now: '2026-10-23T09:00:00Z',
  ...empty,
  ...overrides,
});

test('матчи: команда сравнивается с названием группы без регистра и лишних пробелов', () => {
  const c = checkMatchTeams(make({
    groups: [{ id: 'G1', club_id: 'C1', name: '2015' }],
    matches: [
      { id: 'M1', club_id: 'C1', played_on: '2026-10-01', team: ' 2015 ' },
      { id: 'M2', club_id: 'C1', played_on: '2026-10-02', team: '2016' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /M2/);
});

test('матчи: команда без суффикса группы (U10 = U10-A + U10-B), Ortachala U9 не склеивается с U9', () => {
  const c = checkMatchTeams(make({
    groups: [
      { id: 'G1', club_id: 'C1', name: 'U10-A' }, { id: 'G2', club_id: 'C1', name: 'U10-B' },
      { id: 'G3', club_id: 'C1', name: 'Ortachala U9' }, { id: 'G4', club_id: 'C1', name: 'U7-A' },
    ],
    matches: [
      { id: 'M1', club_id: 'C1', played_on: '2026-10-01', team: 'U10' },
      { id: 'M2', club_id: 'C1', played_on: '2026-10-02', team: 'U7' },
      { id: 'M3', club_id: 'C1', played_on: '2026-10-03', team: 'U9' },
      { id: 'M4', club_id: 'C1', played_on: '2026-10-04', team: 'U15' },
    ],
  }));
  assert.equal(c.items.length, 2);
  assert.match(c.items[0], /M3|U9/);
  assert.match(c.items[1], /U15/);
});

test('матчи: голы игроков не больше счёта', () => {
  const c = checkGoalsVsScore(make({
    matches: [{ id: 'M1', club_id: 'C1', played_on: '2026-10-01', goals_for: 1, goals_against: 0 }],
    matchPlayers: [
      { match_id: 'M1', player_id: 'P1', played: true, goals: 2 },
      { match_id: 'M1', player_id: 'P2', played: false, goals: 3 },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /2 гол/);
});

test('матчи: гол при played=false', () => {
  const c = checkGoalsWithoutPlaying(make({
    matches: [{ id: 'M1', club_id: 'C1', played_on: '2026-10-01' }],
    players: [{ id: 'P1', club_id: 'C1', full_name: 'Игрок' }],
    matchPlayers: [{ match_id: 'M1', player_id: 'P1', played: false, goals: 1 }],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /played = false/);
});

test('матчи: прошлый матч со счётом без состава и состав без счёта', () => {
  const c = checkLineups(make({
    matches: [
      { id: 'M1', club_id: 'C1', played_on: '2026-10-01', goals_for: 1, goals_against: 0 },
      { id: 'M2', club_id: 'C1', played_on: '2026-10-02', goals_for: null, goals_against: null },
    ],
    matchPlayers: [{ match_id: 'M2', player_id: 'P1' }],
  }));
  assert.equal(c.items.length, 2);
  assert.ok(c.items.some(x => /без состава/.test(x)));
  assert.ok(c.items.some(x => /счёт не заполнен/.test(x)));
});

test('матчи: игрок состава из другого клуба и несуществующий игрок', () => {
  const c = checkRosterPlayers(make({
    matches: [{ id: 'M1', club_id: 'C1', played_on: '2026-10-01' }],
    players: [{ id: 'P1', club_id: 'C2', full_name: 'Чужой' }],
    matchPlayers: [
      { match_id: 'M1', player_id: 'P1' },
      { match_id: 'M1', player_id: 'PX' },
    ],
  }));
  assert.equal(c.items.length, 2);
  assert.ok(c.items.some(x => /другого клуба/.test(x)));
  assert.ok(c.items.some(x => /не найден/.test(x)));
});

test('игроки: активный без группы, с потерянной группой и с пустым названием', () => {
  const c = checkPlayerGroups(make({
    groups: [{ id: 'G1', club_id: 'C1', name: ' ' }],
    players: [
      { id: 'P1', club_id: 'C1', full_name: 'Без группы', status: 'active', group_id: null },
      { id: 'P2', club_id: 'C1', full_name: 'Потерян', status: 'active', group_id: 'GX' },
      { id: 'P3', club_id: 'C1', full_name: 'Пустая', status: 'active', group_id: 'G1' },
      { id: 'P4', club_id: 'C1', full_name: 'Неактивный', status: 'inactive', group_id: null },
    ],
  }));
  assert.equal(c.items.length, 3);
});

test('игроки: дубли только среди активных и с нормализацией ФИ', () => {
  const c = checkDuplicatePlayers(make({
    players: [
      { id: 'P1', club_id: 'C1', full_name: 'Иван Петров', status: 'active' },
      { id: 'P2', club_id: 'C1', full_name: ' иван  петров ', status: 'active' },
      { id: 'P3', club_id: 'C1', full_name: 'Иван Петров', status: 'inactive' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /Иван Петров/);
});

test('игроки: активные без даты рождения, неактивные не считаются', () => {
  const c = checkMissingBirthDates(make({
    players: [
      { id: 'P1', club_id: 'C1', full_name: 'Активный', status: 'active', birth_date: null },
      { id: 'P2', club_id: 'C1', full_name: 'С датой', status: 'active', birth_date: '2015-01-01' },
      { id: 'P3', club_id: 'C1', full_name: 'Неактивный', status: 'inactive', birth_date: null },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /Активный/);
});

test('платежи: игрок не найден', () => {
  const c = checkPaymentsWithoutPlayer(make({
    players: [{ id: 'P1', club_id: 'C1', full_name: 'Есть' }],
    payments: [
      { id: 'PAY1', player_id: 'P1', amount: 100, paid_on: '2026-10-01' },
      { id: 'PAY2', player_id: 'PX', amount: 100, paid_on: '2026-10-01' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /PAY2/);
});

test('платежи: дата в будущем по Тбилиси', () => {
  const c = checkFuturePayments(make({
    players: [{ id: 'P1', club_id: 'C1', full_name: 'Игрок' }],
    payments: [
      { id: 'PAY1', player_id: 'P1', amount: 100, paid_on: '2026-10-23' },
      { id: 'PAY2', player_id: 'P1', amount: 100, paid_on: '2026-10-24' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /PAY2/);
});

test('абонементы: без группы', () => {
  const c = checkSubscriptionsWithoutGroup(make({
    players: [{ id: 'P1', club_id: 'C1', full_name: 'Игрок' }],
    subscriptions: [
      { id: 'S1', player_id: 'P1', group_id: null, month: '2026-10-01' },
      { id: 'S2', player_id: 'P1', group_id: 'G1', month: '2026-11-01' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /2026-10-01/);
});

test('платежи: нет строки абонемента за месяц', () => {
  const c = checkPaymentsWithoutSubscription(make({
    players: [
      { id: 'P1', club_id: 'C1', full_name: 'Без абонемента' },
      { id: 'P2', club_id: 'C1', full_name: 'С абонементом' },
    ],
    subscriptions: [{ id: 'S1', player_id: 'P2', month: '2026-10-01' }],
    payments: [
      { id: 'PAY1', player_id: 'P1', amount: 100, paid_on: '2026-10-15' },
      { id: 'PAY2', player_id: 'P2', amount: 100, paid_on: '2026-10-15' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /PAY1/);
});

test('абонементы: amount_due равно сумме платежей', () => {
  const c = checkSubscriptionAmounts(make({
    players: [
      { id: 'P1', club_id: 'C1', full_name: 'Расхождение' },
      { id: 'P2', club_id: 'C1', full_name: 'Сходится' },
    ],
    subscriptions: [
      { id: 'S1', player_id: 'P1', month: '2026-10-01', amount_due: 5000 },
      { id: 'S2', player_id: 'P2', month: '2026-10-01', amount_due: 4000 },
    ],
    payments: [
      { id: 'PAY1', player_id: 'P1', amount: 3000, paid_on: '2026-10-10' },
      { id: 'PAY2', player_id: 'P2', amount: 4000, paid_on: '2026-10-10' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /5000/);
  assert.equal(c.severity, 'hygiene'); // строки приложения хранят цену абонемента: частичная оплата не ошибка
});

test('цены: у группы с активными игроками нет цены, индивидуальная исключена', () => {
  const c = checkGroupPrices(make({
    groups: [
      { id: 'G1', club_id: 'C1', name: '2015' },
      { id: 'G2', club_id: 'C1', name: '2016' },
      { id: 'G3', club_id: 'C1', name: 'Индивидуальные / Вратарские' },
    ],
    players: [
      { id: 'P1', club_id: 'C1', status: 'active', group_id: 'G1' },
      { id: 'P2', club_id: 'C1', status: 'active', group_id: 'G2' },
      { id: 'P3', club_id: 'C1', status: 'active', group_id: 'G3' },
    ],
    prices: [{ id: 'PR1', club_id: 'C1', group_id: 'G2', kind: 'subscription', valid_from: '2026-01-01', valid_to: null }],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /G1/);
});

test('баллы: сирота, пропавшее правило и неверное число баллов', () => {
  const c = checkPointEvents(make({
    players: [{ id: 'P1', club_id: 'C1', full_name: 'Игрок' }],
    matches: [{ id: 'M1', club_id: 'C1', played_on: '2026-10-01' }],
    sessions: [{ id: 'S1', group_id: 'G1', starts_at: '2026-10-01T10:00:00+04:00' }],
    matchPlayers: [{ match_id: 'M1', player_id: 'P1', goals: 3, played: true }],
    rules: [
      { id: 'R1', club_id: 'C1', code: 'match_goal', points: 2 },
      { id: 'R2', club_id: 'C1', code: 'match_played', points: 1 },
    ],
    pointEvents: [
      { id: 'E1', player_id: 'P1', rule_id: 'R1', source_type: 'match', source_id: 'M1', points: 5 },
      { id: 'E2', player_id: 'P1', rule_id: 'R1', source_type: 'match', source_id: 'MX', points: 2 },
      { id: 'E3', player_id: 'P1', rule_id: 'R1', source_type: 'session', source_id: 'SX', points: 2 },
      { id: 'E4', player_id: 'P1', rule_id: 'RX', source_type: 'match', source_id: 'M1', points: 1 },
      { id: 'E5', player_id: 'P1', rule_id: 'R2', source_type: 'match', source_id: 'M1', points: 1 },
    ],
  }));
  assert.equal(c.items.length, 4);
  assert.ok(c.items.some(x => /E1/.test(x) && /ожидается 6/.test(x)));
  assert.ok(c.items.some(x => /E2/.test(x) && /удалён/.test(x)));
  assert.ok(c.items.some(x => /E3/.test(x) && /удалено/.test(x)));
  assert.ok(c.items.some(x => /E4/.test(x) && /не найдено/.test(x)));
});

test('занятия: прошедшее без посещаемости, будущее не считается', () => {
  const c = checkSessionsWithoutAttendance(make({
    groups: [{ id: 'G1', club_id: 'C1', name: '2015' }],
    sessions: [
      { id: 'S1', group_id: 'G1', starts_at: '2026-10-22T10:00:00+04:00' },
      { id: 'S2', group_id: 'G1', starts_at: '2026-10-22T18:00:00+04:00' },
      { id: 'S3', group_id: 'G1', starts_at: '2026-10-24T10:00:00+04:00' },
    ],
    attendance: [{ session_id: 'S2', player_id: 'P1', status: 'present' }],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /S1/);
});

test('группы: активные игроки есть, расписания нет', () => {
  const c = checkGroupsWithoutSchedule(make({
    groups: [
      { id: 'G1', club_id: 'C1', name: 'Без расписания' },
      { id: 'G2', club_id: 'C1', name: 'С расписанием' },
      { id: 'G3', club_id: 'C1', name: 'Без игроков' },
    ],
    players: [
      { id: 'P1', club_id: 'C1', status: 'active', group_id: 'G1' },
      { id: 'P2', club_id: 'C1', status: 'active', group_id: 'G2' },
    ],
    weeklySchedule: [{ id: 'W1', group_id: 'G2', weekday: 1 }],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /G1/);
});

test('занятия: несколько записей у группы в один день', () => {
  const c = checkMultipleSessionsPerDay(make({
    groups: [{ id: 'G1', club_id: 'C1', name: '2015' }],
    sessions: [
      { id: 'S1', group_id: 'G1', starts_at: '2026-10-22T10:00:00+04:00' },
      { id: 'S2', group_id: 'G1', starts_at: '2026-10-22T18:00:00+04:00' },
      { id: 'S3', group_id: 'G1', starts_at: '2026-10-23T10:00:00+04:00' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /2026-10-22/);
});

test('согласия: тестовые версии', () => {
  const c = checkGuardianVersions(make({
    players: [{ id: 'P1', club_id: 'C1', full_name: 'Ребёнок' }],
    playerGuardians: [
      { player_id: 'P1', user_id: 'U1', consent_version: 'test-2026-10' },
      { player_id: 'P1', user_id: 'U2', consent_version: 'consent-v1' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /U1/);
});

test('согласия: действующие связи с детьми из разных клубов', () => {
  const c = checkGuardianClubs(make({
    players: [
      { id: 'P1', club_id: 'C1', full_name: 'Первый' },
      { id: 'P2', club_id: 'C2', full_name: 'Второй' },
    ],
    playerGuardians: [
      { player_id: 'P1', user_id: 'U1', consent_revoked_at: null },
      { player_id: 'P2', user_id: 'U1', consent_revoked_at: null },
      { player_id: 'P2', user_id: 'U2', consent_revoked_at: '2026-01-01T00:00:00Z' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /U1/);
});

test('запросы на связь: pending старше 14 дней', () => {
  const c = checkOldLinkRequests(make({
    players: [{ id: 'P1', club_id: 'C1', full_name: 'Ребёнок' }],
    linkRequests: [
      { id: 'L1', player_id: 'P1', status: 'pending', created_at: '2026-10-01T09:00:00Z' },
      { id: 'L2', player_id: 'P1', status: 'pending', created_at: '2026-10-20T09:00:00Z' },
      { id: 'L3', player_id: 'P1', status: 'approved', created_at: '2026-09-01T09:00:00Z' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /L1/);
});

test('пользователи: пустой и дублирующийся telegram_id', () => {
  const c = checkUsers(make({
    users: [
      { id: 'U1', telegram_id: null },
      { id: 'U2', telegram_id: 100 },
      { id: 'U3', telegram_id: 100 },
    ],
  }));
  assert.equal(c.items.length, 2);
  assert.ok(c.items.some(x => /U1/.test(x)));
  assert.ok(c.items.some(x => /100/.test(x)));
});

test('тренеры: группа другого клуба или несуществующая', () => {
  const c = checkCoachesOutsideClub(make({
    groups: [
      { id: 'G1', club_id: 'C1', name: 'Своя' },
      { id: 'G2', club_id: 'C2', name: 'Чужая' },
    ],
    coachGroups: [
      { user_id: 'U1', group_id: 'G1' },
      { user_id: 'U2', group_id: 'G2' },
      { user_id: 'U3', group_id: 'GX' },
    ],
  }));
  assert.equal(c.items.length, 2);
  assert.ok(c.items.some(x => /U2/.test(x)));
  assert.ok(c.items.some(x => /U3/.test(x)));
});

test('пустые данные: запускаются все проверки и проблем нет', () => {
  const checks = runChecks(make({}));
  assert.equal(checks.length, 23);
  assert.equal(checks.reduce((sum, c) => sum + c.items.length, 0), 0);
  assert.equal(hasActionable(checks), false);
  assert.deepEqual(countBySeverity(checks), { parents: 0, staff: 0, hygiene: 0 });
});

test('отчёт: таблица, детали и ограничение 20 строк', () => {
  const checks = [{
    id: 'x',
    title: 'Тестовая проверка',
    severity: 'parents',
    description: 'Описание проверки',
    items: Array.from({ length: 22 }, (_, i) => `строка ${i}`),
    total: 22,
  }];
  const report = formatReport(checks);
  assert.match(report, /Проверка\s+\|\s+Проблем\s+\|\s+Серьёзность/);
  assert.match(report, /Тестовая проверка/);
  assert.match(report, /влияет на родителей/);
  assert.match(report, /строка 19/);
  assert.doesNotMatch(report, /строка 20/);
  assert.match(report, /ещё 2/);
});

test('код выхода: hygiene не включает тревогу, parents и staff включают', () => {
  const one = severity => [{ id: 'x', title: 'x', severity, description: '', items: ['x'], total: 1 }];
  assert.equal(hasActionable(one('hygiene')), false);
  assert.equal(hasActionable(one('staff')), true);
  assert.equal(hasActionable(one('parents')), true);
});

test('Тбилиси: дата переходит на следующий день после 20:00 UTC', () => {
  assert.equal(tbilisiToday(new Date('2026-10-23T20:30:00Z')), '2026-10-24');
});

test('CLI: --write запрещён и даёт код 2', () => {
  const cli = fileURLToPath(new URL('../../scripts/import/quality.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--write'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /только читает/);
});

test('CLI: в скрипте нет запросов, кроме GET', () => {
  const cli = fileURLToPath(new URL('../../scripts/import/quality.mjs', import.meta.url));
  const source = readFileSync(cli, 'utf8');
  assert.doesNotMatch(source, /method\s*:/);
  assert.doesNotMatch(source, /\b(POST|PATCH|PUT|DELETE)\b/);
  assert.doesNotMatch(source, /\brpc\b/);
});

test('отчёт: limit Infinity выводит все строки, по умолчанию 20', () => {
  const items = Array.from({ length: 29 }, (_, i) => `матч ${i}`);
  const checks = [{ id: 'x', title: 'Проверка', severity: 'staff', description: 'д', items }];
  assert.match(formatReport(checks), /… ещё 9/);
  const all = formatReport(checks, { limit: Infinity });
  assert.doesNotMatch(all, /… ещё/);
  assert.match(all, /матч 28/);
});

test('платежи: оплата за следующий месяц с 22-го числа не ошибка', () => {
  const players = [{ id: 'P1', club_id: 'C1', full_name: 'Игрок' }];
  const payments = [{ id: 'PAY1', player_id: 'P1', amount: 100, paid_on: '2026-11-01' }, { id: 'PAY2', player_id: 'P1', amount: 100, paid_on: '2026-11-02' }];
  const c = checkFuturePayments(make({ players, payments, today: '2026-10-26' }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /PAY2/);
  assert.equal(checkFuturePayments(make({ players, payments: [payments[0]], today: '2026-10-21' })).items.length, 1);
  assert.equal(isPrepayment('2027-01-01', '2026-12-31'), true);
});

test('матчи: весенние матчи с составом и без счёта не считаются проблемой, осенние считаются', () => {
  const c = checkLineups(make({
    today: '2026-10-26',
    matches: [
      { id: 'M1', club_id: 'C1', played_on: '2026-05-17', team: 'U9-A' },
      { id: 'M2', club_id: 'C1', played_on: '2026-09-12', team: 'U9-A' },
    ],
    matchPlayers: [{ match_id: 'M1', player_id: 'P1' }, { match_id: 'M2', player_id: 'P1' }],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /M2|2026-09-12/);
});

test('матчи: команда U12 (Newton cup) без группы не считается ошибкой, Ortachala U12 не подменяет её', () => {
  const c = checkMatchTeams(make({
    groups: [{ id: 'G1', club_id: 'C1', name: 'Ortachala U12' }],
    matches: [
      { id: 'M1', club_id: 'C1', played_on: '2026-06-14', team: 'U12' },
      { id: 'M2', club_id: 'C1', played_on: '2026-06-15', team: 'U15' },
    ],
  }));
  assert.equal(c.items.length, 1);
  assert.match(c.items[0], /U15/);
});
