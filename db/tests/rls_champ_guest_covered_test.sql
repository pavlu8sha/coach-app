-- pgTAP (0155): гость матча чемпионата не платит взнос, если заявлен в том же чемпионате за другую команду; заявка в другом чемпионате не освобождает.
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Заявлен в другой команде'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Заявлен в другом чемпионате'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Нигде не заявлен');
-- U9-B Ch2 (матч), U9-A Ch2 (тот же чемпионат другой команды), U9-B Ch1 (другой чемпионат)
insert into tournaments (id, club_id, team, kind, name, fee) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'championship', 'Championship 2', 200),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'championship', 'Championship 2', 200),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'championship', 'Championship 1', 200);
insert into tournament_fees (tournament_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000d001', 200),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000d002', 200);
insert into matches (id, club_id, played_on, team, opponent, kind, tournament_id) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-11', 'U9-B', 'Звезда', 'game', '00000000-0000-0000-0000-0000000000a1');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '2026-10-11', 'Звезда', null, null,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true},{"player_id":"00000000-0000-0000-0000-00000000d002","played":true},{"player_id":"00000000-0000-0000-0000-00000000d003","played":true}]'::jsonb)$$, 'матч сохраняется');
select is((select count(*)::int from match_fees where player_id = '00000000-0000-0000-0000-00000000d001'), 0, 'заявлен в Championship 2 другой команды: взноса за матч нет');
select is((select amount from match_fees where player_id = '00000000-0000-0000-0000-00000000d002'), 25.00, 'заявка в Championship 1 не освобождает от взноса');
select is((select amount from match_fees where player_id = '00000000-0000-0000-0000-00000000d003'), 25.00, 'нигде не заявленный платит');
select is((select array_agg(player_id order by player_id) from champ_guest_ids('00000000-0000-0000-0000-0000000000f2')),
  array['00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d003']::uuid[], 'champ_guest_ids возвращает только тех, кому положен взнос');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c9', 'role', 'authenticated')::text, true);
select throws_ok($$select * from champ_guest_ids('00000000-0000-0000-0000-0000000000f2')$$, '42501', null, 'не администратору champ_guest_ids закрыта');
select throws_ok($$select event_player_covered('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001')$$, '42501', null, 'служебная функция закрыта для пользователей');

select * from finish();
rollback;
