-- pgTAP (0217): my_link_requests() и my_pending_consents(). Только синтетические данные.
-- Условия приёмки: docs/acceptance/link-screens-2026-11-21.md (С1-С9).
begin;
create extension if not exists pgtap;
select plan(28);

create function tx(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function set_mode(m text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  delete from club_settings where club_id = tx(1) and key = 'consent.mode';
  if m is not null then insert into club_settings (club_id, key, scope, value) values (tx(1), 'consent.mode', '', m); end if;
end $$;
-- id детей, предложенных на согласие пользователю (строкой)
create function pend(uid uuid) returns text language plpgsql as $$
begin
  perform as_user(uid);
  return coalesce((select string_agg(player_id::text, ',' order by player_id) from my_pending_consents()), '');
end $$;
create function ids(variadic n int[]) returns text language sql immutable as $$
  select coalesce(string_agg(tx(x)::text, ',' order by tx(x)), '') from unnest(n) x
$$;

-- Клуб 1, группа 2, админ 10; родители 21-26, 29 без связей; дети 31-34; запросы родителей 21 и 22.
insert into clubs (id, name) values (tx(1), 'Клуб');
insert into groups (id, club_id, name) values (tx(2), tx(1), 'Группа У9');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  (tx(10), 7010, 'Админ', true, tx(1)),
  (tx(21), 7021, 'Р21', false, tx(1)), (tx(22), 7022, 'Р22', false, tx(1)), (tx(23), 7023, 'Р23', false, tx(1)),
  (tx(24), 7024, 'Р24', false, tx(1)), (tx(25), 7025, 'Р25', false, tx(1)), (tx(26), 7026, 'Р26', false, tx(1)), (tx(29), 7029, 'Без связей', false, tx(1));
insert into players (id, club_id, group_id, full_name, status) values
  (tx(31), tx(1), tx(2), 'Синтетик Альфа', 'active'), (tx(32), tx(1), tx(2), 'Синтетик Бета', 'active'),
  (tx(33), tx(1), null, 'Синтетик Гамма', 'active'), (tx(34), tx(1), tx(2), 'Синтетик Дельта', 'active');
-- запросы: 21 -> Альфа (ждёт), 21 -> Гамма (отклонён), 22 -> Бета (ждёт)
insert into link_requests (id, user_id, player_id, status, created_at) values
  (tx(61), tx(21), tx(31), 'pending', now() - interval '2 hours'),
  (tx(62), tx(21), tx(33), 'rejected', now() - interval '1 hour'),
  (tx(63), tx(22), tx(32), 'pending', now());
-- связи: 23 -> Альфа, 24 -> Бета, 25 -> Дельта, 26 -> Альфа
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  (tx(31), tx(23), 'lawyer-2026-11-v1', now()), (tx(32), tx(24), 'lawyer-2026-11-v1', now()),
  (tx(34), tx(25), 'lawyer-2026-11-v1', now()), (tx(31), tx(26), 'lawyer-2026-11-v1', now());

-- С1/С2: свои запросы, имя виден до подтверждения, чужих нет
select as_user(tx(21));
select results_eq($$select id, status, player_id, full_name, group_name from my_link_requests()$$,
  $$values (tx(62), 'rejected'::text, tx(33), 'Синтетик Гамма'::text, null::text), (tx(61), 'pending'::text, tx(31), 'Синтетик Альфа'::text, 'Группа У9'::text)$$,
  'С1/С2: родитель видит только свои запросы с именем и группой ребёнка, новые первыми');
select is((select count(*)::int from players where id = tx(31)), 0, 'С2: прямой выбор players родителю по-прежнему закрыт (RLS не ослаблена)');
select is((select count(*)::int from link_requests where user_id = tx(22)), 0, 'С1: чужой запрос напрямую не виден');
select as_user(tx(22));
select is((select count(*)::int from my_link_requests()), 1, 'С1: второй родитель видит только свой запрос');
select as_user(tx(29));
select is((select count(*)::int from my_link_requests()), 0, 'С1: без запросов список пуст, не ошибка');
reset role;
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select * from my_link_requests()$$, '42501', 'forbidden', 'С1: без пользователя forbidden');
select throws_ok($$select * from my_pending_consents()$$, '42501', 'forbidden', 'С6: без пользователя forbidden');

-- Версии согласия: сначала только версия из будущего (текущей нет), затем 51 текущая, позже 52
reset role;
insert into consent_doc_versions (id, consent_type, version, effective_from) values (tx(53), 'data_processing', 'syn-future', now() + interval '30 days');
select set_mode('all');
select is(pend(tx(23)), '', 'С4: текущей версии нет (есть только версия из будущего), предложения нет');
reset role;
insert into consent_doc_versions (id, consent_type, version, effective_from) values (tx(51), 'data_processing', 'syn-dp-0', now() - interval '20 days');

-- С4: режим off, и нет текущей версии у режима all
select set_mode(null);
select is(pend(tx(23)), '', 'С4/off: режим off, предлагать нечего');
reset role; select set_mode('all');
-- версия 51 текущая, у 23/24/25/26 согласия нет
select is(pend(tx(23)), ids(31), 'С3/all: связь без согласия, предлагается ребёнок');
select is(pend(tx(29)), '', 'С6/all: без связей пусто');
select is(pend(tx(21)), '', 'С6/all: запрос без связи не даёт предложения');
reset role;
select as_user(tx(23));
select results_eq($$select player_id, full_name, group_name, version_id, version from my_pending_consents()$$,
  $$values (tx(31), 'Синтетик Альфа'::text, 'Группа У9'::text, tx(51), 'syn-dp-0'::text)$$,
  'С3: поля результата: ребёнок, группа, id и название текущей версии');

-- С4: режим test: вне consent_test_parents предложения нет, внутри есть
reset role; select set_mode('test');
select is(pend(tx(23)), '', 'С4/test: родитель вне consent_test_parents не получает предложения');
reset role;
insert into consent_test_parents (parent_user_id) values (tx(23)), (tx(24)), (tx(25)), (tx(26));
select is(pend(tx(23)), ids(31), 'С3/test: родитель из consent_test_parents получает предложение');

-- С7: принял — предложение исчезло, my_children возвращает ребёнка
reset role; select as_user(tx(23));
select is((select count(*)::int from my_children()), 0, 'С7: до принятия my_children() пуст');
select accept_consent(tx(31), 'data_processing', tx(51));
select is(pend(tx(23)), '', 'С7: после принятия предложение исчезло');
select is((select count(*)::int from my_children()), 1, 'С7: после принятия my_children() возвращает ребёнка');

-- С4: отзыв родителем не предлагается повторно; отзыв системой предлагается (С5)
reset role; select as_user(tx(24)); select accept_consent(tx(32), 'data_processing', tx(51)); select revoke_parent_consent(tx(32), 'data_processing');
select is(pend(tx(24)), '', 'С4: отозванное родителем согласие заново не предлагается');
reset role;
select as_user(tx(26)); select accept_consent(tx(31), 'data_processing', tx(51));
reset role;
select consent_record(tx(26), tx(31), 'data_processing', 'revoked', null, 'system', null);
select is(pend(tx(26)), ids(31), 'С5: согласие, снятое системой, предлагается снова');
reset role;
select consent_record(tx(25), tx(34), 'data_processing', 'granted', tx(51), 'admin', tx(10));   -- админ принял за родителя...
select consent_record(tx(25), tx(34), 'data_processing', 'revoked', null, 'admin', tx(10));      -- ...и снял
select is(pend(tx(25)), '', 'С4: согласие, снятое администратором, заново не предлагается');

-- С5: принято по старой версии, появилась новая: нужна новая
reset role; select as_user(tx(23));
reset role;
insert into consent_doc_versions (id, consent_type, version, effective_from) values (tx(52), 'data_processing', 'syn-dp-1', now() - interval '1 day');
select is(pend(tx(23)), ids(31), 'С5: принята устаревшая версия, предлагается текущая');
reset role; select as_user(tx(23));
select is((select version_id from my_pending_consents() limit 1), tx(52), 'С5: предлагается именно текущая версия');
select accept_consent(tx(31), 'data_processing', tx(52));
select is(pend(tx(23)), '', 'С7: принята текущая версия, предложения нет');

-- С8: права на базе с привилегиями по умолчанию Supabase: функции создаются заново, как после чистой установки
reset role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function my_link_requests();
drop function my_pending_consents();
\i db/migrations/0217_link_screens.sql
select ok(has_function_privilege('authenticated', 'public.my_link_requests()', 'execute') and has_function_privilege('authenticated', 'public.my_pending_consents()', 'execute'), 'С8: authenticated вызывает обе функции');
select ok(not has_function_privilege('anon', 'public.my_link_requests()', 'execute') and not has_function_privilege('anon', 'public.my_pending_consents()', 'execute'), 'С8: anon не вызывает (default privileges Supabase)');
select ok(not has_function_privilege('public', 'public.my_link_requests()', 'execute') and not has_function_privilege('public', 'public.my_pending_consents()', 'execute'), 'С8: public не вызывает');
select ok((select bool_and(prosecdef and provolatile = 's') from pg_proc where oid in ('public.my_link_requests()'::regprocedure, 'public.my_pending_consents()'::regprocedure)), 'security definer, stable (только чтение)');

select * from finish();
rollback;
