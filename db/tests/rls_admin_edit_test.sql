-- pgTAP: платежи и цены пишет только администратор; журнал платежей только добавляется.
begin;
create extension if not exists pgtap;
select plan(10);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7201, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7202, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7203, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into payments (player_id, amount, paid_on, method, recorded_by) values ('00000000-0000-0000-0000-00000000d001', 165, '2026-10-05', 'Наличные', '00000000-0000-0000-0000-0000000000a1')$$, 'администратор вносит платёж');
select lives_ok($$insert into payments (player_id, amount, paid_on, method, recorded_by) values ('00000000-0000-0000-0000-00000000d001', -165, '2026-10-05', 'Исправление', '00000000-0000-0000-0000-0000000000a1')$$, 'администратор исправляет записью с минусом');
select throws_ok($$update payments set amount = 1$$, '42501', null, 'платёж нельзя изменить даже администратору');
select throws_ok($$delete from payments$$, '42501', null, 'платёж нельзя удалить даже администратору');
select lives_ok($$insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 170, '2099-01-01')$$, 'администратор добавляет цену');
select lives_ok($$delete from prices where valid_from = '2099-01-01'$$, 'администратор удаляет будущую цену');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into payments (player_id, amount, paid_on) values ('00000000-0000-0000-0000-00000000d001', 1, '2026-10-05')$$, '42501', null, 'тренер не вносит платежи');
select throws_ok($$insert into prices (club_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'subscription', 1, '2099-01-01')$$, '42501', null, 'тренер не меняет цены');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into payments (player_id, amount, paid_on) values ('00000000-0000-0000-0000-00000000d001', 1, '2026-10-05')$$, '42501', null, 'родитель не вносит платежи');
select throws_ok($$insert into prices (club_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'subscription', 1, '2099-01-01')$$, '42501', null, 'родитель не меняет цены');

select * from finish();
rollback;
