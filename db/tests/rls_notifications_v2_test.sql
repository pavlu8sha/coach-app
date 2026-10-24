-- pgTAP: уведомления, часть 2 — назначение группы тренеру, оплата и ручные баллы родителю.
begin;
create extension if not exists pgtap;
select plan(9);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin, notifications_enabled) values
  ('00000000-0000-0000-0000-0000000000a1', 5301, 'Админ', true, true),
  ('00000000-0000-0000-0000-0000000000c1', 5302, 'Тренер', false, true),
  ('00000000-0000-0000-0000-0000000000b1', 5303, 'Родитель А', false, true),
  ('00000000-0000-0000-0000-0000000000b2', 5304, 'Родитель Б (согласие отозвано)', false, true),
  ('00000000-0000-0000-0000-0000000000b3', 5305, 'Родитель В (без уведомлений)', false, false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now(), null),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 'v1', now(), now()),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b3', 'v1', now(), null);
insert into rules (id, club_id, code, points, explanation, active_from) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000c001', 'x', 1, 'x', '2026-01-01');

insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
select is((select text from notifications where user_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'coach_assigned'),
  E'Вам назначена группа U9.\nОткройте приложение: вкладки «Занятия», «Матчи» и «Группа».', 'тренеру пришло уведомление о назначении группы');

insert into payments (player_id, amount, paid_on) values ('00000000-0000-0000-0000-00000000d001', 120.50, '2026-10-01');
select is((select text from notifications where kind = 'payment' and user_id = '00000000-0000-0000-0000-0000000000b1'),
  'Получена оплата 120.5 ₾ за Иванов Пётр. Спасибо!', 'родителю пришло сообщение об оплате');
insert into payments (player_id, amount, paid_on) values ('00000000-0000-0000-0000-00000000d001', 100, '2026-10-02');
select ok(exists (select 1 from notifications where kind = 'payment' and text like 'Получена оплата 100 ₾%'), 'круглая сумма без нулей после точки');
select is((select count(*)::int from notifications where kind = 'payment' and user_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'при отозванном согласии оплата не уведомляется');
select is((select count(*)::int from notifications where kind = 'payment' and user_id = '00000000-0000-0000-0000-0000000000b3'), 0, 'при выключенных уведомлениях ничего не ставится в очередь');
insert into payments (player_id, amount, paid_on) values ('00000000-0000-0000-0000-00000000d001', -50, '2026-10-03');
select is((select count(*)::int from notifications where kind = 'payment'), 2, 'исправление с минусом не уведомляется');

insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 3, 'coach', '2026-10-20', 'Отличная игра');
select is((select text from notifications where kind = 'bonus'), 'Иванов Пётр: +3 — Отличная игра', 'ручные баллы уведомляют родителя');
insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 2, 'match', '2026-10-21', 'Победа');
select is((select count(*)::int from notifications where kind = 'bonus'), 1, 'автобаллы за матч не уведомляются');

select ok(not has_function_privilege('authenticated', 'enqueue_to_guardians(uuid,text,text)', 'execute'), 'служебная функция закрыта');
select * from finish();
rollback;
