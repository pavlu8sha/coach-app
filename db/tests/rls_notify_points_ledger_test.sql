-- pgTAP: уведомления родителю о баллах из нового журнала (0130). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(11);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 9601, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());

create or replace function n_count() returns int language sql as $$
  select count(*)::int from notifications where kind = 'bonus' and user_id = '00000000-0000-0000-0000-0000000000b1' $$;

-- ручной балл
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, components)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', tbilisi_day(now()), 'manual', gen_random_uuid(), 'manual', 2, '{"note":"Старание"}');
select is(n_count(), 1, 'ручной балл уведомляет родителя');
select is((select text from notifications where kind = 'bonus' and text like 'Аня: +2%'), 'Аня: +2 — Старание', 'текст ручного балла');

-- матч
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, components)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', tbilisi_day(now()), 'match', gen_random_uuid(), 'match', 3, '{"model":"rating","rating":3,"best":false,"best_bonus":0}');
select is(n_count(), 2, 'балл за матч уведомляет родителя');
select matches((select text from notifications where kind = 'bonus' and text like 'Аня: +3%'), '^Аня: \+3 — матч \d\d\.\d\d, оценка 3$', 'текст балла за матч: оценка тренера, без победы и голов');
-- лучший игрок и повторное начисление того же матча (смена оценки): сообщение один раз
create temp table src as select gen_random_uuid() as id;
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, components)
  select '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', tbilisi_day(now()), 'match', id, 'match', 6, '{"model":"rating","rating":5,"best":true,"best_bonus":1}' from src;
select matches((select text from notifications where kind = 'bonus' and text like 'Аня: +6%'), '^Аня: \+6 — матч \d\d\.\d\d, оценка 5, лучший игрок матча$', 'текст: оценка и лучший игрок');
select is(n_count(), 3, 'уведомления: ручной, два матча');
select is(points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'match', (select id from src), jsonb_build_array(jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d001', 'group_id', null, 'event_date', tbilisi_day(now()), 'reason_code', 'match', 'points', 4, 'components', '{"model":"rating","rating":4,"best":false,"best_bonus":0}'::jsonb)), 'match_changed'), 1, 'смена оценки: одна замена строки');
select is(n_count(), 3, 'смена оценки не шлёт повторное уведомление');

-- не уведомляют: тренировка, исправление, старая дата, ноль
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', tbilisi_day(now()), 'group_session', gen_random_uuid(), 'attended', 1);
select is(n_count(), 3, 'тренировка не уведомляет');
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, components)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', tbilisi_day(now()) - 30, 'manual', gen_random_uuid(), 'manual', 2, '{"note":"Давно"}');
select is(n_count(), 3, 'старая дата не уведомляет');
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, supersedes_id)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', tbilisi_day(now()), 'manual', gen_random_uuid(), 'manual', 2, (select id from points_ledger limit 1));
select is(n_count(), 3, 'исправление не уведомляет');

select * from finish();
rollback;
