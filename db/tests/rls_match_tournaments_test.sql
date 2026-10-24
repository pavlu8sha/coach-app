-- pgTAP: название турнира для видимых матчей; взносы и сама таблица турниров остаются закрытыми.
begin;
create extension if not exists pgtap;
select plan(5);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 7002, 'Родитель U9', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into tournaments (id, club_id, team, kind, name, fee) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Чемпионат 1', 50);
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against, tournament_id, kind) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'А', 3, 1, '00000000-0000-0000-0000-0000000000aa', 'game'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-11', 'U11', 'Б', 1, 0, '00000000-0000-0000-0000-0000000000aa', 'game');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from tournaments), 0, 'родитель не читает таблицу турниров');
select is((select count(*)::int from match_tournaments()), 1, 'родитель видит турнир только для видимого матча (чужая команда не попадает)');
select is((select tournament_name from match_tournaments()), 'Чемпионат 1', 'название турнира доступно');
select is((select tournament_kind from match_tournaments()), 'championship', 'тип турнира доступен');
select throws_ok($$select fee from tournament_label('00000000-0000-0000-0000-0000000000aa')$$, '42703', null, 'взнос через функцию не отдаётся');

select * from finish();
rollback;
