-- pgTAP: отмена запроса на связь и повторная подача.
begin;
create extension if not exists pgtap;
select plan(16);
insert into consent_versions (version) values ('draft-2026-10') on conflict do nothing;

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 4001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 4002, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 4003, 'Родитель Б', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванова Анна');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Родитель А подаёт два запроса; Б подаёт один
select as_user('00000000-0000-0000-0000-0000000000b1');
select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10');
select request_link('00000000-0000-0000-0000-00000000d002', 'draft-2026-10');
select as_user('00000000-0000-0000-0000-0000000000b2');
select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10');

-- Чужой запрос отменить нельзя
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select cancel_link((select id from link_requests where user_id = '00000000-0000-0000-0000-0000000000b1' limit 1))$$, null, null, 'чужие запросы Б не видит и отменить не может');

-- Своё отменить можно, ребёнок снова виден в поиске
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from search_players_for_link('иван')), 0, 'до отмены запрошенные дети скрыты из поиска');
select lives_ok($$select cancel_link((select id from link_requests where player_id = '00000000-0000-0000-0000-00000000d001'))$$, 'родитель отменяет свой неподтверждённый запрос');
select is((select count(*)::int from link_requests), 1, 'отменённый запрос удалён, второй остался');
select is((select count(*)::int from search_players_for_link('иван')), 1, 'после отмены отменённый ребёнок снова виден в поиске (второй всё ещё запрошен)');
select throws_ok($$select cancel_link('00000000-0000-0000-0000-00000000ffff')$$, null, 'request not found or already decided', 'несуществующий запрос отменить нельзя');

-- Решённый запрос отменить нельзя; повтор — только после отказа
select as_user('00000000-0000-0000-0000-0000000000a1');
select decide_link((select id from link_requests where user_id = '00000000-0000-0000-0000-0000000000b2'), true);
select decide_link((select id from link_requests where user_id = '00000000-0000-0000-0000-0000000000b1'), false);

select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select cancel_link((select id from link_requests limit 1))$$, null, 'request not found or already decided', 'подтверждённый запрос отменить нельзя');
select throws_ok($$select retry_link((select id from link_requests limit 1))$$, null, 'request not found or not rejected', 'повторить можно только отклонённый запрос');
select is((select count(*)::int from player_guardians), 1, 'подтверждённая связь не затронута');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select retry_link((select id from link_requests limit 1))$$, null, 'retry too soon', 'сразу после отказа повторить нельзя');
select throws_ok($$select cancel_link((select id from link_requests limit 1))$$, null, 'request not found or already decided', 'отклонённый запрос не отменяется, а остаётся в истории');

-- Проходят сутки после отказа
reset role;
update link_requests set decided_at = now() - interval '2 days' where status = 'rejected';

select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select retry_link((select id from link_requests where status = 'rejected'))$$, null, null, 'чужой отклонённый запрос повторить нельзя');

select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select retry_link((select id from link_requests where status = 'rejected'))$$, 'через сутки отклонённый запрос подаётся снова');
select is((select status from link_requests), 'pending', 'запрос снова ждёт подтверждения');
select is((select count(*)::int from link_requests where decided_at is not null or decided_by is not null), 0, 'отметки решения сброшены');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from link_requests where status = 'pending'), 1, 'администратор снова видит запрос среди ожидающих');

select * from finish();
rollback;
