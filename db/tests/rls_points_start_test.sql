-- pgTAP: старт подсчёта баллов (0040).
begin;
create extension if not exists pgtap;
select plan(11);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8902, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8903, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());
insert into rules (id, club_id, code, points, explanation, active_from) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000c001', 'x', 1, 'x', '2026-01-01');
insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 5, 'session', '2026-10-01', 'До старта'),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 2, 'session', '2026-11-02', 'После старта');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from point_events), 2, 'пока дата старта не задана, родитель видит все баллы');
select throws_ok($$select set_points_start('2026-11-01')$$, '42501', 'forbidden', 'родитель не задаёт дату старта');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select set_points_start('2026-11-01')$$, '42501', 'forbidden', 'тренер не задаёт дату старта');

select as_user('00000000-0000-0000-0000-0000000000a1');
select set_points_start('2026-11-01');
select is((select count(*)::int from point_events), 1, 'администратор после старта видит только баллы с даты старта');
select is((select total_points from group_rating('00000000-0000-0000-0000-0000000000e1')), 2::bigint, 'рейтинг группы считается с даты старта');

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select array_agg(points) from point_events), array[2], 'родитель видит только баллы с даты старта');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from point_events), 1, 'тренер видит только баллы с даты старта');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is(points_start(), '2026-11-01'::date, 'дата старта читается');
select set_points_start('2026-11-02');
select is((select count(*)::int from point_events), 1, 'в день старта баллы включены');
select set_points_start(null);
select is((select count(*)::int from point_events), 2, 'после сброса даты видна вся история');
select is(points_start(), null::date, 'дата сброшена');

select * from finish();
rollback;
