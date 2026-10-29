-- pgTAP: выгрузка своих данных не отдаёт баллы раньше даты старта баллов (R-02, миграция 0067).
begin;
create extension if not exists pgtap;
select plan(4);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9402, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
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

select as_user('00000000-0000-0000-0000-0000000000a1');
select set_points_start('2026-10-15');

select as_user('00000000-0000-0000-0000-0000000000b1');
select is(jsonb_array_length(export_my_data() -> 'points'), 1, 'выгрузка не содержит баллы до даты старта');
select is(export_my_data() -> 'points' -> 0 ->> 'date', '2026-11-02', 'в выгрузке остаются только баллы после старта');
select is((select count(*)::int from point_events), 1, 'выгрузка совпадает с тем, что родитель видит через приложение');

-- Администратор снимает дату старта: история снова доступна целиком
select as_user('00000000-0000-0000-0000-0000000000a1');
select set_points_start(null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(jsonb_array_length(export_my_data() -> 'points'), 2, 'после снятия даты старта выгрузка содержит всю историю');

select * from finish();
rollback;
