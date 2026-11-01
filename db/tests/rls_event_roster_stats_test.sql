-- pgTAP: состав события = заявка (0094), игравший только в матче в него не входит; статистика матчей фильтруется по виду (0060).
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'С взносом', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Ушедший игрок', 'inactive');
insert into tournaments (id, club_id, team, kind, name, fee, starts_on) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Чемпионат 1', 50, '2026-10-01');
insert into tournament_fees (tournament_id, player_id, amount) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 50);
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against, kind, tournament_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000c001', '2026-10-02', 'U9', 'Олимп', 3, 1, 'game', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000c001', '2026-10-03', 'U9', 'Друзья', 1, 2, 'friendly', null);
insert into match_players (match_id, player_id, played, goals) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d002', true, 2),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d001', true, 0);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000a1');

select is((select count(*)::int from event_roster('00000000-0000-0000-0000-0000000000f1')), 1, 'в составе события только заявленный (0094)');
select ok(not exists (select 1 from event_roster('00000000-0000-0000-0000-0000000000f1') where full_name = 'Ушедший игрок'), 'игравший только в матче не попадает в состав события');
select is((select players from event_list() where id = '00000000-0000-0000-0000-0000000000f1'), 1, 'счётчик event_list равен размеру заявки (0094)');
select is((select played from match_players where match_id = '00000000-0000-0000-0000-0000000000b1' and player_id = '00000000-0000-0000-0000-00000000d002'), true, 'запись в составе матча сохраняется');
select is((select sum(games)::int from match_stats('2026-10-01', '2026-10-31') where kind = 'team'), 2, 'без фильтра видны все игры');
select is((select sum(games)::int from match_stats('2026-10-01', '2026-10-31', 'championship') where kind = 'team'), 1, 'фильтр «чемпионат»');
select is((select sum(games)::int from match_stats('2026-10-01', '2026-10-31', 'friendly') where kind = 'team'), 1, 'фильтр «товарищеские»');
select throws_ok($$select * from match_stats('2026-10-01', '2026-10-31', 'bad')$$, '22023', 'bad category', 'неизвестный вид отклоняется');

select * from finish();
rollback;
