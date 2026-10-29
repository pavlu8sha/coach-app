-- pgTAP D-04: повтор player_id в массиве оплаты даёт одну оплату, а не две (event_pay и match_pay).
begin;
create extension if not exists pgtap;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9303, 'Админ', true);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2');
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч1', 50);
insert into tournament_fees (tournament_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 50),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d002', 50);
insert into matches (id, club_id, played_on, team, opponent, kind) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Олимп', 'friendly');
insert into match_fees (match_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 30),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002', 30);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000a1');

select is(event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d001']::uuid[], 20, null, 'Наличные', null), 1, 'event_pay: дубль id считается один раз');
select is((select count(*)::int from tournament_payments where player_id = '00000000-0000-0000-0000-00000000d001'), 1, 'event_pay: одна строка оплаты');
select is((select paid from event_fees('00000000-0000-0000-0000-0000000000aa') where player_id = '00000000-0000-0000-0000-00000000d001'), 20::numeric, 'event_pay: списано 20, а не 40');
select is(event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[], 5, null, 'Наличные', null), 2, 'event_pay: разные id работают как раньше');

select is(match_pay('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d001']::uuid[], 10, null, 'Наличные', null), 1, 'match_pay: дубль id считается один раз');
select is((select paid from match_fees_list('00000000-0000-0000-0000-0000000000f1') where player_id = '00000000-0000-0000-0000-00000000d001'), 10::numeric, 'match_pay: списано 10, а не 20');

select * from finish();
rollback;
