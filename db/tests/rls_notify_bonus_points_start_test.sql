-- pgTAP: уведомление о ручных баллах не создаётся для баллов раньше даты старта (R-16, миграция 0068).
begin;
create extension if not exists pgtap;
select plan(3);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 9501, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());
insert into rules (id, club_id, code, points, explanation, active_from) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000c001', 'x', 1, 'x', '2026-01-01');
insert into club_settings (club_id, key, value, scope, updated_at) values ('00000000-0000-0000-0000-00000000c001', 'points_start', '2026-10-01', '', current_date);

-- Ручной балл тренера до старта: родитель не уведомляется, балл скрыт
insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 3, 'coach', '2026-09-01', 'До старта');
select is((select count(*)::int from notifications where kind = 'bonus' and user_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'балл до даты старта не уведомляет родителя');

-- Балл после старта уведомляет как и раньше
insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 2, 'coach', '2026-10-10', 'После старта');
select is((select count(*)::int from notifications where kind = 'bonus' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'балл после даты старта уведомляет родителя');
select is((select text from notifications where kind = 'bonus' and user_id = '00000000-0000-0000-0000-0000000000b1'), 'Аня: +2 — После старта', 'текст уведомления без скрытого балла');

select * from finish();
rollback;
