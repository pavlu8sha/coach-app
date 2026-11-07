-- pgTAP (0153): гость матча чемпионата (играл, но не в заявке события) получает разовый взнос за матч; игрок заявки и товарищеский матч нет.
begin;
create extension if not exists pgtap;
select plan(9);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9201, 'Админ', true);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'В заявке'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гость');
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч2', 50);
insert into tournament_fees (tournament_id, player_id, amount) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 50);
insert into matches (id, club_id, played_on, team, opponent, kind, tournament_id) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-11', 'U9', 'Звезда', 'game', '00000000-0000-0000-0000-0000000000aa');
insert into matches (id, club_id, played_on, team, opponent, kind) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Олимп', 'friendly');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '2026-10-11', 'Звезда', null, null,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true},{"player_id":"00000000-0000-0000-0000-00000000d002","played":true}]'::jsonb)$$, 'матч чемпионата сохраняется');
select is((select amount from match_fees where match_id = '00000000-0000-0000-0000-0000000000f2' and player_id = '00000000-0000-0000-0000-00000000d002'), 25.00, 'гость получает 25 ₾ по умолчанию');
select is((select count(*)::int from match_fees where match_id = '00000000-0000-0000-0000-0000000000f2' and player_id = '00000000-0000-0000-0000-00000000d001'), 0, 'игроку заявки взнос за матч не назначается');
select is((select count(*)::int from tournament_fees where tournament_id = '00000000-0000-0000-0000-0000000000aa'), 1, 'заявка события не меняется');

select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '2026-10-11', 'Звезда', null, null,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true},{"player_id":"00000000-0000-0000-0000-00000000d002","played":true}]'::jsonb)$$, 'повторное сохранение не дублирует');
select is((select count(*)::int from match_fees where match_id = '00000000-0000-0000-0000-0000000000f2'), 1, 'взнос гостя один');

reset role;
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'matches.guestFee', '30', '');
select is(guest_match_fee('00000000-0000-0000-0000-00000000c001'), 30::numeric, 'сумма берётся из настройки клуба');

select set_config('role', 'authenticated', true);
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '2026-10-11', 'Звезда', null, null,
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","played":true},{"player_id":"00000000-0000-0000-0000-00000000d002","played":false}]'::jsonb)$$, 'гость снят с игры');
select is((select count(*)::int from match_fees where match_id = '00000000-0000-0000-0000-0000000000f2'), 1, 'взнос другой суммы (25) остаётся: снимаем только строку по текущей настройке');

select * from finish();
rollback;
