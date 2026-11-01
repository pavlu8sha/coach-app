-- pgTAP: поиск ребёнка для привязки идёт в клубе пользователя (миграция 0089, issue #299).
begin;
create extension if not exists pgtap;
select plan(4);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А'), ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000b1', 9301, 'Родитель А', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000b2', 9302, 'Родитель Б', false, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000b3', 9303, 'Без клуба', false, null);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Иванов Пётр', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c002', 'Иванченко Олег', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select string_agg(full_name, ',') from search_players_for_link('Иван')), 'Иванов Пётр', 'родитель клуба А видит только детей клуба А');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select string_agg(full_name, ',') from search_players_for_link('Иван')), 'Иванченко Олег', 'родитель клуба Б видит только детей клуба Б');
select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select string_agg(full_name, ',') from search_players_for_link('Иван')), 'Иванов Пётр', 'без клуба: первый клуб по id, как раньше');
update users set club_id = '00000000-0000-0000-0000-00000000c002' where id = '00000000-0000-0000-0000-0000000000b3';
select is((select club_id from users where id = '00000000-0000-0000-0000-0000000000b3'), null::uuid, 'клуб пользователь сам менять не может (политики на update нет)');

select * from finish();
rollback;
