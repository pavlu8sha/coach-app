-- pgTAP: выбор роли при первом входе.
begin;
create extension if not exists pgtap;
select plan(21);

insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 5001, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 5002, 'Родитель Б', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b1'), null, 'по умолчанию роль не выбрана');
select set_my_role('coach');
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b1'), 'coach', 'пользователь выбирает роль');
select set_my_role('guest');
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b1'), 'guest', 'роль можно сменить');
select throws_ok($$select set_my_role('admin')$$, '22023', 'bad role', 'нельзя выбрать admin');
update users set chosen_role = 'parent' where id = '00000000-0000-0000-0000-0000000000b1';
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b1'), 'guest', 'прямая запись в users закрыта (политики на update нет)');
select is((select count(*)::int from users where id = '00000000-0000-0000-0000-0000000000b2' and chosen_role is not null), 0, 'чужая роль не меняется');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select is_admin from users where id = '00000000-0000-0000-0000-0000000000b2'), false, 'выбор роли не даёт прав администратора');

-- #704, условия 2–6 (docs/ROLE_SELECT_ACCEPTANCE.md)
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select set_my_role(null)$$, '22023', 'bad role', 'NULL отклоняется явно');
select throws_ok($$select set_my_role('')$$, '22023', 'bad role', 'пустая роль отклоняется');
select throws_ok($$select set_my_role('Parent')$$, '22023', 'bad role', 'регистр важен: «Parent» отклоняется');
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b1'), 'guest', 'после отказов роль не изменилась');
select set_my_role('parent');
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b1'), 'parent', 'родитель сохраняется и читается обратно');

-- профиля нет: не ложный успех, ничего не создаётся и не меняется
select as_user('00000000-0000-0000-0000-0000000000c9');
select throws_ok($$select set_my_role('parent')$$, 'P0002', 'profile_missing', 'нет строки users: явная ошибка, а не успех');
reset role;
select is((select count(*)::int from users where id = '00000000-0000-0000-0000-0000000000c9'), 0, 'профиль из роли не создаётся');
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b1'), 'parent', 'чужая строка не затронута отсутствием профиля');
select is((select chosen_role from users where id = '00000000-0000-0000-0000-0000000000b2'), null, 'вторая строка не затронута');

-- без авторизации
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select set_my_role('parent')$$, '42501', 'forbidden', 'без sub: forbidden');

-- права на базе с привилегиями по умолчанию Supabase: функция создаётся заново, как после чистой установки, grant anon не должен остаться
reset role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function set_my_role(text);
\i db/migrations/0212_set_my_role_confirm.sql
select ok(has_function_privilege('authenticated', 'public.set_my_role(text)', 'execute'), 'authenticated вызывает set_my_role');
select ok(not has_function_privilege('anon', 'public.set_my_role(text)', 'execute'), 'anon не вызывает set_my_role (default privileges Supabase)');
select ok(not has_function_privilege('public', 'public.set_my_role(text)', 'execute'), 'public не вызывает set_my_role');
select ok((select prosecdef from pg_proc where oid = 'public.set_my_role(text)'::regprocedure), 'функция остаётся security definer');

select * from finish();
rollback;
