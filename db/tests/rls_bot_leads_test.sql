-- pgTAP: заявки из бота (0039).
begin;
create extension if not exists pgtap;
select plan(13);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 8802, 'Родитель', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated, service_role;

-- от имени бота (служебная роль)
set local role service_role;
insert into lead_drafts (telegram_id, step) values (555, 'confirm'), (556, 'child');
update lead_drafts set updated_at = now() - interval '3 days' where telegram_id = 556;
insert into ids select 'l1', lead_submit(555, 'Мама', 'mama', 'Иван Петров', extract(year from now())::int - 8, '+995 555 12 34 56');
reset role;
select is((select status from trials where id = (select id from ids where k = 'l1')), 'new', 'заявка создана со статусом new');
select is((select count(*)::int from lead_drafts), 0, 'черновик удалён (и просроченный чужой тоже)');
select is((select count(*)::int from notifications where kind = 'lead'), 1, 'администратору поставлено уведомление');
set local role service_role;
select is(lead_submit(555, 'Мама', 'mama', 'иван петров', extract(year from now())::int - 8, '+995 555 12 34 56'), (select id from ids where k = 'l1'), 'повторная отправка тех же данных новой заявки не создаёт');
select throws_ok($$select lead_submit(555, 'Мама', null, 'Плохой', 1990, '+995 555 12 34 56')$$, '22023', 'bad year', 'год рождения вне диапазона отклоняется');
select throws_ok($$select lead_submit(555, 'Мама', null, 'Плохой', extract(year from now())::int - 8, 'abc')$$, '22023', 'bad phone', 'неверный телефон отклоняется');
select lead_submit(555, 'Мама', null, 'Второй', extract(year from now())::int - 9, '+995 555 12 34 56');
select lead_submit(555, 'Мама', null, 'Третий', extract(year from now())::int - 10, '+995 555 12 34 56');
select throws_ok($$select lead_submit(555, 'Мама', null, 'Четвёртый', extract(year from now())::int - 7, '+995 555 12 34 56')$$, '54000', 'too many leads', 'больше трёх заявок в сутки с одного аккаунта нельзя');

reset role;
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select lead_submit(1, 'x', null, 'Игрок', extract(year from now())::int - 8, '+995 555 12 34 56')$$, '42501', null, 'родитель не вызывает приём заявки');
select throws_ok($$select count(*) from lead_drafts$$, '42501', null, 'черновики родителю недоступны');
select is((select count(*)::int from trials), 0, 'родитель заявок не видит');
select throws_ok($$select lead_set_status('00000000-0000-0000-0000-000000000000', 'contacted', null)$$, '42501', 'forbidden', 'родитель не меняет статус');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from trials), 3, 'администратор видит заявки');
select lead_set_status((select id from ids where k = 'l1'), 'contacted', 'Позвонили');
select is((select note from trials where id = (select id from ids where k = 'l1')), 'Позвонили', 'статус и заметка сохранены');

select * from finish();
rollback;
