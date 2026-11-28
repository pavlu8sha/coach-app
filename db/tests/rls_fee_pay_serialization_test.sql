-- pgTAP: оплата взносов матча и события (миграция 0232, Issue #722; docs/FEE_PAY_SERIALIZATION_ACCEPTANCE.md, п. 3, 5, 6).
-- Гонки проверяет db/tests/concurrency_fee_pay.sh; здесь: частичная и полная оплата, права, search_path, тело функции.
begin;
create extension if not exists pgtap;
select plan(37);

insert into clubs (id, name) values ('00000000-0000-0000-0000-000000722c01', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-00000000a722', 97221, 'Админ', true),
  ('00000000-0000-0000-0000-00000000c722', 97222, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-00000000e722', '00000000-0000-0000-0000-000000722c01', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-00000000c722', '00000000-0000-0000-0000-00000000e722');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000722d001', '00000000-0000-0000-0000-000000722c01', '00000000-0000-0000-0000-00000000e722', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000722d002', '00000000-0000-0000-0000-000000722c01', '00000000-0000-0000-0000-00000000e722', 'Игрок 2'),
  ('00000000-0000-0000-0000-00000722d003', '00000000-0000-0000-0000-000000722c01', '00000000-0000-0000-0000-00000000e722', 'Игрок 3'),
  ('00000000-0000-0000-0000-00000722d004', '00000000-0000-0000-0000-000000722c01', '00000000-0000-0000-0000-00000000e722', 'Игрок 4');
insert into matches (id, club_id, played_on, team, opponent, kind) values
  ('00000000-0000-0000-0000-00000722f001', '00000000-0000-0000-0000-000000722c01', '2026-11-10', 'U9', 'Олимп', 'friendly'),
  ('00000000-0000-0000-0000-00000722f002', '00000000-0000-0000-0000-000000722c01', '2026-11-11', 'U9', 'Звезда', 'game');
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-00000722a001', '00000000-0000-0000-0000-000000722c01', 'U9', 'championship', 'Ч1', 100);
update matches set tournament_id = '00000000-0000-0000-0000-00000722a001' where id = '00000000-0000-0000-0000-00000722f002';
insert into match_fees (match_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-00000722f001', '00000000-0000-0000-0000-00000722d001', 100, false),
  ('00000000-0000-0000-0000-00000722f001', '00000000-0000-0000-0000-00000722d002', 100, true),
  ('00000000-0000-0000-0000-00000722f001', '00000000-0000-0000-0000-00000722d003', 100, true),
  ('00000000-0000-0000-0000-00000722f002', '00000000-0000-0000-0000-00000722d001', 100, false);
insert into tournament_fees (tournament_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-00000722a001', '00000000-0000-0000-0000-00000722d001', 100, false),
  ('00000000-0000-0000-0000-00000722a001', '00000000-0000-0000-0000-00000722d002', 100, true),
  ('00000000-0000-0000-0000-00000722a001', '00000000-0000-0000-0000-00000722d004', 100, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Права и тело (до смены роли)
select ok(has_function_privilege('authenticated', 'public.match_pay(uuid,uuid[],numeric,date,text,text)', 'execute'), 'authenticated выполняет match_pay');
select ok(not has_function_privilege('anon', 'public.match_pay(uuid,uuid[],numeric,date,text,text)', 'execute'), 'anon не выполняет match_pay');
select ok(has_function_privilege('authenticated', 'public.event_pay(uuid,uuid[],numeric,date,text,text)', 'execute'), 'authenticated выполняет event_pay');
select ok(not has_function_privilege('anon', 'public.event_pay(uuid,uuid[],numeric,date,text,text)', 'execute'), 'anon не выполняет event_pay');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.match_pay(uuid,uuid[],numeric,date,text,text)'::regprocedure), 'match_pay: security definer, search_path = public, pg_temp');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.event_pay(uuid,uuid[],numeric,date,text,text)'::regprocedure), 'event_pay: security definer, search_path = public, pg_temp');
select ok(position('for update' in lower(pg_get_functiondef('public.match_pay(uuid,uuid[],numeric,date,text,text)'::regprocedure))) > 0, 'match_pay блокирует строку взноса (for update)');
select ok(position('for update' in lower(pg_get_functiondef('public.event_pay(uuid,uuid[],numeric,date,text,text)'::regprocedure))) > 0, 'event_pay блокирует строку взноса (for update)');

-- Тренер: товарищеский матч можно, матч чемпионата и событие нельзя
select as_user('00000000-0000-0000-0000-00000000c722');
select throws_ok($$select match_pay('00000000-0000-0000-0000-00000722f002', array['00000000-0000-0000-0000-00000722d001']::uuid[], null, null, 'Наличные', null)$$, '42501', null, 'тренер: матч чемпионата закрыт');
select throws_ok($$select event_pay('00000000-0000-0000-0000-00000722a001', array['00000000-0000-0000-0000-00000722d001']::uuid[], null, null, 'Наличные', null)$$, '42501', null, 'тренер: оплата события закрыта');
select is(match_pay('00000000-0000-0000-0000-00000722f001', array['00000000-0000-0000-0000-00000722d001']::uuid[], 40, null, 'Наличные', null), 1, 'тренер: частичная оплата товарищеского матча');

select as_user('00000000-0000-0000-0000-00000000a722');
-- Матч
select is((select paid from match_fees where match_id = '00000000-0000-0000-0000-00000722f001' and player_id = '00000000-0000-0000-0000-00000722d001'), false, 'матч: после частичной 40 флаг paid не стоит');
select is(match_pay('00000000-0000-0000-0000-00000722f001', array['00000000-0000-0000-0000-00000722d001']::uuid[], null, null, 'Перевод', null), 1, 'матч: доплата остатка');
select is((select sum(amount) from match_payments where match_id = '00000000-0000-0000-0000-00000722f001' and player_id = '00000000-0000-0000-0000-00000722d001'), 100.00::numeric, 'матч: сумма 40 + 60 = 100');
select is((select paid from match_fees where match_id = '00000000-0000-0000-0000-00000722f001' and player_id = '00000000-0000-0000-0000-00000722d001'), true, 'матч: оплачено полностью');
select is(match_pay('00000000-0000-0000-0000-00000722f001', array['00000000-0000-0000-0000-00000722d001']::uuid[], null, null, 'Перевод', null), 0, 'матч: при остатке 0 вторая оплата возвращает 0');
select is((select count(*)::int from match_payments where match_id = '00000000-0000-0000-0000-00000722f001' and player_id = '00000000-0000-0000-0000-00000722d001'), 2, 'матч: строк оплат две, лишней нет');
select is(match_pay('00000000-0000-0000-0000-00000722f001', array['00000000-0000-0000-0000-00000722d002', '00000000-0000-0000-0000-00000722d002']::uuid[], 10, null, 'Наличные', null), 1, 'матч: повтор id в массиве даёт одну оплату (0072), явная сумма сверх взноса допустима');
select is((select count(*)::int from match_payments where match_id = '00000000-0000-0000-0000-00000722f001' and player_id = '00000000-0000-0000-0000-00000722d002' and comment = 'Оплата из импорта'), 1, 'матч: импортированный paid материализован один раз');
select throws_ok($$select match_pay('00000000-0000-0000-0000-00000722f001', array['00000000-0000-0000-0000-00000722d004']::uuid[], null, null, 'Наличные', null)$$, 'P0002', 'player not in match fees', 'матч: игрока нет во взносе');
select throws_ok($$select match_pay('00000000-0000-0000-0000-00000722f001', array['00000000-0000-0000-0000-00000722d001']::uuid[], -5, null, 'Наличные', null)$$, '22023', 'bad amount', 'матч: плохая сумма');
-- Событие
select is(event_pay('00000000-0000-0000-0000-00000722a001', array['00000000-0000-0000-0000-00000722d001']::uuid[], 40, null, 'Наличные', null), 1, 'событие: частичная оплата');
select is(event_pay('00000000-0000-0000-0000-00000722a001', array['00000000-0000-0000-0000-00000722d001']::uuid[], null, null, 'Перевод', null), 1, 'событие: доплата остатка до 100');
select is((select sum(amount) from tournament_payments where tournament_id = '00000000-0000-0000-0000-00000722a001' and player_id = '00000000-0000-0000-0000-00000722d001'), 100.00::numeric, 'событие: сумма 40 + 60 = 100');
select is(event_pay('00000000-0000-0000-0000-00000722a001', array['00000000-0000-0000-0000-00000722d001']::uuid[], null, null, 'Перевод', null), 0, 'событие: при остатке 0 возвращается 0');
select throws_ok($$select event_pay('00000000-0000-0000-0000-00000722a001', array['00000000-0000-0000-0000-00000722d003']::uuid[], null, null, 'Наличные', null)$$, 'P0002', 'player not in event', 'событие: игрока нет в составе');

-- Импортированный paid = true без строк оплат (ревью #872, P1): сумма и число строк журнала
-- amt = NULL: остаток 0, ничего не вставляется (импорт не материализуется, двойного учёта нет)
select is(match_pay('00000000-0000-0000-0000-00000722f001', array['00000000-0000-0000-0000-00000722d003']::uuid[], null, null, 'Наличные', null), 0, 'импорт, матч, amt=NULL: оплат нет (остаток 0)');
select is((select count(*)::int from match_payments where match_id = '00000000-0000-0000-0000-00000722f001' and player_id = '00000000-0000-0000-0000-00000722d003'), 0, 'импорт, матч, amt=NULL: строк журнала 0');
select is(event_pay('00000000-0000-0000-0000-00000722a001', array['00000000-0000-0000-0000-00000722d004']::uuid[], null, null, 'Наличные', null), 0, 'импорт, событие, amt=NULL: оплат нет (остаток 0)');
select is((select count(*)::int from tournament_payments where tournament_id = '00000000-0000-0000-0000-00000722a001' and player_id = '00000000-0000-0000-0000-00000722d004'), 0, 'импорт, событие, amt=NULL: строк журнала 0');
-- явная сумма 10: импортированные 100 сохраняются строкой (0071) и добавляется явный платёж 10, итого 110 в двух строках
select is((select count(*)::int || ':' || sum(amount) from match_payments where match_id = '00000000-0000-0000-0000-00000722f001' and player_id = '00000000-0000-0000-0000-00000722d002'), '2:110.00', 'импорт, матч, явная 10: строк 2, сумма 110 (импорт 100 + 10)');
select is(event_pay('00000000-0000-0000-0000-00000722a001', array['00000000-0000-0000-0000-00000722d002']::uuid[], 10, null, 'Наличные', null), 1, 'импорт, событие, явная 10: одна оплата');
select is((select count(*)::int || ':' || sum(amount) from tournament_payments where tournament_id = '00000000-0000-0000-0000-00000722a001' and player_id = '00000000-0000-0000-0000-00000722d002'), '2:110.00', 'импорт, событие, явная 10: строк 2, сумма 110 (импорт 100 + 10)');
select is((select count(*)::int from tournament_payments where tournament_id = '00000000-0000-0000-0000-00000722a001' and player_id = '00000000-0000-0000-0000-00000722d002' and comment = 'Оплата из импорта'), 1, 'импорт, событие: материализация одна');

-- Подмена объектов через pg_temp: временные таблицы с теми же именами не перехватывают запись
create temp table match_fees (match_id uuid, player_id uuid, amount numeric, paid boolean);
create temp table match_payments (match_id uuid, player_id uuid, amount numeric);
create temp table tournament_fees (tournament_id uuid, player_id uuid, amount numeric, paid boolean);
grant all on pg_temp.match_fees, pg_temp.match_payments, pg_temp.tournament_fees to authenticated;
select is(match_pay('00000000-0000-0000-0000-00000722f002', array['00000000-0000-0000-0000-00000722d001']::uuid[], 7, null, 'Наличные', null), 1, 'pg_temp: оплата идёт в public.match_fees при одноимённых временных таблицах');
select is((select count(*)::int from pg_temp.match_payments), 0, 'pg_temp: во временную таблицу ничего не записано');
select is((select sum(amount) from public.match_payments where match_id = '00000000-0000-0000-0000-00000722f002'), 7.00::numeric, 'pg_temp: платёж записан в public.match_payments');

select * from finish();
rollback;
