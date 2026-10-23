-- pgTAP: выбор роли при первом входе.
begin;
create extension if not exists pgtap;
select plan(7);

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

select * from finish();
rollback;
