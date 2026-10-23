-- pgTAP: отзыв согласия, выгрузка данных, запросы на удаление.
begin;
create extension if not exists pgtap;
select plan(27);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 4101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 4102, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 4103, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 4104, 'Родитель Б', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ребёнок Б');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into link_requests (user_id, player_id, status, consent_version) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'approved', 'v1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000d002', 'approved', 'v1');
insert into rules (id, club_id, code, points, explanation, active_from) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000c001', 'x', 1, 'x', '2026-01-01');
insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 3, 'coach', '2026-10-20', 'Отлично'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000f0', 9, 'coach', '2026-10-20', 'Чужой балл');
insert into payments (player_id, amount, paid_on) values
  ('00000000-0000-0000-0000-00000000d001', 100, '2026-10-01'),
  ('00000000-0000-0000-0000-00000000d002', 200, '2026-10-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Выгрузка
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select export_my_data()->'account'->>'display_name'), 'Родитель А', 'в выгрузке — аккаунт родителя');
select is((select jsonb_array_length(export_my_data()->'children')), 1, 'в выгрузке один ребёнок');
select is((select export_my_data()->'points'->0->>'explanation'), 'Отлично', 'баллы своего ребёнка в выгрузке');
select is((select jsonb_array_length(export_my_data()->'points')), 1, 'чужие баллы в выгрузку не попадают');
select is((select (export_my_data()->'payments'->0->>'amount')::numeric), 100::numeric, 'платежи только своего ребёнка');
select is((select jsonb_array_length(export_my_data()->'payments')), 1, 'чужие платежи не попадают');

-- Отзыв согласия
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select revoke_consent('00000000-0000-0000-0000-00000000d001')$$, null, 'link not found', 'нельзя отозвать чужое согласие');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select revoke_consent('00000000-0000-0000-0000-00000000d001')$$, 'родитель отзывает согласие по своему ребёнку');
select is((select count(*)::int from players), 0, 'после отзыва ребёнок и его данные родителю недоступны');
select is((select count(*)::int from point_events), 0, 'баллы ребёнка после отзыва недоступны');
select is((select count(*)::int from link_requests), 0, 'прежний запрос на связь удалён (можно подать новый)');
select throws_ok($$select revoke_consent('00000000-0000-0000-0000-00000000d001')$$, null, 'link not found', 'повторный отзыв отклоняется');
select is((select jsonb_array_length(export_my_data()->'points')), 0, 'после отзыва данные ребёнка в выгрузку не попадают');
select is((select (export_my_data()->'children'->0->>'consent_revoked_at') is not null), true, 'но факт отзыва в выгрузке есть');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from audit_log where action = 'revoke_consent'), 1, 'отзыв записан в аудит');

-- Запрос на удаление
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select request_data_deletion()$$, 'родитель подаёт запрос на удаление данных');
select throws_ok($$select request_data_deletion()$$, null, 'request already open', 'второй открытый запрос нельзя');
select is((select count(*)::int from data_requests), 1, 'родитель видит свой запрос');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from data_requests), 0, 'чужие запросы не видны');
select throws_ok($$select erase_parent((select id from data_requests limit 1))$$, '42501', 'forbidden', 'родитель не выполняет удаление');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select reject_data_request('00000000-0000-0000-0000-0000000000f9', 'x')$$, '42501', 'forbidden', 'тренер не обрабатывает запросы');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from data_requests where status = 'open'), 1, 'администратор видит открытый запрос');
select lives_ok($$select erase_parent((select id from data_requests where status = 'open'))$$, 'администратор выполняет удаление данных родителя');
select is((select count(*)::int from player_guardians where user_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'связи родителя с детьми удалены');
select is((select display_name from users where id = '00000000-0000-0000-0000-0000000000b2'), null, 'имя в профиле очищено');
select is((select count(*)::int from players where id = '00000000-0000-0000-0000-00000000d002'), 1, 'данные ребёнка (клубные) остались');
select throws_ok($$select erase_parent((select id from data_requests limit 1))$$, null, 'request not found or already handled', 'выполненный запрос повторно не обрабатывается');

select * from finish();
rollback;
