-- pgTAP (0218): group_parent_usernames() и запрет записи ника из приложения. Только синтетические данные.
-- Условия приёмки: docs/acceptance/parent-tg-username-2026-11-21.md (U1-U5).
begin;
create extension if not exists pgtap;
select plan(21);

create function tx(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
create function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function as_anon_session() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
-- ник пользователя, прочитанный от имени суперпользователя (минуя RLS)
create function nick(uid uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('role', 'postgres', true);
  select telegram_username into r from users where id = uid;
  return r;
end $$;

-- Клуб 1; админ 10; тренеры 11 (группа 2) и 12 (группа 3); родители 21 (согласие с контактом, будет ник), 22 (то же, без ника),
-- 23 (согласие без контакта тренеру, будет ник), 24 (группа 3, будет ник).
insert into clubs (id, name) values (tx(1), 'Клуб');
insert into groups (id, club_id, name) values (tx(2), tx(1), 'Группа У9'), (tx(3), tx(1), 'Группа У11');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  (tx(10), 7010, 'Админ', true, tx(1)), (tx(11), 7011, 'Тренер У9', false, tx(1)), (tx(12), 7012, 'Тренер У11', false, tx(1)),
  (tx(21), 7021, 'Р21', false, tx(1)), (tx(22), 7022, 'Р22', false, tx(1)), (tx(23), 7023, 'Р23', false, tx(1)), (tx(24), 7024, 'Р24', false, tx(1));
insert into coach_groups (user_id, group_id) values (tx(11), tx(2)), (tx(12), tx(3));
insert into players (id, club_id, group_id, full_name, status) values
  (tx(31), tx(1), tx(2), 'Синтетик Альфа', 'active'), (tx(32), tx(1), tx(2), 'Синтетик Бета', 'active'),
  (tx(33), tx(1), tx(2), 'Синтетик Гамма', 'active'), (tx(34), tx(1), tx(3), 'Синтетик Дельта', 'active');
insert into consent_versions (version, coach_contacts) values ('with-contacts', true), ('old-text', false);
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  (tx(31), tx(21), 'with-contacts', now(), null), (tx(32), tx(22), 'with-contacts', now(), null),
  (tx(33), tx(23), 'old-text', now(), null), (tx(34), tx(24), 'with-contacts', now(), null);

-- U1: ники записывает только сервер (service_role из tg-auth); из приложения записи нет
select as_user(tx(21));
select is((select count(*)::int from pg_proc where proname = 'set_my_tg_username' and pronamespace = 'public'::regnamespace), 0, 'U1: функции записи ника для приложения нет');
update users set telegram_username = 'Hacker' where id = tx(21);
select is(nick(tx(21)), null, 'U1: прямой UPDATE ника от authenticated (своя строка) не меняет данные');
select as_user(tx(21));
update users set telegram_username = 'Hacker' where id = tx(22);
select is(nick(tx(22)), null, 'U1: прямой UPDATE чужой строки не меняет данные');
select as_anon_session();
select lives_ok($$update users set telegram_username = 'Hacker' where id = '00000000-0000-0000-0000-000000000015'$$, 'U1: без входа UPDATE не падает, но ничего не меняет');
select is(nick(tx(21)), null, 'U1: ник без входа не записан');
select throws_ok($$update users set telegram_username = 'a b' where id = '00000000-0000-0000-0000-000000000015'$$, '23514', null, 'U1: формат ника защищён ограничением таблицы (запись от имени сервера)');
select throws_ok($$update users set telegram_username = 'abcd' where id = '00000000-0000-0000-0000-000000000015'$$, '23514', null, 'U1: ник из 4 знаков отклоняется ограничением таблицы (Telegram: от 5)');
select lives_ok($$update users set telegram_username = 'abcde' where id = '00000000-0000-0000-0000-000000000015'$$, 'U1: ник из 5 знаков принимается');
update users set telegram_username = null where id = tx(21);
-- ники, как их записал бы tg-auth (service_role / владелец)
select is(nick(tx(21)), null, 'U1: ник без входа не изменился (перед записью ников сервером)');
update users set telegram_username = 'Mama_One' where id = tx(21);
update users set telegram_username = 'Papa23' where id = tx(23);
update users set telegram_username = 'Papa24' where id = tx(24);

-- U2/U3: ники родителей группы для тренера и администратора
select as_user(tx(11));
select is((select count(*)::int from group_parent_usernames(tx(2))), 1, 'U2: тренер группы видит ник одного родителя (без ника и без согласия на контакт не показаны)');
select is((select telegram_id from group_parent_usernames(tx(2))), 7021::bigint, 'U2: это родитель с согласием и ником');
select is((select username from group_parent_usernames(tx(2))), 'Mama_One', 'U2: ник');
select as_user(tx(10));
select is((select count(*)::int from group_parent_usernames(tx(2))), 1, 'U2: администратор видит тот же набор');
select is((select count(*)::int from group_parent_usernames(tx(3))), 1, 'U2: администратор видит ник родителя другой группы');
select as_user(tx(12));
select throws_ok($$select * from group_parent_usernames('00000000-0000-0000-0000-000000000002')$$, '42501', 'forbidden', 'U2: тренер чужой группы получает forbidden');
select as_user(tx(21));
select throws_ok($$select * from group_parent_usernames('00000000-0000-0000-0000-000000000002')$$, '42501', 'forbidden', 'U2: родитель получает forbidden');
select as_anon_session();
select throws_ok($$select * from group_parent_usernames('00000000-0000-0000-0000-000000000002')$$, '42501', 'forbidden', 'U2: без входа forbidden');
-- U4: RLS users не ослаблена
select as_user(tx(24));
select is((select count(*)::int from users where id = tx(21)), 0, 'U4: чужая строка users (с ником) родителю по-прежнему не видна');
-- U5: права
-- U5: права на функции (база с привилегиями по умолчанию Supabase)
select nick(tx(21));
select ok(has_function_privilege('authenticated', 'group_parent_usernames(uuid)', 'execute'), 'U5: group_parent_usernames доступна authenticated');
select ok(not has_function_privilege('anon', 'group_parent_usernames(uuid)', 'execute'), 'U5: group_parent_usernames закрыта для anon');
select ok(not has_function_privilege('public', 'group_parent_usernames(uuid)', 'execute'), 'U5: group_parent_usernames закрыта для public');
select * from finish();
rollback;
