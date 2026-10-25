-- pgTAP: заявка на пробную из приложения (0044).
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 8902, 'Родитель', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select lead_submit_app('Мама', 'Иван Петров', extract(year from now())::int - 8, '+995 555 12 34 56', null, false)$$, '22023', 'consent required', 'без согласия заявку не принять');
insert into ids select 'l1', lead_submit_app('Мама', 'Иван Петров', extract(year from now())::int - 8, '+995 555 12 34 56', 'Isani, четверг', true);
reset role;
select is((select source from trials where id = (select id from ids where k = 'l1')), 'app', 'источник — приложение');
select is((select note from trials where id = (select id from ids where k = 'l1')), 'Isani, четверг', 'пожелание сохранено');
select is((select telegram_id from trials where id = (select id from ids where k = 'l1')), 8902::bigint, 'заявка привязана к аккаунту');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(lead_submit_app('Мама', 'иван петров', extract(year from now())::int - 8, '+995 555 12 34 56', null, true), (select id from ids where k = 'l1'), 'повтор той же заявки новой не создаёт');
select throws_ok($$select lead_submit_app('Мама', 'Плохой', 1990, '+995 555 12 34 56', null, true)$$, '22023', 'bad year', 'год вне диапазона отклоняется');
select is((select count(*)::int from trials), 0, 'родитель заявок не видит (политика только для администратора)');

reset role;
select as_user(null);
select throws_ok($$select lead_submit_app('Мама', 'Игрок', extract(year from now())::int - 8, '+995 555 12 34 56', null, true)$$, '28000', 'not authenticated', 'без входа заявку не принять');

select * from finish();
rollback;
