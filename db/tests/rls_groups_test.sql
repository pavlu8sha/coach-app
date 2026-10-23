-- pgTAP: родитель видит группу своего ребёнка и только её. Запуск: после миграций 0001–0013:
--   psql -f db/tests/setup_local.sql ... -f db/tests/rls_groups_test.sql
begin;
create extension if not exists pgtap;
select plan(5);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 2001, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 2002, 'Родитель Б', false),
  ('00000000-0000-0000-0000-0000000000b3', 2003, 'Без детей', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Ребёнок Б');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select results_eq($$select name from groups$$, $$values ('U9')$$, 'родитель A видит только группу своего ребёнка');

select as_user('00000000-0000-0000-0000-0000000000b2');
select results_eq($$select name from groups$$, $$values ('U11')$$, 'родитель Б видит только свою группу, не группу ребёнка А');

select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from groups), 0, 'пользователь без детей групп не видит');

-- согласие отозвано — доступ к группе закрывается
reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b1';
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from groups), 0, 'после отзыва согласия группа не видна');

-- родитель не может менять группы (политики на запись нет — затронуто 0 строк)
select as_user('00000000-0000-0000-0000-0000000000b2');
update groups set name = 'X';
reset role;
select is((select count(*)::int from groups where name = 'X'), 0, 'родитель не может переименовать группу');

select * from finish();
rollback;
