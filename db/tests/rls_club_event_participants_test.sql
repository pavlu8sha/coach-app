-- pgTAP: раздел «Мероприятия», этап 2 (0204, Issue #677, docs/CLUB_EVENTS_ACCEPTANCE.md v6): участники, лимит, дедлайн, индивидуальные цены,
-- массовое добавление группы, права, клубная изоляция. Тесты написаны до миграции: на master без 0204 они красные.
-- Права проверяются на базе с привилегиями по умолчанию Supabase: объекты раздела пересоздаются при включённых умолчаниях.
begin;
create extension if not exists pgtap;
select plan(218);

drop table if exists club_event_participant_log, club_event_participants, club_event_price_log, club_event_log, club_event_groups, club_events cascade;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0202_club_events.sql
\i db/migrations/0204_club_event_participants.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000a2', 8802, 'Админ 2', true),
  ('00000000-0000-0000-0000-0000000000c1', 8803, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8804, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000d1', 8805, 'Локальный админ', false),
  ('00000000-0000-0000-0000-0000000000e0', 8806, 'Без прав', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U13-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-000000000d03', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active'),
  ('00000000-0000-0000-0000-000000000d04', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гоша', 'active'),
  ('00000000-0000-0000-0000-000000000d05', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Дима', 'paused'),
  ('00000000-0000-0000-0000-000000000d06', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Егор', 'inactive'),
  ('00000000-0000-0000-0000-000000000d07', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Жора', 'active'),
  ('00000000-0000-0000-0000-000000000d08', '00000000-0000-0000-0000-00000000c001', null, 'Зина без группы', 'active');
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- вспомогательные поиски id (только для тестов)
create or replace function t_ev(n text) returns uuid language sql stable security definer set search_path = public as $$ select id from club_events where name = n $$;
create or replace function t_pt(n text, p uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from club_event_participants where event_id = (select id from club_events where name = n) and player_id = p $$;
create or replace function t_cnt(n text, s text) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from club_event_participants where event_id = (select id from club_events where name = n) and status = s $$;

-- ===== ACL4/ACL3/ACL5. права на объекты (при умолчаниях Supabase) =====
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'club\_event\_%'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'ACL4 ни одна функция club_event_* не доступна anon и public');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('club_event_seat_guard', 'club_event_assert_admin', 'club_event_guard', 'club_event_log_add', 'club_event_isolation_ok')
              and has_function_privilege('authenticated', p.oid, 'execute')), 0, 'ACL4 служебные функции недоступны authenticated');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('club_event_participant_add', 'club_event_group_preview', 'club_event_group_add', 'club_event_participant_cancel',
              'club_event_participant_restore', 'club_event_participant_set_price', 'club_event_participants_list', 'club_event_participant_history')
              and has_function_privilege('authenticated', p.oid, 'execute')), 8, 'ACL4 восемь функций участников доступны authenticated');
select is((select count(*)::int from (values ('club_event_participants'), ('club_event_participant_log')) t(n)
            where has_table_privilege('anon', 'public.' || n, 'select') or has_table_privilege('authenticated', 'public.' || n, 'insert')
               or has_table_privilege('authenticated', 'public.' || n, 'update') or has_table_privilege('authenticated', 'public.' || n, 'delete')
               or has_table_privilege('service_role', 'public.' || n, 'insert') or has_table_privilege('service_role', 'public.' || n, 'update')
               or has_table_privilege('service_role', 'public.' || n, 'delete')), 0, 'ACL3/ACL5 таблицы участников: anon без чтения, authenticated и service_role без записи');
select ok(has_table_privilege('authenticated', 'public.club_event_participants', 'select') and has_table_privilege('service_role', 'public.club_event_participants', 'select'), 'ACL2/ACL5 чтение выдано authenticated (через RLS) и service_role');
select is((select count(*)::int from pg_proc where proname in ('club_event_participant_add', 'club_event_group_add', 'club_event_group_preview', 'club_event_participant_cancel',
  'club_event_participant_restore', 'club_event_participant_set_price', 'club_event_participants_list', 'club_event_participant_history') and prosrc not like '%club_event_assert_admin%'), 0,
  'ISO8 каждая функция участников проверяет админа и клуб через club_event_assert_admin');
select is((select count(*)::int from pg_policies where tablename in ('club_event_participants', 'club_event_participant_log') and qual not like '%club_event_current_club%'), 0, 'ISO8 политики таблиц участников проверяют клуб');

-- ===== фикстуры: мероприятия =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_create('Группа U13', null, '2026-12-05', null, null, 10, null, null, array['00000000-0000-0000-0000-0000000000e1']::uuid[], 'active')$$, 'фикстура: мероприятие с группой U13-A');
select lives_ok($$select club_event_create('Без групп', null, '2026-12-06', null, null, 10, null, null, null, 'active')$$, 'фикстура: общеклубное мероприятие');
select lives_ok($$select club_event_create('Лимит 2', null, '2026-12-07', null, null, 10, null, 2, null, 'active')$$, 'фикстура: лимит 2');
select lives_ok($$select club_event_create('Черновик', null, '2026-12-08', null, null, 10, null, null, null, 'draft')$$, 'фикстура: черновик');
select lives_ok($$select club_event_create('Завершится', null, '2026-12-09', null, null, 10, null, null, null, 'active')$$, 'фикстура: будущее завершённое');
select lives_ok($$select club_event_create('Отменится', null, '2026-12-10', null, null, 10, null, null, null, 'active')$$, 'фикстура: будущее отменённое');
select lives_ok($$select club_event_create('Группой', null, '2026-12-11', null, null, 10, null, null, null, 'active')$$, 'фикстура: добавление группой');
select lives_ok($$select club_event_create('Группа тесно', null, '2026-12-12', null, null, 10, null, 3, null, 'active')$$, 'фикстура: лимит 3 для группы из 4');
select lives_ok($$select club_event_create('Дедлайн', null, '2026-12-13', null, null, 10, null, null, null, 'active')$$, 'фикстура: дедлайн');
select lives_ok($$select club_event_create('Правки', null, '2026-12-14', null, null, 10, null, null, null, 'active')$$, 'фикстура: правки при участниках');
select lives_ok($$select club_event_create('Цены', null, '2026-12-15', null, null, 20, null, null, null, 'active')$$, 'фикстура: цены');
reset role;

-- ===== PT1/PT4/PT5. добавление игрока =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_participant_add(t_ev('Группа U13'), '00000000-0000-0000-0000-000000000d01') ->> 'applied')::boolean, true, 'PT1 игрок клуба добавлен в активное мероприятие');
reset role;
select is((select status from club_event_participants where id = t_pt('Группа U13', '00000000-0000-0000-0000-000000000d01')), 'active', 'PT1 запись active');
select is((select individual_price from club_event_participants where id = t_pt('Группа U13', '00000000-0000-0000-0000-000000000d01')), null, 'PR1 индивидуальной цены нет, цена по мероприятию');
select is((select count(*)::int from club_event_participant_log where to_status = 'active' and from_status is null), 1, 'PT10 создание записи в журнале статусов');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_participant_add(t_ev('Группа U13'), '00000000-0000-0000-0000-000000000d01')$$, '23505', 'already participating', 'PT2 повторное добавление активного: отказ');
select is((club_event_participant_add(t_ev('Группа U13'), '00000000-0000-0000-0000-000000000d07') ->> 'applied')::boolean, false, 'PT4 игрок не из группы мероприятия: предупреждение, без подтверждения не добавлен');
select is((club_event_participant_add(t_ev('Группа U13'), '00000000-0000-0000-0000-000000000d07') -> 'warnings' -> 0 ->> 'code'), 'not_in_group', 'PT4 код предупреждения not_in_group');
select is((club_event_participant_add(t_ev('Группа U13'), '00000000-0000-0000-0000-000000000d08') ->> 'applied')::boolean, false, 'PT4 игрок без группы: тоже предупреждение');
reset role;
select is((select count(*)::int from club_event_participants where event_id = t_ev('Группа U13')), 1, 'PT4 без подтверждения лишних записей нет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_participant_add(t_ev('Группа U13'), '00000000-0000-0000-0000-000000000d07', true) ->> 'applied')::boolean, true, 'PT4 с подтверждением добавлен');
select is((club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-000000000d07') ->> 'applied')::boolean, true, 'PT4 у общеклубного мероприятия предупреждения нет');
select throws_ok($$select club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-000000000d05')$$, '22023', 'player not active', 'PT5 игрок на паузе не добавляется');
select throws_ok($$select club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-000000000d06')$$, '22023', 'player not active', 'PT5 ушедший игрок не добавляется');
select throws_ok($$select club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-0000000000ff')$$, 'P0002', 'player not found', 'PT5 несуществующий игрок');
select throws_ok($$select club_event_participant_add('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000d01')$$, 'P0002', 'event not found', 'PT5 несуществующее мероприятие');
select throws_ok($$select club_event_participant_add(t_ev('Черновик'), '00000000-0000-0000-0000-000000000d01')$$, '55000', 'event not active', 'PT3 в черновик нельзя');
reset role;
select is((select count(*)::int from club_event_participants where event_id = t_ev('Черновик')), 0, 'PT3 в черновике записей нет');

-- PT3: завершённое и отменённое мероприятие; PT8: отмена записи там допустима
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_participant_add(t_ev('Завершится'), '00000000-0000-0000-0000-000000000d01')$$, 'фикстура: запись до завершения');
select lives_ok($$select club_event_participant_add(t_ev('Отменится'), '00000000-0000-0000-0000-000000000d01')$$, 'фикстура: запись до отмены мероприятия');
select lives_ok($$select club_event_participant_add(t_ev('Отменится'), '00000000-0000-0000-0000-000000000d02')$$, 'фикстура: вторая запись до отмены мероприятия');
select lives_ok($$select club_event_set_status(t_ev('Завершится'), 'finished')$$, 'фикстура: мероприятие завершено');
select lives_ok($$select club_event_set_status(t_ev('Отменится'), 'cancelled')$$, 'EV8 мероприятие отменено');
select throws_ok($$select club_event_participant_add(t_ev('Завершится'), '00000000-0000-0000-0000-000000000d02')$$, '55000', 'event not active', 'PT3 в завершённое нельзя');
select throws_ok($$select club_event_participant_add(t_ev('Отменится'), '00000000-0000-0000-0000-000000000d03')$$, '55000', 'event not active', 'PT3 в отменённое нельзя');
reset role;
select is(t_cnt('Отменится', 'active'), 2, 'EV8 отмена мероприятия не меняет записи');
select is((select count(*)::int from club_event_participant_log where event_id = t_ev('Отменится')), 2, 'EV8 отмена мероприятия не пишет в журнал записей');

-- ===== PT7/PT8/PT9/PT10. отмена и восстановление =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_participant_cancel(t_pt('Отменится', '00000000-0000-0000-0000-000000000d02')) ->> 'applied')::boolean, true, 'PT8 отмена записи в отменённом мероприятии допустима');
select is((club_event_participant_cancel(t_pt('Завершится', '00000000-0000-0000-0000-000000000d01')) ->> 'applied')::boolean, true, 'PT8 отмена записи в завершённом мероприятии допустима');
select is((club_event_participant_cancel(t_pt('Завершится', '00000000-0000-0000-0000-000000000d01')) ->> 'applied')::boolean, false, 'PT7 повторная отмена: без изменений (applied=false)');
select throws_ok($$select club_event_participant_restore(t_pt('Завершится', '00000000-0000-0000-0000-000000000d01'))$$, '55000', 'event not active', 'PT8 восстановление в завершённом мероприятии запрещено');
select throws_ok($$select club_event_participant_restore(t_pt('Отменится', '00000000-0000-0000-0000-000000000d02'))$$, '55000', 'event not active', 'PT8 восстановление в отменённом мероприятии запрещено');
reset role;
select is((select status from club_event_participants where id = t_pt('Завершится', '00000000-0000-0000-0000-000000000d01')), 'cancelled', 'PT7 запись осталась, статус cancelled');
select is((select count(*)::int from club_event_participant_log where participant_id = t_pt('Завершится', '00000000-0000-0000-0000-000000000d01')), 2, 'PT10 журнал: создание и отмена, повтор не пишет');
-- EV7 реактивация отменённого мероприятия: записи те же, дублей нет
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_set_status(t_ev('Отменится'), 'active')$$, 'EV7 мероприятие реактивировано');
select is((club_event_participant_restore(t_pt('Отменится', '00000000-0000-0000-0000-000000000d02')) ->> 'applied')::boolean, true, 'PT9 восстановление той же записи');
reset role;
select is((select count(*)::int from club_event_participants where event_id = t_ev('Отменится')), 2, 'PT9/EV7 строк не прибавилось (запись одна на игрока)');
select is((select count(*)::int from club_event_participant_log where participant_id = t_pt('Отменится', '00000000-0000-0000-0000-000000000d02')), 3, 'PT10 журнал: создание, отмена, восстановление');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_participant_restore(t_pt('Отменится', '00000000-0000-0000-0000-000000000d02')) ->> 'applied')::boolean, false, 'PT9 повторное восстановление активной: без изменений');
select throws_ok($$select club_event_participant_add(t_ev('Отменится'), '00000000-0000-0000-0000-000000000d02')$$, '23505', 'already participating', 'PT2 добавление игрока с отменённой записью: дубль запрещён');
select lives_ok($$select club_event_participant_cancel(t_pt('Отменится', '00000000-0000-0000-0000-000000000d02'))$$, 'PT2 фикстура: снова отменена');
select throws_ok($$select club_event_participant_add(t_ev('Отменится'), '00000000-0000-0000-0000-000000000d02')$$, '23505', 'already participating', 'PT2 отменённая запись: добавить заново нельзя, только восстановить');
select throws_ok($$select club_event_participant_cancel('00000000-0000-0000-0000-0000000000ff')$$, 'P0002', 'participant not found', 'PT7 отмена несуществующей записи');
reset role;
select is((select count(*)::int from club_event_participants where event_id = t_ev('Отменится')), 2, 'PT2 дубль не создан');

-- ===== PT5/PT13. архивные игроки =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-000000000d02')$$, 'PT13 фикстура: запись игрока');
select lives_ok($$select club_event_participant_cancel(t_pt('Без групп', '00000000-0000-0000-0000-000000000d02'))$$, 'PT13 фикстура: отмена');
reset role;
update players set status = 'inactive' where id = '00000000-0000-0000-0000-000000000d02';
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_participant_restore(t_pt('Без групп', '00000000-0000-0000-0000-000000000d02'))$$, '22023', 'player not active', 'PT13 восстановление записи ушедшего игрока запрещено');
select is(jsonb_array_length(club_event_participants_list(t_ev('Без групп'), 'cancelled')), 1, 'PT5 запись ушедшего игрока остаётся в списке');
reset role;
update players set status = 'paused' where id = '00000000-0000-0000-0000-000000000d02';
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_participant_restore(t_pt('Без групп', '00000000-0000-0000-0000-000000000d02'))$$, '22023', 'player not active', 'PT13 игрок на паузе: восстановление запрещено');
reset role;
update players set status = 'active' where id = '00000000-0000-0000-0000-000000000d02';
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_participant_restore(t_pt('Без групп', '00000000-0000-0000-0000-000000000d02')) ->> 'applied')::boolean, true, 'PT13 после возвращения игрока в «Занимается» восстановление доступно');
reset role;

-- ===== PT11. удаление игрока с записью отклоняется =====
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-000000000d01'$$, '23503', null, 'PT11 игрок с записью мероприятия не удаляется');
select lives_ok($$delete from players where id = '00000000-0000-0000-0000-000000000d08'$$, 'PT11 игрок без записей удаляется как раньше');
insert into players (id, club_id, group_id, full_name, status) values ('00000000-0000-0000-0000-000000000d08', '00000000-0000-0000-0000-00000000c001', null, 'Зина без группы', 'active');

-- ===== LD1/LD2/LD3/LD4. лимит =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_participant_add(t_ev('Лимит 2'), '00000000-0000-0000-0000-000000000d01')$$, 'LD2 место 1 из 2');
select lives_ok($$select club_event_participant_add(t_ev('Лимит 2'), '00000000-0000-0000-0000-000000000d02')$$, 'LD2 место 2 из 2');
select throws_ok($$select club_event_participant_add(t_ev('Лимит 2'), '00000000-0000-0000-0000-000000000d03')$$, '55000', 'event full', 'LD2 третий отклонён');
select lives_ok($$select club_event_participant_cancel(t_pt('Лимит 2', '00000000-0000-0000-0000-000000000d01'))$$, 'LD2 отмена освобождает место');
select lives_ok($$select club_event_participant_add(t_ev('Лимит 2'), '00000000-0000-0000-0000-000000000d03')$$, 'LD2 отменённые место не занимают: добавление проходит');
select throws_ok($$select club_event_participant_restore(t_pt('Лимит 2', '00000000-0000-0000-0000-000000000d01'))$$, '55000', 'event full', 'LD3 восстановление при заполненном лимите: отказ');
select lives_ok($$select club_event_participant_cancel(t_pt('Лимит 2', '00000000-0000-0000-0000-000000000d03'))$$, 'LD3 освободили место');
select is((club_event_participant_restore(t_pt('Лимит 2', '00000000-0000-0000-0000-000000000d01')) ->> 'applied')::boolean, true, 'LD3 восстановление при свободном месте');
-- LD4: снижение лимита ниже числа активных
select is((club_event_update(t_ev('Лимит 2'), '{"capacity": 1}'::jsonb) ->> 'applied')::boolean, false, 'LD4/EV10 снижение лимита ниже активных без confirm: предупреждение, не применено');
select is((club_event_update(t_ev('Лимит 2'), '{"capacity": 1}'::jsonb) -> 'warnings' -> 0 ->> 'over')::int, 1, 'LD4 предупреждение содержит превышение (1)');
reset role;
select is((select capacity from club_events where id = t_ev('Лимит 2')), 2, 'LD4 без confirm лимит не изменился');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_update(t_ev('Лимит 2'), '{"capacity": 1}'::jsonb, null, true) ->> 'applied')::boolean, true, 'LD4 с confirm лимит снижен');
reset role;
select is((select capacity from club_events where id = t_ev('Лимит 2')), 1, 'LD4 лимит 1 при 2 активных');
select is(t_cnt('Лимит 2', 'active'), 2, 'LD4 существующие записи не отменены');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_participant_add(t_ev('Лимит 2'), '00000000-0000-0000-0000-000000000d04')$$, '55000', 'event full', 'LD4 новые добавления блокируются при активных > лимита');
select lives_ok($$select club_event_participant_cancel(t_pt('Лимит 2', '00000000-0000-0000-0000-000000000d02'))$$, 'LD4 активных стало 1 = лимит');
select throws_ok($$select club_event_participant_add(t_ev('Лимит 2'), '00000000-0000-0000-0000-000000000d04')$$, '55000', 'event full', 'LD4 при активных = лимит: отказ');
select lives_ok($$select club_event_participant_cancel(t_pt('Лимит 2', '00000000-0000-0000-0000-000000000d01'))$$, 'LD4 активных 0 < лимита');
select lives_ok($$select club_event_participant_add(t_ev('Лимит 2'), '00000000-0000-0000-0000-000000000d04')$$, 'LD4 при активных < лимита: успех');
select is((club_event_update(t_ev('Лимит 2'), '{"capacity": 5}'::jsonb) ->> 'applied')::boolean, true, 'LD4 увеличение лимита без предупреждений');
select is((club_event_update(t_ev('Лимит 2'), '{"capacity": null}'::jsonb) ->> 'applied')::boolean, true, 'LD1 лимит снимается');
reset role;

-- ===== U14. счётчики в списке и карточке =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_update(t_ev('Лимит 2'), '{"capacity": 3}'::jsonb)$$, 'U14 фикстура: лимит 3');
select is((club_event_get(t_ev('Лимит 2')) ->> 'active_count')::int, 1, 'U14 карточка: активных 1');
select is((club_event_get(t_ev('Лимит 2')) ->> 'free_places')::int, 2, 'U14 карточка: свободных 2');
select is((club_event_get(t_ev('Лимит 2')) ->> 'over_limit')::boolean, false, 'U14 карточка: превышения нет');
select is((club_event_get(t_ev('Без групп')) ->> 'free_places'), null, 'U14 без лимита: свободных мест нет (null)');
select is((select x ->> 'active_count' from jsonb_array_elements(club_event_list(null)) x where x ->> 'name' = 'Лимит 2'), '1', 'U14 список: число активных');
reset role;

-- ===== LD6/LD7. дедлайн =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_participant_add(t_ev('Дедлайн'), '00000000-0000-0000-0000-000000000d01')$$, 'LD1 дедлайна нет: добавление проходит');
select lives_ok($$select club_event_participant_cancel(t_pt('Дедлайн', '00000000-0000-0000-0000-000000000d01'))$$, 'LD6 фикстура: отменена запись');
select lives_ok($$select club_event_participant_add(t_ev('Дедлайн'), '00000000-0000-0000-0000-000000000d02')$$, 'LD6 фикстура: действующая запись');
select lives_ok(format($f$select club_event_update(t_ev('Дедлайн'), jsonb_build_object('signup_deadline', %L), null, true)$f$, to_char((now() at time zone 'Asia/Tbilisi') + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS')), 'LD6 дедлайн в будущем (по Тбилиси)');
select lives_ok($$select club_event_participant_add(t_ev('Дедлайн'), '00000000-0000-0000-0000-000000000d03')$$, 'LD6 до дедлайна добавление проходит');
select lives_ok(format($f$select club_event_update(t_ev('Дедлайн'), jsonb_build_object('signup_deadline', %L), null, true)$f$, to_char((now() at time zone 'Asia/Tbilisi') - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS')), 'LD6 дедлайн в прошлом');
select throws_ok($$select club_event_participant_add(t_ev('Дедлайн'), '00000000-0000-0000-0000-000000000d04')$$, '55000', 'deadline passed', 'LD6/LD7 после дедлайна добавление отклонено на сервере');
select throws_ok($$select club_event_participant_restore(t_pt('Дедлайн', '00000000-0000-0000-0000-000000000d01'))$$, '55000', 'deadline passed', 'LD6 после дедлайна восстановление отклонено');
select throws_ok($$select club_event_group_add(t_ev('Дедлайн'), '00000000-0000-0000-0000-0000000000e1')$$, '55000', 'deadline passed', 'LD6/PT15 после дедлайна группой добавить нельзя');
select is((club_event_participant_cancel(t_pt('Дедлайн', '00000000-0000-0000-0000-000000000d02')) ->> 'applied')::boolean, true, 'LD6 после дедлайна отмена записи работает');
select is((club_event_participant_set_price(t_pt('Дедлайн', '00000000-0000-0000-0000-000000000d03'), 5, 'после дедлайна') ->> 'applied')::boolean, true, 'LD6 после дедлайна цена меняется');
reset role;
update club_events set signup_deadline = (now() at time zone 'Asia/Tbilisi') where id = t_ev('Дедлайн');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select signup_deadline = (now() at time zone 'Asia/Tbilisi') from club_events where id = t_ev('Дедлайн')), true, 'LD6 дедлайн ровно в текущий момент (с микросекундами)');
select throws_ok($$select club_event_participant_add(t_ev('Дедлайн'), '00000000-0000-0000-0000-000000000d04')$$, '55000', 'deadline passed', 'LD6 в момент дедлайна: отказ (граница включена)');
select lives_ok($$select club_event_update(t_ev('Дедлайн'), '{"signup_deadline": null}'::jsonb, null, true)$$, 'LD1 дедлайн снимается');
select lives_ok($$select club_event_participant_add(t_ev('Дедлайн'), '00000000-0000-0000-0000-000000000d04')$$, 'LD1 без дедлайна добавление проходит');
reset role;

-- ===== PT14/PT15. добавление группой =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_participant_add(t_ev('Группой'), '00000000-0000-0000-0000-000000000d01')$$, 'PT14 фикстура: Аня уже участвует');
select is((club_event_group_preview(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1') ->> 'add_count')::int, 3, 'PT14 предпросмотр: будет добавлено 3 (Боря, Вера, Гоша)');
select is((club_event_group_preview(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1') -> 'skipped' -> 0 ->> 'reason'), 'already', 'PT14 предпросмотр: уже участвующий пропущен (Аня)');
select is((select count(*)::int from jsonb_array_elements(club_event_group_preview(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1') -> 'skipped') x where x ->> 'reason' = 'not_active'), 2, 'PT14 предпросмотр: на паузе и ушедший пропущены');
select is((club_event_group_preview(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1') ->> 'over_limit')::boolean, false, 'PT14 предпросмотр: без лимита');
reset role;
select is(t_cnt('Группой', 'active'), 1, 'PT14 предпросмотр ничего не добавляет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_group_add(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1') ->> 'added')::int, 3, 'PT14 добавлено 3');
reset role;
select is(t_cnt('Группой', 'active'), 4, 'PT14 активных 4 (Аня и ещё 3)');
select is((select count(*)::int from club_event_participants where event_id = t_ev('Группой') and player_id in ('00000000-0000-0000-0000-000000000d05', '00000000-0000-0000-0000-000000000d06')), 0, 'PT14 игроки на паузе и ушедший не добавлены');
select is((select count(*)::int from club_event_participant_log where event_id = t_ev('Группой')), 4, 'PT10 журнал: по строке на запись');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_group_add(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1') ->> 'added')::int, 0, 'PT15 повтор: ничего не добавлено, дублей нет');
-- all-or-nothing по лимиту
select is((club_event_group_preview(t_ev('Группа тесно'), '00000000-0000-0000-0000-0000000000e1') ->> 'over_limit')::boolean, true, 'PT14 предпросмотр: лимит 3 при 4 игроках: превышение');
select throws_ok($$select club_event_group_add(t_ev('Группа тесно'), '00000000-0000-0000-0000-0000000000e1')$$, '55000', 'event full', 'PT14 группа не помещается в лимит: отказ целиком');
reset role;
select is(t_cnt('Группа тесно', 'active'), 0, 'PT14 при отказе по лимиту не добавлено ни одного (частичного добавления нет)');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_group_add(t_ev('Черновик'), '00000000-0000-0000-0000-0000000000e1')$$, '55000', 'event not active', 'PT15 в черновик группой нельзя');
select throws_ok($$select club_event_group_add(t_ev('Завершится'), '00000000-0000-0000-0000-0000000000e1')$$, '55000', 'event not active', 'PT15 в завершённое группой нельзя');
select throws_ok($$select club_event_group_add(t_ev('Группой'), '00000000-0000-0000-0000-0000000000ff')$$, 'P0002', 'group not found', 'PT15 несуществующая группа');
reset role;

-- ===== EV10. смена даты и времени при участниках =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_update(t_ev('Правки'), '{"starts_on": "2026-12-20"}'::jsonb)$$, 'EV10 без записанных смена даты применяется сразу');
select lives_ok($$select club_event_participant_add(t_ev('Правки'), '00000000-0000-0000-0000-000000000d01')$$, 'EV10 фикстура: записан участник');
select lives_ok($$select club_event_participant_add(t_ev('Правки'), '00000000-0000-0000-0000-000000000d02')$$, 'EV10 фикстура: второй участник');
select is((club_event_update(t_ev('Правки'), '{"starts_on": "2026-12-21"}'::jsonb) ->> 'applied')::boolean, false, 'EV10 смена даты при участниках без confirm: предупреждение');
select is((club_event_update(t_ev('Правки'), '{"starts_on": "2026-12-21"}'::jsonb) -> 'warnings' -> 0 ->> 'affected')::int, 2, 'EV10 предупреждение: затронуто 2');
select is((club_event_update(t_ev('Правки'), '{"starts_time": "10:00"}'::jsonb) ->> 'applied')::boolean, false, 'EV10 смена времени при участниках тоже требует confirm');
select is((club_event_update(t_ev('Правки'), '{"place": "Парк"}'::jsonb) ->> 'applied')::boolean, true, 'EV10 прочие правки без предупреждения');
reset role;
select is((select starts_on::text from club_events where id = t_ev('Правки')), '2026-12-20', 'EV10 без confirm дата не изменилась');
select is((select count(*)::int from club_event_log where event_id = t_ev('Правки') and action = 'updated'), 2, 'EV10 без confirm журнал не пишется (2 применённых правки)');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_update(t_ev('Правки'), '{"starts_on": "2026-12-21", "starts_time": "10:00"}'::jsonb, null, true) ->> 'applied')::boolean, true, 'EV10 с confirm дата и время применены');
reset role;
select is((select starts_on::text || ' ' || starts_time::text from club_events where id = t_ev('Правки')), '2026-12-21 10:00:00', 'EV10 дата и время изменены');
select is(t_cnt('Правки', 'active'), 2, 'EV10 записи не отменены');

-- ===== PR. индивидуальная цена и история =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_participant_add(t_ev('Цены'), '00000000-0000-0000-0000-000000000d01')$$, 'PR фикстура: участник 1');
select lives_ok($$select club_event_participant_add(t_ev('Цены'), '00000000-0000-0000-0000-000000000d02')$$, 'PR фикстура: участник 2');
select lives_ok($$select club_event_participant_add(t_ev('Цены'), '00000000-0000-0000-0000-000000000d03')$$, 'PR фикстура: участник 3');
select is((club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d01'), 12.50, 'Скидка по решению тренера') ->> 'applied')::boolean, true, 'PR3/PR5 индивидуальная цена установлена');
reset role;
select is((select individual_price from club_event_participants where id = t_pt('Цены', '00000000-0000-0000-0000-000000000d01')), 12.50::numeric, 'PR3 индивидуальная цена записана');
select is((select base_price from club_events where id = t_ev('Цены')), 20::numeric, 'PR3 базовая цена не изменилась');
select is((select individual_price from club_event_participants where id = t_pt('Цены', '00000000-0000-0000-0000-000000000d02')), null, 'PR3 цена другого участника не изменилась');
select ok((select old_amount = 20 and new_amount = 12.50 and reason = 'Скидка по решению тренера' and scope = 'individual' and actor_id = '00000000-0000-0000-0000-0000000000a1'
             and participant_id = t_pt('Цены', '00000000-0000-0000-0000-000000000d01') and at is not null
             from club_event_price_log where participant_id = t_pt('Цены', '00000000-0000-0000-0000-000000000d01')), 'PR5 история: было (по мероприятию), стало, причина, автор, запись, время');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 15, null)$$, '22023', 'price change needs reason', 'PR4 причина не задана');
select throws_ok($$select club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 15, '  ')$$, '22023', 'price change needs reason', 'PR4 причина из пробелов');
select throws_ok($$select club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 15, 'ab')$$, '22023', 'price change needs reason', 'PR4 причина 2 символа');
select throws_ok($$select club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), -1, 'причина')$$, '22023', 'bad price', 'PR8 отрицательная цена');
select throws_ok($$select club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 1.005, 'причина')$$, '22023', 'bad price', 'PR8 цена с тремя знаками');
select is((club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d01'), 12.50, null) ->> 'applied')::boolean, false, 'PR10 то же значение: причина не нужна, ничего не пишется');
select is((club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d03'), 0, 'Гость клуба') ->> 'applied')::boolean, true, 'PR13 цена 0 допустима');
reset role;
select is((select count(*)::int from club_event_price_log where scope = 'individual' and event_id = t_ev('Цены')), 2, 'PR4/PR10 в истории две строки (отказы и повтор не пишут)');
select as_user('00000000-0000-0000-0000-0000000000a1');
-- PR2 динамическая базовая цена
select lives_ok($$select club_event_update(t_ev('Цены'), '{"base_price": 25}'::jsonb, 'Подорожал автобус')$$, 'PR2 смена базовой цены с причиной');
select is((select (x ->> 'price')::numeric from jsonb_array_elements(club_event_participants_list(t_ev('Цены'))) x where x ->> 'player_id' = '00000000-0000-0000-0000-000000000d02'), 25::numeric, 'PR2 запись без индивидуальной цены берёт новую базовую');
select is((select (x ->> 'price')::numeric from jsonb_array_elements(club_event_participants_list(t_ev('Цены'))) x where x ->> 'player_id' = '00000000-0000-0000-0000-000000000d01'), 12.50::numeric, 'PR2 индивидуальная цена не меняется (замена, не сумма)');
-- сброс на базовую
select is((club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d01'), null, 'Скидка закончилась') ->> 'applied')::boolean, true, 'PR5 сброс на цену мероприятия');
select is((select (x ->> 'price')::numeric from jsonb_array_elements(club_event_participants_list(t_ev('Цены'))) x where x ->> 'player_id' = '00000000-0000-0000-0000-000000000d01'), 25::numeric, 'PR5 после сброса цена по мероприятию');
select is((select jsonb_array_length(club_event_participant_history(t_pt('Цены', '00000000-0000-0000-0000-000000000d01')) -> 'price_log')), 2, 'PR5 история записи: установка и сброс');
-- PR9: в завершённом мероприятии и у отменённой записи
select lives_ok($$select club_event_participant_cancel(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'))$$, 'PR9 фикстура: запись отменена');
select is((club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d02'), 10, 'Закрыли долг отменённой записи') ->> 'applied')::boolean, true, 'PR9/PR12 цена отменённой записи меняется (границы «не ниже засчитанного» включатся с платежами)');
select lives_ok($$select club_event_set_status(t_ev('Цены'), 'finished')$$, 'PR9 фикстура: мероприятие завершено');
select is((club_event_participant_set_price(t_pt('Цены', '00000000-0000-0000-0000-000000000d03'), 7, 'Правка после завершения') ->> 'applied')::boolean, true, 'PR9 цена в завершённом мероприятии меняется с причиной');
reset role;
select is((select individual_price from club_event_participants where id = t_pt('Цены', '00000000-0000-0000-0000-000000000d02')), 10::numeric, 'PR9 цена отменённой записи сохранена');

-- ===== PT12/ACL8. список без рейтингов =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select string_agg(x ->> 'full_name', '|' order by ord) from jsonb_array_elements(club_event_participants_list(t_ev('Группой'))) with ordinality t(x, ord)), 'Аня|Боря|Вера|Гоша', 'PT12 список по имени');
select is((select count(*)::int from (select distinct jsonb_object_keys(x) k from jsonb_array_elements(club_event_participants_list(t_ev('Группой'))) x) q
            where k in ('rating', 'goals', 'place', 'score', 'rank')), 0, 'PT12/ACL8 нет полей рейтинга, голов, места');
select throws_ok($$select club_event_participants_list(t_ev('Группой'), 'bogus')$$, '22023', 'bad status', 'PT12 неизвестный статус отклоняется');
reset role;

-- ===== ACL. права на функции и таблицы =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select club_event_participant_add(t_ev('Группой'), '00000000-0000-0000-0000-000000000d07')$$, '42501', 'forbidden', 'ACL1 тренер не добавляет участника');
select throws_ok($$select club_event_group_add(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1')$$, '42501', 'forbidden', 'ACL1 тренер не добавляет группу');
select throws_ok($$select club_event_participant_cancel(t_pt('Группой', '00000000-0000-0000-0000-000000000d01'))$$, '42501', 'forbidden', 'ACL1 тренер не отменяет запись');
select throws_ok($$select club_event_participant_restore(t_pt('Группой', '00000000-0000-0000-0000-000000000d01'))$$, '42501', 'forbidden', 'ACL1 тренер не восстанавливает запись');
select throws_ok($$select club_event_participant_set_price(t_pt('Группой', '00000000-0000-0000-0000-000000000d01'), 1, 'причина')$$, '42501', 'forbidden', 'ACL1 тренер не меняет цену');
select throws_ok($$select club_event_participants_list(t_ev('Группой'))$$, '42501', 'forbidden', 'ACL2 тренер не читает участников');
select throws_ok($$select club_event_participant_history(t_pt('Группой', '00000000-0000-0000-0000-000000000d01'))$$, '42501', 'forbidden', 'ACL2 тренер не читает историю записи');
select throws_ok($$select club_event_group_preview(t_ev('Группой'), '00000000-0000-0000-0000-0000000000e1')$$, '42501', 'forbidden', 'ACL2 тренер не видит предпросмотр');
select is((select count(*)::int from club_event_participants) + (select count(*)::int from club_event_participant_log), 0, 'ACL2 тренер прямым запросом не видит участников и журнал (RLS)');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select club_event_participants_list(t_ev('Группой'))$$, '42501', 'forbidden', 'ACL2 родитель не читает участников');
select throws_ok($$select club_event_participant_add(t_ev('Группой'), '00000000-0000-0000-0000-000000000d07')$$, '42501', 'forbidden', 'ACL1 родитель не добавляет');
select is((select count(*)::int from club_event_participants), 0, 'ACL2 родитель прямым запросом ничего не видит');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select club_event_participants_list(t_ev('Группой'))$$, '42501', 'forbidden', 'ACL2 локальный админ не читает участников');
select throws_ok($$select club_event_participant_add(t_ev('Группой'), '00000000-0000-0000-0000-000000000d07')$$, '42501', 'forbidden', 'ACL1 локальный админ не добавляет');
select is((select count(*)::int from club_event_participants), 0, 'ACL2 локальный админ прямым запросом ничего не видит');
select as_user('00000000-0000-0000-0000-0000000000e0');
select throws_ok($$select club_event_participant_add(t_ev('Группой'), '00000000-0000-0000-0000-000000000d07')$$, '42501', 'forbidden', 'ACL6 пользователь без прав не добавляет');
select as_anon();
select throws_ok($$select club_event_participant_add('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000d07')$$, '42501', null, 'ACL1 anon не добавляет');
select throws_ok($$select count(*) from club_event_participants$$, '42501', null, 'ACL4 anon без права на таблицу');
reset role;
select set_config('request.jwt.claims', '', true);
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$insert into club_event_participants (event_id, player_id) values (t_ev('Группой'), '00000000-0000-0000-0000-000000000d07')$$, '42501', null, 'ACL3 админ не вставляет напрямую');
select throws_ok($$update club_event_participants set status = 'cancelled'$$, '42501', null, 'ACL3 админ не обновляет напрямую');
select throws_ok($$delete from club_event_participants$$, '42501', null, 'ACL3 админ не удаляет напрямую');
select throws_ok($$update club_event_participants set individual_price = 1$$, '42501', null, 'ACL3 цену напрямую менять нельзя');
select ok((select count(*) from club_event_participants) > 0, 'ACL2 админ читает таблицу участников напрямую');
reset role;

-- ===== HIST/EV5. записи не удаляются, журнал не правится =====
select throws_ok($$delete from club_event_participants$$, 'P0001', null, 'EV5 DELETE записей отклонён триггером');
select throws_ok($$truncate club_event_participants cascade$$, 'P0001', null, 'EV5 TRUNCATE записей отклонён');
select throws_ok($$delete from club_event_participant_log$$, 'P0001', null, 'HIST2 журнал статусов записи не удаляется');
select throws_ok($$update club_event_participant_log set to_status = 'active'$$, 'P0001', null, 'HIST2 журнал статусов записи не правится');
select throws_ok($$truncate club_event_participant_log$$, 'P0001', null, 'HIST2 TRUNCATE журнала отклонён');
select throws_ok($$delete from club_event_price_log$$, 'P0001', null, 'HIST2 история цен (с индивидуальными) не удаляется');
select is((select count(*)::int from pg_proc where proname in ('club_event_participant_delete', 'club_event_participant_remove', 'club_event_cancel_draft'))::int, 0, 'EV5/EV12 функций удаления записи и отмены черновика нет');
select is((select count(*)::int from pg_proc where proname like 'club\_event\_%' and (prosrc like '%is_any_coach%' or prosrc like '%event_assert_staff%' or prosrc like '%service_payments%' or prosrc like '%tournaments%')), 0, 'ACL7/NOSIDE функции раздела не используют функции турниров и не трогают платежи (платежи в следующем этапе)');

-- ===== ISO. клубная изоляция участников =====
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-000000000d99', '00000000-0000-0000-0000-00000000c002', 'Чужой', 'active');
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000c002', 'Чужая группа');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-000000000d01')$$, '42501', 'club not determined', 'ISO5 два клуба без users.club_id: добавление закрыто');
select throws_ok($$select club_event_participants_list(t_ev('Без групп'))$$, '42501', 'club not determined', 'ISO5 список участников закрыт');
select is((select count(*)::int from club_event_participants), 0, 'ISO5 прямое чтение участников закрыто');
reset role;
update users set club_id = '00000000-0000-0000-0000-00000000c001' where id = '00000000-0000-0000-0000-0000000000a1';
update users set club_id = '00000000-0000-0000-0000-00000000c002' where id = '00000000-0000-0000-0000-0000000000a2';
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-000000000d99')$$, '22023', 'player of another club', 'ISO2 игрок другого клуба не добавляется');
select throws_ok($$select club_event_group_add(t_ev('Без групп'), '00000000-0000-0000-0000-0000000000e9')$$, '22023', 'group of another club', 'ISO2 группа другого клуба не добавляется');
select throws_ok($$select club_event_group_preview(t_ev('Без групп'), '00000000-0000-0000-0000-0000000000e9')$$, '22023', 'group of another club', 'ISO2 предпросмотр группы другого клуба закрыт');
select ok((select count(*) from club_event_participants) > 0, 'ISO4 А1 видит участников своего клуба');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from club_event_participants) + (select count(*)::int from club_event_participant_log), 0, 'ISO4 А2 прямым чтением не видит участников клуба 1');
select throws_ok($$select club_event_participants_list(t_ev('Без групп'))$$, '42501', 'forbidden', 'ISO4 А2: список участников чужого мероприятия');
select throws_ok($$select club_event_participant_add(t_ev('Без групп'), '00000000-0000-0000-0000-000000000d01')$$, '42501', 'forbidden', 'ISO4 А2: добавление в чужое мероприятие');
select throws_ok($$select club_event_group_add(t_ev('Без групп'), '00000000-0000-0000-0000-0000000000e1')$$, '42501', 'forbidden', 'ISO4 А2: группа в чужое мероприятие');
select throws_ok($$select club_event_group_preview(t_ev('Без групп'), '00000000-0000-0000-0000-0000000000e1')$$, '42501', 'forbidden', 'ISO4 А2: предпросмотр для чужого мероприятия');
select throws_ok($$select club_event_participant_cancel(t_pt('Без групп', '00000000-0000-0000-0000-000000000d07'))$$, '42501', 'forbidden', 'ISO4 А2: отмена чужой записи');
select throws_ok($$select club_event_participant_restore(t_pt('Без групп', '00000000-0000-0000-0000-000000000d07'))$$, '42501', 'forbidden', 'ISO4 А2: восстановление чужой записи');
select throws_ok($$select club_event_participant_set_price(t_pt('Без групп', '00000000-0000-0000-0000-000000000d07'), 1, 'причина')$$, '42501', 'forbidden', 'ISO4 А2: цена чужой записи');
select throws_ok($$select club_event_participant_history(t_pt('Без групп', '00000000-0000-0000-0000-000000000d07'))$$, '42501', 'forbidden', 'ISO4 А2: история чужой записи');
select throws_ok($$select club_event_update(t_ev('Без групп'), '{"starts_on": "2027-01-01"}'::jsonb, null, true)$$, '42501', 'forbidden', 'ISO4 А2: правка чужого мероприятия при участниках');
reset role;

select * from finish();
rollback;
