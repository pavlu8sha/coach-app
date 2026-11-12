-- pgTAP: выгрузка своих данных не отдаёт баллы раньше даты старта баллов (R-02, миграция 0067; с 0186 выгрузка берёт points_ledger).
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
-- ручные баллы нового журнала: до и после будущей даты старта
insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points, components) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', '2026-10-01', 'manual', gen_random_uuid(), 'manual', 5, '{"note":"До старта"}'),
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', '2026-11-02', 'manual', gen_random_uuid(), 'manual', 2, '{"note":"После старта"}');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000a1');
select set_points_start('2026-10-15');
reset role;
set constraints all immediate; set constraints all deferred; -- пересчёт журнала в конце транзакции

select as_user('00000000-0000-0000-0000-0000000000b1');
select is(jsonb_array_length(export_my_data() -> 'points'), 1, 'выгрузка не содержит баллы до даты старта');
select is(export_my_data() -> 'points' -> 0 ->> 'date', '2026-11-02', 'в выгрузке остаются только баллы после старта');
select is((select count(*)::int from points_ledger), 1, 'выгрузка совпадает с тем, что родитель видит через приложение');

-- Администратор снимает дату старта: ручной балл, закрытый датой старта, не возвращается (0186, решение владельца 2026-11-12)
select as_user('00000000-0000-0000-0000-0000000000a1');
select set_points_start(null);
reset role;
set constraints all immediate; set constraints all deferred;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(jsonb_array_length(export_my_data() -> 'points'), 1, 'после снятия даты старта закрытый ручной балл в выгрузку не возвращается');

select * from finish();
rollback;
