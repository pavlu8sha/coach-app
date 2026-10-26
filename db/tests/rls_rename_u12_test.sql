-- pgTAP: миграция 0049 переименовывает команду матча U12 → Ortachala U12 и только её, повторный запуск безопасен.
begin;
create extension if not exists pgtap;
select plan(5);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Клуб без группы');
insert into groups (club_id, name) values ('00000000-0000-0000-0000-00000000c001', 'Ortachala U12');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-06-14', 'U12', 'Newton'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-01', 'U9', 'Соперник'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000c002', '2026-06-15', 'U12', 'Другой клуб');

\i db/migrations/0049_rename_u12_match_team.sql

select is((select team from matches where id = '00000000-0000-0000-0000-0000000000f1'), 'Ortachala U12', 'U12 переименована в Ortachala U12');
select is((select team from matches where id = '00000000-0000-0000-0000-0000000000f2'), 'U9', 'U9 не меняется');
select is((select team from matches where id = '00000000-0000-0000-0000-0000000000f3'), 'U12', 'без группы Ortachala U12 в клубе матч не меняется');

\i db/migrations/0049_rename_u12_match_team.sql
select is((select count(*)::int from matches where team = 'Ortachala U12'), 1, 'повторный запуск ничего не меняет');
select is((select count(*)::int from matches), 3, 'строки не добавлены и не удалены');

select * from finish();
rollback;
