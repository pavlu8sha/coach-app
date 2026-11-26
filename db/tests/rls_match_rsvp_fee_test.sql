-- pgTAP: взнос за матч в форме матча с подтверждением (0226). Условия: docs/MATCH_RSVP_FEE_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(91);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0226_match_rsvp_fee.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А'), ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7902, 'Тренер А', false),
  ('00000000-0000-0000-0000-0000000000c2', 7903, 'Тренер Б', false),
  ('00000000-0000-0000-0000-0000000000b1', 7904, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 7905, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 7906, 'Чужой родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U12'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000c002', 'U12');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 3', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 4', 'active'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000e9', 'Чужой', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-0000000000b3', 't', now(), null);
insert into tournaments (id, club_id, kind, team, name, fee) values
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000c001', 'championship', 'U12', 'Чемпионат', 0),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-00000000c001', 'cup', 'U12', 'Кубок', 0);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create or replace function mid(k text) returns uuid language sql stable as $$ select v from ids where ids.k = mid.k $$;
grant execute on function mid(text) to authenticated;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function fee_of(m uuid, p uuid) returns numeric language sql stable as $$ select amount from match_fees where match_id = m and player_id = p $$;

-- 1. схема и права
select has_column('public', 'matches', 'fee', 'у матча есть колонка fee');
select ok(has_function_privilege('authenticated', 'match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid, numeric)', 'execute'), 'authenticated создаёт черновик со взносом');
select ok(not has_function_privilege('anon', 'match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid, numeric)', 'execute'), 'anon не создаёт (при умолчаниях Supabase)');
select ok(not has_function_privilege('public', 'match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid, numeric)', 'execute'), 'public не создаёт');
select ok(not has_function_privilege('anon', 'match_rsvp_my_matches()', 'execute'), 'anon не читает match_rsvp_my_matches');

-- 2. доступ
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Динамо', now() + interval '5 days', null, null, null, null, 30)$$, '42501', 'not authenticated', 'без входа нельзя');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Динамо', now() + interval '5 days', null, null, null, null, 30)$$, '42501', 'forbidden', 'родитель не создаёт матч со взносом');
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Динамо', now() + interval '5 days', null, null, null, null, 30)$$, '42501', 'forbidden', 'тренер другого клуба не создаёт');

-- 3. создание: сумма, ограничения
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Динамо', now() + interval '5 days', null, null, null, null, -5)$$, '22023', 'bad fee', 'отрицательная сумма отклоняется');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U12', 'Динамо', now() + interval '5 days', null, null, null, '00000000-0000-0000-0000-0000000000a9', 30)$$, '22023', 'fee not allowed', 'у матча чемпионата взноса нет');
select lives_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Старый вызов', now() + interval '5 days', null, null, null)$$, 'вызов без суммы (прежняя форма) работает');
select lives_ok($$insert into ids select 'm', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Динамо', now() + interval '5 days', 'Поле', 'Адрес', null, null, 30)$$, 'тренер создаёт матч со взносом 30');
select lives_ok($$insert into ids select 'cup', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U12', 'Кубковый', now() + interval '5 days', null, null, null, '00000000-0000-0000-0000-0000000000a8', 20)$$, 'матч кубка со взносом допустим');
select lives_ok($$insert into ids select 'ch', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U12', 'Чемпионатный', now() + interval '5 days', null, null, null, '00000000-0000-0000-0000-0000000000a9')$$, 'черновик матча чемпионата без суммы');
reset role;
select is((select fee from matches where id = mid('m')), 30.00::numeric, 'сумма сохранена в матче');
select is((select count(*)::int from match_fees where match_id = mid('m')), 0, 'у черновика взносов по игрокам нет');
select throws_ok($$update matches set fee = -1 where id = mid('m')$$, '23514', null, 'check: отрицательная сумма в таблице невозможна');

-- 4. update: сумма, чемпионат, чужие
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_rsvp_update(mid('ch'), '{"fee": 10}'::jsonb)$$, '22023', 'fee not allowed', 'в матче чемпионата сумму не задать');
select throws_ok($$select match_rsvp_update(mid('m'), '{"fee": -1}'::jsonb)$$, '22023', 'bad fee', 'отрицательная сумма в update отклоняется');
select lives_ok($$select match_rsvp_update(mid('m'), '{"fee": 30}'::jsonb)$$, 'повтор той же суммы без ошибок');
select lives_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000d002','00000000-0000-0000-0000-00000000d003']::uuid[])$$, 'состав черновика');
select lives_ok($$select match_rsvp_publish(mid('m'))$$, 'публикация');
reset role;

-- 5. публикация создаёт взносы приглашённым
select is((select count(*)::int from match_fees where match_id = mid('m')), 3, 'после публикации взнос у каждого приглашённого');
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d001'), 30.00::numeric, 'сумма взноса = сумме матча');

-- 6. состав после публикации
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d004']::uuid[])$$, 'добавили игрока после публикации');
reset role;
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d004'), 30.00::numeric, 'новому игроку взнос по сумме матча');
-- d002 платит, d003 нет
insert into match_payments (match_id, player_id, amount, paid_on, method) values (mid('m'), '00000000-0000-0000-0000-00000000d002', 10, current_date, 'Наличные');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_remove(mid('m'), array['00000000-0000-0000-0000-00000000d003','00000000-0000-0000-0000-00000000d002']::uuid[])$$, 'убрали двоих');
reset role;
select ok(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d003') is null, 'у исключённого без оплат взнос снят');
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d002'), 30.00::numeric, 'у исключённого с оплатой взнос остаётся');
select is((select count(*)::int from match_payments where match_id = mid('m')), 1, 'оплата не удалена');
-- отказ родителя состав и взнос не меняет
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select match_rsvp_answer(mid('m'), '00000000-0000-0000-0000-00000000d001', 'no')$$, 'родитель отвечает «Не буду»');
reset role;
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d001'), 30.00::numeric, 'отказ не снимает взнос');
-- вернули d003 повторно
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d003']::uuid[])$$, 'вернули исключённого');
reset role;
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d003'), 30.00::numeric, 'вернувшемуся взнос создан заново');

-- смена суммы: у оплативших не меняется, у остальных меняется
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('m'), '{"fee": 40}'::jsonb)$$, 'сумма матча изменена до 40');
reset role;
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d001'), 40.00::numeric, 'без оплат: новая сумма');
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d004'), 40.00::numeric, 'без оплат (добавленный): новая сумма');
select is(fee_of(mid('m'), '00000000-0000-0000-0000-00000000d002'), 30.00::numeric, 'с оплатой: сумма не изменилась');
select is((select fee from matches where id = mid('m')), 40.00::numeric, 'в матче сумма 40');

-- fee = null снимает только неоплаченные
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('m'), '{"fee": null}'::jsonb)$$, 'сумму убрали');
reset role;
select is((select array_agg(player_id)::text from match_fees where match_id = mid('m')), '{00000000-0000-0000-0000-00000000d002}', 'остался только взнос с оплатой');
select ok((select fee from matches where id = mid('m')) is null, 'в матче суммы нет');

-- 7. ноль не создаёт строк; черновик ничего не оставляет
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'z', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Нулевой', now() + interval '6 days', null, null, null, null, 0)$$, 'матч с нулевой суммой');
select lives_ok($$select match_rsvp_invite(mid('z'), array['00000000-0000-0000-0000-00000000d001']::uuid[])$$, 'состав нулевого матча');
select lives_ok($$select match_rsvp_publish(mid('z'))$$, 'публикация нулевого матча');
reset role;
select is((select count(*)::int from match_fees where match_id = mid('z')), 0, 'при сумме 0 взносов нет');

-- 8. отмена: неоплаченные удаляются, оплаченные остаются
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('m'), '{"fee": 30}'::jsonb)$$, 'сумма снова 30');
select lives_ok($$select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d001']::uuid[])$$, 'приглашён d001 (уже в составе)');
select lives_ok($$select match_rsvp_cancel(mid('m'), 'дождь')$$, 'матч отменён');
reset role;
select is((select array_agg(player_id)::text from match_fees where match_id = mid('m')), '{00000000-0000-0000-0000-00000000d002}', 'после отмены остался только взнос с оплатой');

-- 9. родитель: сумма в приглашении только у своих детей
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select fee from match_rsvp_my_matches() where match_id = mid('z') and player_id = '00000000-0000-0000-0000-00000000d001'), 0.00::numeric, 'родитель видит сумму своего матча');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from match_rsvp_my_matches()), 0, 'чужой родитель не видит матчей и сумм клуба А');
select throws_ok($$insert into match_fees (match_id, player_id, amount) values (mid('z'), '00000000-0000-0000-0000-00000000d001', 5)$$, '42501', null, 'прямая запись во взносы клиентом закрыта');
reset role;

-- 10. скидки: строки со скидкой не меняются (ревью #837, P1)
-- 10а. матч со взносом 30: d002 получает скидку до 10, d003 позже скидку 40 -> 30, d001 и d004 обычные
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'd', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Скидочный', now() + interval '8 days', null, null, null, null, 30)$$, 'матч для проверки скидок');
select lives_ok($$select match_rsvp_invite(mid('d'), array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000d002','00000000-0000-0000-0000-00000000d003','00000000-0000-0000-0000-00000000d004']::uuid[])$$, 'состав скидочного матча');
select lives_ok($$select match_rsvp_publish(mid('d'))$$, 'публикация скидочного матча');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select match_discount(mid('d'), '00000000-0000-0000-0000-00000000d002', 10, 'Скидка тренера')$$, 'скидка d002 до 10');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('d'), '{"fee": 40}'::jsonb)$$, 'сумма матча 40');
reset role;
select is(fee_of(mid('d'), '00000000-0000-0000-0000-00000000d001'), 40.00::numeric, 'обычная строка получила 40');
select is(fee_of(mid('d'), '00000000-0000-0000-0000-00000000d002'), 10.00::numeric, 'скидка 10 при смене суммы сохранена');
select is(fee_of(mid('d'), '00000000-0000-0000-0000-00000000d003'), 40.00::numeric, 'у игрока без скидки сумма стала 40');
-- d003 получает скидку 40 -> 30; затем сумма матча проходит через 30, 50: сумма скидки совпадает с прежней суммой матча
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select match_discount(mid('d'), '00000000-0000-0000-0000-00000000d003', 30, 'Скидка 40 на 30')$$, 'скидка d003 до 30');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('d'), '{"fee": 30}'::jsonb)$$, 'сумма матча 30');
select lives_ok($$select match_rsvp_update(mid('d'), '{"fee": 50}'::jsonb)$$, 'сумма матча 50 (прежняя была 30, как сумма скидки d003)');
reset role;
select is(fee_of(mid('d'), '00000000-0000-0000-0000-00000000d001'), 50.00::numeric, 'обычная строка получила 50');
select is(fee_of(mid('d'), '00000000-0000-0000-0000-00000000d003'), 30.00::numeric, 'скидка с суммой, равной прежней сумме матча, сохранена (определяется по журналу)');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('d'), '{"fee": null}'::jsonb)$$, 'сумму очистили');
reset role;
select ok(fee_of(mid('d'), '00000000-0000-0000-0000-00000000d001') is null and fee_of(mid('d'), '00000000-0000-0000-0000-00000000d004') is null, 'обычные строки сняты');
select is((select array_agg(player_id order by player_id)::text from match_fees where match_id = mid('d')), '{00000000-0000-0000-0000-00000000d002,00000000-0000-0000-0000-00000000d003}', 'при очистке остались строки со скидкой');
-- убрали игрока со скидкой: строка остаётся, решает администратор
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('d'), '{"fee": 30}'::jsonb)$$, 'сумма снова 30');
select lives_ok($$select match_rsvp_remove(mid('d'), array['00000000-0000-0000-0000-00000000d002']::uuid[])$$, 'убрали игрока со скидкой');
reset role;
select is(fee_of(mid('d'), '00000000-0000-0000-0000-00000000d002'), 10.00::numeric, 'взнос со скидкой при исключении остаётся');

-- 10б. первое задание суммы: существующие строки (вручную и со скидкой) не перезаписываются, недостающие создаются
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'e', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Ручные взносы', now() + interval '9 days', null, null, null)$$, 'матч без суммы');
select lives_ok($$select match_rsvp_invite(mid('e'), array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000d002','00000000-0000-0000-0000-00000000d003']::uuid[])$$, 'состав матча без суммы');
select lives_ok($$select match_rsvp_publish(mid('e'))$$, 'публикация матча без суммы');
select lives_ok($$select match_fee_add(mid('e'), array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000d002']::uuid[], 25)$$, 'взносы вручную по 25');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select match_discount(mid('e'), '00000000-0000-0000-0000-00000000d002', 10, 'Скидка вручную')$$, 'скидка d002 до 10');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_update(mid('e'), '{"fee": 30}'::jsonb)$$, 'сумма задана впервые');
reset role;
select is(fee_of(mid('e'), '00000000-0000-0000-0000-00000000d001'), 25.00::numeric, 'ручная сумма 25 не перезаписана');
select is(fee_of(mid('e'), '00000000-0000-0000-0000-00000000d002'), 10.00::numeric, 'скидка 10 не перезаписана');
select is(fee_of(mid('e'), '00000000-0000-0000-0000-00000000d003'), 30.00::numeric, 'недостающему приглашённому взнос создан');

-- 10в. скидка до 0109 без записи в журнале: при исключении игрока и при отмене остаётся (ревью #837, повторное)
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'f', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Старые скидки', now() + interval '10 days', null, null, null, null, 30)$$, 'матч со старой скидкой');
select lives_ok($$select match_rsvp_invite(mid('f'), array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000d002','00000000-0000-0000-0000-00000000d003']::uuid[])$$, 'состав матча со старой скидкой');
select lives_ok($$select match_rsvp_publish(mid('f'))$$, 'публикация матча со старой скидкой');
reset role;
update match_fees set amount = 10 where match_id = mid('f') and player_id = '00000000-0000-0000-0000-00000000d002'; -- скидка без строки журнала, как до 0109
select is((select count(*)::int from fee_discount_log where ref_id = mid('f')), 0, 'в журнале скидок по матчу записей нет (старая скидка)');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_remove(mid('f'), array['00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000d002']::uuid[])$$, 'убрали обычного игрока и игрока со старой скидкой');
reset role;
select ok(fee_of(mid('f'), '00000000-0000-0000-0000-00000000d001') is null, 'обычный взнос исключённого снят');
select is(fee_of(mid('f'), '00000000-0000-0000-0000-00000000d002'), 10.00::numeric, 'старая скидка при исключении остаётся');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_cancel(mid('f'), 'отмена')$$, 'матч со старой скидкой отменён');
reset role;
select ok(fee_of(mid('f'), '00000000-0000-0000-0000-00000000d003') is null, 'при отмене обычный взнос снят');
select is(fee_of(mid('f'), '00000000-0000-0000-0000-00000000d002'), 10.00::numeric, 'при отмене старая скидка остаётся');

select * from finish();
rollback;
