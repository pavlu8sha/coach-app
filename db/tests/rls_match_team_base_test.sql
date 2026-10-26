-- pgTAP: команда нового матча записывается без суффикса группы; тренер U10-A правит матч команды «U10».
begin;
create extension if not exists pgtap;
select plan(4);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000c1', 9201, 'Тренер', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U10-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'Ortachala U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1');
insert into rules (club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-00000000c001', 'match_played', 1, 'Участие', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_win', 2, 'Победа', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_best', 3, 'Лучший', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'match_goal', 1, 'Гол', '2026-01-01');
insert into matches (id, club_id, played_on, team, opponent) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U10', 'Старый');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e1', '2026-10-11', 'Олимп', null, null, '[]'::jsonb)$$, 'тренер создаёт матч группы U10-A');
select is((select team from matches where opponent = 'Олимп'), 'U10', 'команда без суффикса');
select lives_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-10-10', 'Старый 2', null, null, '[]'::jsonb)$$, 'матч команды «U10» правится из группы U10-A');
select lives_ok($$select save_match(null, '00000000-0000-0000-0000-0000000000e2', '2026-10-12', 'Локо', null, null, '[]'::jsonb)$$, 'группа без суффикса не меняется');

select * from finish();
rollback;
