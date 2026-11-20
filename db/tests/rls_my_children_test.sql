-- pgTAP (0215): серверный список детей my_children(). Только синтетические данные.
-- Условия приёмки: docs/acceptance/my-children-2026-11-20.md (номера У1-У14).
begin;
create extension if not exists pgtap;
select plan(40);

create function tx(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
-- режим ставит владелец базы (без JWT): вызывать после reset role
create function set_mode(m text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  delete from club_settings where club_id = tx(1) and key = 'consent.mode';
  if m is not null then insert into club_settings (club_id, key, scope, value) values (tx(1), 'consent.mode', '', m); end if;
end $$;
-- id детей, которых вернул my_children() пользователю (строкой, по возрастанию)
create function kids(uid uuid) returns text language plpgsql as $$
begin
  perform as_user(uid);
  return coalesce((select string_agg(player_id::text, ',' order by player_id) from my_children()), '');
end $$;
-- id детей из связей пользователя, для которых is_guardian_of() истинно (эталон RLS)
create function rls_kids(uid uuid) returns text language plpgsql as $$
declare r text;
begin
  perform as_user(uid);
  select coalesce(string_agg(g.player_id::text, ',' order by g.player_id), '') into r
    from player_guardians g where g.user_id = uid and is_guardian_of(g.player_id);
  return r;
end $$;
-- id детей из связей пользователя, которые виден ему в players (политика players_read)
create function visible_kids(uid uuid) returns text language plpgsql as $$
declare r text;
begin
  perform as_user(uid);
  select coalesce(string_agg(p.id::text, ',' order by p.id), '') into r
    from players p where p.id in (select g.player_id from player_guardians g where g.user_id = uid);
  return r;
end $$;
create function ids(variadic n int[]) returns text language sql immutable as $$
  select coalesce(string_agg(tx(x)::text, ',' order by tx(x)), '') from unnest(n) x
$$;
create function same_as_rls(uid uuid) returns boolean language plpgsql as $$
declare a text; b text; c text;
begin
  a := kids(uid); b := rls_kids(uid); c := visible_kids(uid);
  return a = b and b = c;
end $$;

-- Клуб 1, группа 2, админ 10; родители 21-28; дети 31-37 (37 без группы); пользователь без детей 29; версии 51-52.
insert into clubs (id, name) values (tx(1), 'Клуб');
insert into groups (id, club_id, name) values (tx(2), tx(1), 'Группа У9');
insert into users (id, telegram_id, display_name, is_admin, club_id, chosen_role) values
  (tx(10), 7010, 'Админ', true, tx(1), null),
  (tx(21), 7021, 'Р21', false, tx(1), null), (tx(22), 7022, 'Р22', false, tx(1), null), (tx(23), 7023, 'Р23', false, tx(1), null),
  (tx(24), 7024, 'Р24', false, tx(1), null), (tx(25), 7025, 'Р25', false, tx(1), null), (tx(26), 7026, 'Р26', false, tx(1), null),
  (tx(27), 7027, 'Р27', false, tx(1), null), (tx(28), 7028, 'Р28', false, tx(1), null), (tx(29), 7029, 'Без детей', false, tx(1), null);
insert into players (id, club_id, group_id, full_name, status) values
  (tx(31), tx(1), tx(2), 'Синтетик Альфа', 'active'), (tx(32), tx(1), tx(2), 'Синтетик Бета', 'active'),
  (tx(33), tx(1), tx(2), 'Синтетик Гамма', 'active'), (tx(34), tx(1), tx(2), 'Синтетик Дельта', 'active'),
  (tx(35), tx(1), tx(2), 'Синтетик Эпсилон', 'active'), (tx(36), tx(1), tx(2), 'Синтетик Зета', 'inactive'),
  (tx(37), tx(1), null, 'Синтетик Эта', 'active');
-- 21: Альфа и Эта; 22: Альфа (второй родитель); 23: Бета; 25: Дельта; 26 и 27: Эпсилон; 24: Гамма (старый отзыв); 28: Зета (неактивный игрок)
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  (tx(31), tx(21), 'lawyer-2026-11-v1', now()), (tx(37), tx(21), 'lawyer-2026-11-v1', now()), (tx(31), tx(22), 'lawyer-2026-11-v1', now()),
  (tx(32), tx(23), 'lawyer-2026-11-v1', now()), (tx(34), tx(25), 'lawyer-2026-11-v1', now()),
  (tx(35), tx(26), 'lawyer-2026-11-v1', now()), (tx(35), tx(27), 'lawyer-2026-11-v1', now()),
  (tx(36), tx(28), 'lawyer-2026-11-v1', now());
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  (tx(33), tx(24), 'lawyer-2026-11-v1', now() - interval '30 days', now() - interval '20 days');
insert into consent_doc_versions (id, consent_type, version, effective_from, coach_contacts) values
  (tx(51), 'data_processing', 'syn-dp-0', now() - interval '20 days', true);

-- Состояния новой модели (как в rls_consent_access_test): версия 0 устареет, затем появится текущая версия 1
select as_user(tx(25)); select accept_consent(tx(34), 'data_processing', tx(51));
reset role;
insert into consent_doc_versions (id, consent_type, version, effective_from, coach_contacts) values
  (tx(52), 'data_processing', 'syn-dp-1', now() - interval '10 days', true);
select as_user(tx(21)); select accept_consent(tx(31), 'data_processing', tx(52)); select accept_consent(tx(37), 'data_processing', tx(52));
select as_user(tx(23)); select accept_consent(tx(32), 'data_processing', tx(52));
select as_user(tx(24)); select accept_consent(tx(33), 'data_processing', tx(52));     -- принял после старого отзыва
select as_user(tx(26)); select accept_consent(tx(35), 'data_processing', tx(52));
select revoke_parent_consent(tx(35), 'data_processing');                              -- новый отзыв родителем
select as_user(tx(27)); select accept_consent(tx(35), 'data_processing', tx(52));
select as_user(tx(28)); select accept_consent(tx(36), 'data_processing', tx(52));
reset role;

-- У14 (проверка условий без пользователя) и У10: без sub — forbidden
select set_mode(null);
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select * from my_children()$$, '42501', 'forbidden', 'У10: без пользователя my_children() отвечает forbidden');
select as_user(tx(29));
select is(kids(tx(29)), '', 'У2: пользователь без детей получает пустой список, не ошибку');

-- Режим off (нет ключа)
select is(kids(tx(21)), ids(31, 37), 'У1/off: родитель видит обоих своих детей');
select is(kids(tx(22)), ids(31), 'У8/off: второй родитель того же ребёнка видит его независимо');
select is(kids(tx(23)), ids(32), 'У4/off: ребёнок со связью без отзыва виден');
select is(kids(tx(24)), '', 'У3/off: старый отзыв consent_revoked_at закрывает ребёнка');
select is(kids(tx(26)), '', 'У3/off: новый отзыв родителем закрывает ребёнка');
select is(kids(tx(27)), ids(35), 'У8/off: второй родитель того же ребёнка отзыв первого не затрагивает');
select is(kids(tx(28)), ids(36), 'У1/off: статус игрока не фильтруется');
select is(kids(tx(25)), ids(34), 'У4/off: принятая устаревшая версия на доступ при off не влияет');
select is(kids(tx(10)), '', 'У2: чужие дети в список не попадают (у админа нет связей)');

-- У4: системный отзыв (связь удалена и создана заново владельцем) при off доступ не закрывает
reset role;
delete from player_guardians where player_id = tx(32) and user_id = tx(23);
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values (tx(32), tx(23), 'lawyer-2026-11-v1', now());
select is(kids(tx(23)), ids(32), 'У4/off: системный отзыв (пересоздание связи) доступ не закрывает');

-- У7: эквивалентность с RLS (off)
select ok(same_as_rls(tx(21)) and same_as_rls(tx(22)) and same_as_rls(tx(23)) and same_as_rls(tx(24)) and same_as_rls(tx(25))
      and same_as_rls(tx(26)) and same_as_rls(tx(27)) and same_as_rls(tx(28)) and same_as_rls(tx(29)), 'У7/off: my_children() = is_guardian_of() = видимые players');

-- Режим test: тестовый родитель 22 (новая модель, согласия нет), остальные по прежним правилам
reset role;
insert into consent_test_parents (parent_user_id) values (tx(22)) on conflict do nothing;
select set_mode('test');
select is(kids(tx(22)), '', 'У5/test: родитель из consent_test_parents без согласия ребёнка не видит');
select is(kids(tx(21)), ids(31, 37), 'У5/test: родитель вне списка идёт по прежним правилам');
select is(kids(tx(24)), '', 'У5/test: вне списка старый отзыв по-прежнему закрывает');
reset role;
select as_user(tx(22)); select accept_consent(tx(31), 'data_processing', tx(52));
select is(kids(tx(22)), ids(31), 'У5/test: после принятия родитель из списка видит ребёнка');
select ok(same_as_rls(tx(21)) and same_as_rls(tx(22)) and same_as_rls(tx(24)) and same_as_rls(tx(26)) and same_as_rls(tx(27)), 'У7/test: my_children() = is_guardian_of() = видимые players');

-- Режим all (регистр и пробелы не важны)
reset role; select set_mode(' ALL ');
select is(kids(tx(21)), ids(31, 37), 'У6/all: родитель с согласием видит обоих детей');
select is(kids(tx(22)), ids(31), 'У6/all: второй родитель с личным согласием видит ребёнка');
select is(kids(tx(23)), '', 'У6/all: связь пересоздана системой, согласия нет — ребёнка нет');
select is(kids(tx(24)), ids(33), 'У6/all: старый consent_revoked_at не мешает после принятия');
select is(kids(tx(25)), '', 'У3/all: принята устаревшая версия — ребёнка нет');
select is(kids(tx(26)), '', 'У3/all: новый отзыв закрывает ребёнка');
select is(kids(tx(27)), ids(35), 'У8/all: родитель, не отзывавший, видит ребёнка');
select is(kids(tx(29)), '', 'У2/all: без связей список пуст');
select ok(same_as_rls(tx(21)) and same_as_rls(tx(22)) and same_as_rls(tx(23)) and same_as_rls(tx(24)) and same_as_rls(tx(25))
      and same_as_rls(tx(26)) and same_as_rls(tx(27)) and same_as_rls(tx(28)), 'У7/all: my_children() = is_guardian_of() = видимые players');

-- У6: ребёнок со связью consent_revoked_at is null, но без принятия — не виден (расхождение, ради которого функция)
reset role;
select is((select count(*)::int from player_guardians where user_id = tx(23) and consent_revoked_at is null), 1, 'У6: связь родителя 23 без consent_revoked_at');
select is(kids(tx(23)), '', 'У6/all: consent_revoked_at is null без принятия — ребёнка нет');

-- У1/У9: поля результата
select as_user(tx(21));
select results_eq($$select player_id, full_name, group_id, group_name from my_children() order by full_name$$,
  $$values (tx(31), 'Синтетик Альфа'::text, tx(2), 'Группа У9'::text), (tx(37), 'Синтетик Эта'::text, null::uuid, null::text)$$,
  'У1/У9: имя, группа и название группы; без группы — null');
select is((select string_agg(full_name, ',' order by ordinality) from my_children() with ordinality), 'Синтетик Альфа,Синтетик Эта', 'порядок по имени');

-- У11: только чтение
reset role;
select is((select count(*)::int from player_guardians), 9, 'У11: связи не изменились');
select is(kids(tx(21)), ids(31, 37), 'У11: повторный вызов даёт тот же список');
reset role;
select is((select count(*)::int from player_guardians), 9, 'У11: вызов не меняет связи');
select is((select provolatile from pg_proc where oid = 'public.my_children()'::regprocedure), 's', 'У11: функция stable');

-- У10: права на базе с привилегиями по умолчанию Supabase: функция создаётся заново, как после чистой установки
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function my_children();
\i db/migrations/0215_my_children.sql
select ok(has_function_privilege('authenticated', 'public.my_children()', 'execute'), 'У10: authenticated вызывает my_children');
select ok(not has_function_privilege('anon', 'public.my_children()', 'execute'), 'У10: anon не вызывает my_children (default privileges Supabase)');
select ok(not has_function_privilege('public', 'public.my_children()', 'execute'), 'У10: public не вызывает my_children');
select ok((select prosecdef from pg_proc where oid = 'public.my_children()'::regprocedure), 'security definer');
select set_mode('all');
select as_user(tx(21));
select is((select count(*)::int from my_children()), 2, 'У10: после пересоздания authenticated получает список');

select * from finish();
rollback;
