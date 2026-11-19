-- pgTAP: раздел «Мероприятия», удаление черновика как скрытие (0211, Issue #677, docs/CLUB_EVENTS_ACCEPTANCE.md, раздел «Удаление черновика»).
-- Тесты написаны до миграции: на master без 0211 они красные. Права проверяются на базе с привилегиями по умолчанию Supabase.
begin;
create extension if not exists pgtap;
select plan(50);

drop table if exists club_event_participant_log, club_event_participants, club_event_price_log, club_event_log, club_event_groups, club_events cascade;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0202_club_events.sql
\i db/migrations/0204_club_event_participants.sql
\i db/migrations/0210_club_event_payments.sql
\i db/migrations/0211_club_event_delete_draft.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Админ', true, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000a2', 9102, 'Админ клуба 2', true, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000c1', 9103, 'Тренер', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000b1', 9104, 'Родитель', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000d1', 9105, 'Локальный админ', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000e0', 9106, 'Без прав', false, '00000000-0000-0000-0000-00000000c001');
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U13-A');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');
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
create or replace function as_owner_with_jwt(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function t_ev(n text) returns uuid language sql stable security definer set search_path = public as $$ select id from club_events where name = n $$;

-- ===== подготовка: мероприятия в разных статусах =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_create('Пустой черновик', null, '2026-12-01', null, null, 10, null, null, null, 'draft')$$, 'подготовка: пустой черновик');
select lives_ok($$select club_event_create('Второй пустой', null, '2026-12-02', null, null, 10, null, null, null, 'draft')$$, 'подготовка: второй пустой черновик');
select lives_ok($$select club_event_create('Активное', null, '2026-12-03', null, null, 10, null, null, null, 'active')$$, 'подготовка: активное');
select lives_ok($$select club_event_set_status(club_event_create('Завершённое', null, '2026-12-04', null, null, 10, null, null, null, 'active'), 'finished')$$, 'подготовка: завершённое');
select lives_ok($$select club_event_set_status(club_event_create('Отменённое', null, '2026-12-05', null, null, 10, null, null, null, 'active'), 'cancelled')$$, 'подготовка: отменённое');
select lives_ok($$select club_event_create('Черновик с записью', null, '2026-12-06', null, null, 10, null, null, null, 'draft')$$, 'подготовка: черновик, в который запись попадёт напрямую');
select lives_ok($$select club_event_create('Черновик с отменённой записью', null, '2026-12-07', null, null, 10, null, null, null, 'draft')$$, 'подготовка: черновик с отменённой записью');
reset role;
-- участников в черновик API не добавляет (нужно активное), поэтому кладём строки владельцем: так проверяется защита самой функции
insert into club_event_participants (event_id, player_id, status) values
  (t_ev('Черновик с записью'), '00000000-0000-0000-0000-000000000d01', 'active'),
  (t_ev('Черновик с отменённой записью'), '00000000-0000-0000-0000-000000000d01', 'cancelled');
select as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select club_event_create('Черновик клуба 2', null, '2026-12-08', null, null, 10, null, null, null, 'draft')$$, 'подготовка: черновик клуба 2');
reset role;

-- ===== ACL (DEL8, DEL6) =====
select ok(has_function_privilege('authenticated', 'club_event_delete_draft(uuid)', 'execute'), 'DEL8 authenticated вызывает club_event_delete_draft');
select ok(not has_function_privilege('anon', 'club_event_delete_draft(uuid)', 'execute'), 'DEL8 anon не вызывает club_event_delete_draft');
select ok(not has_function_privilege('public', 'club_event_delete_draft(uuid)', 'execute'), 'DEL8 public не вызывает club_event_delete_draft');
select ok(not has_function_privilege('authenticated', 'club_event_deleted_frozen()', 'execute'), 'DEL8 функция триггера недоступна authenticated');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'club\_event\_%'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'DEL8 ни одна функция club_event_* не доступна anon и public');
select as_anon();
select throws_ok($$select club_event_delete_draft(t_ev('Пустой черновик'))$$, '42501', null, 'DEL6 anon отклонён');
reset role;
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select club_event_delete_draft(t_ev('Пустой черновик'))$$, '42501', 'forbidden', 'DEL6 тренер отклонён');
reset role;
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select club_event_delete_draft(t_ev('Пустой черновик'))$$, '42501', 'forbidden', 'DEL6 родитель отклонён');
reset role;
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select club_event_delete_draft(t_ev('Пустой черновик'))$$, '42501', 'forbidden', 'DEL6 локальный админ отклонён');
reset role;
select as_user('00000000-0000-0000-0000-0000000000e0');
select throws_ok($$select club_event_delete_draft(t_ev('Пустой черновик'))$$, '42501', 'forbidden', 'DEL6 пользователь без прав отклонён');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select club_event_delete_draft(t_ev('Пустой черновик'))$$, '42501', 'forbidden', 'DEL6 админ другого клуба отклонён');
reset role;
select is((select status from club_events where name = 'Пустой черновик'), 'draft', 'DEL6 после отказов черновик на месте');

-- ===== DEL1. скрытие пустого черновика =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_delete_draft(t_ev('Пустой черновик')) ->> 'applied')::boolean, true, 'DEL1 пустой черновик скрыт');
select ok(not exists (select 1 from jsonb_array_elements(club_event_list()) x where x ->> 'name' = 'Пустой черновик'), 'DEL1 в списке его нет');
select ok(not exists (select 1 from jsonb_array_elements(club_event_list('draft')) x where x ->> 'name' = 'Пустой черновик'), 'DEL9 нет и при фильтре draft');
select throws_ok($$select club_event_list('deleted')$$, '22023', null, 'DEL9 фильтр deleted отклонён как неизвестный статус');
select throws_ok($$select club_event_get(t_ev('Пустой черновик'))$$, 'P0002', null, 'DEL1 club_event_get: не найдено');
reset role;
select is((select status from club_events where name = 'Пустой черновик'), 'deleted', 'DEL1 строка осталась со статусом deleted');
select is((select count(*)::int from club_event_log where event_id = t_ev('Пустой черновик') and action = 'deleted'), 1, 'DEL1 в журнале одна запись deleted');
select is((select (before ->> 'status') || '>' || (after ->> 'status') from club_event_log where event_id = t_ev('Пустой черновик') and action = 'deleted'), 'draft>deleted', 'DEL1 журнал хранит «до» и «после»');
select is((select count(*)::int from club_event_log where event_id = t_ev('Пустой черновик')), 2, 'DEL1 прежняя запись created сохранилась');

-- ===== DEL5. повтор =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_delete_draft(t_ev('Пустой черновик')) ->> 'applied')::boolean, false, 'DEL5 повтор: applied=false');
reset role;
select is((select count(*)::int from club_event_log where event_id = t_ev('Пустой черновик') and action = 'deleted'), 1, 'DEL5 повтор не пишет в журнал');

-- ===== DEL2/DEL3. остальное удалить нельзя =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_delete_draft(t_ev('Активное'))$$, '55000', 'only draft can be deleted', 'DEL2 активное нельзя');
select throws_ok($$select club_event_delete_draft(t_ev('Завершённое'))$$, '55000', 'only draft can be deleted', 'DEL2 завершённое нельзя');
select throws_ok($$select club_event_delete_draft(t_ev('Отменённое'))$$, '55000', 'only draft can be deleted', 'DEL2 отменённое нельзя');
select throws_ok($$select club_event_delete_draft(t_ev('Черновик с записью'))$$, '55000', 'event has participants', 'DEL3 черновик с активной записью нельзя');
select throws_ok($$select club_event_delete_draft(t_ev('Черновик с отменённой записью'))$$, '55000', 'event has participants', 'DEL3 черновик с отменённой записью нельзя');
select throws_ok($$select club_event_delete_draft('00000000-0000-0000-0000-0000000000ff')$$, 'P0002', null, 'DEL6 несуществующее: не найдено');
reset role;
select is((select string_agg(status, ',' order by name collate "C") from club_events where name in ('Активное', 'Завершённое', 'Отменённое', 'Черновик с записью', 'Черновик с отменённой записью')), 'active,finished,cancelled,draft,draft'::text, 'DEL2/DEL3 статусы после отказов не изменились') ;

-- ===== DEL4. скрытое мероприятие не меняется =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_update(t_ev('Пустой черновик'), '{"name": "Новое"}'::jsonb)$$, '55000', null, 'DEL4 правка скрытого отклонена');
select throws_ok($$select club_event_set_status(t_ev('Пустой черновик'), 'active')$$, '55000', null, 'DEL4 активация скрытого отклонена');
select throws_ok($$select club_event_participant_add(t_ev('Пустой черновик'), '00000000-0000-0000-0000-000000000d01')$$, '55000', null, 'DEL4 запись игрока в скрытое отклонена');
select throws_ok($$select club_event_group_add(t_ev('Пустой черновик'), '00000000-0000-0000-0000-0000000000e1')$$, '55000', null, 'DEL4 добавление группы в скрытое отклонено');
select throws_ok($$select club_event_pay(t_ev('Пустой черновик'), '00000000-0000-0000-0000-000000000d01', 5, 'Наличные', null, gen_random_uuid())$$, '55000', null, 'DEL4 платёж по скрытому отклонён');
reset role;
select is((select count(*)::int from club_event_participants where event_id = t_ev('Пустой черновик')), 0, 'DEL4 у скрытого нет участников');
select is((select name from club_events where id = t_ev('Пустой черновик')), 'Пустой черновик', 'DEL4 название не изменилось');

-- ===== DEL7. защита строки =====
select as_owner_with_jwt('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$delete from club_events where name = 'Пустой черновик'$$, 'P0001', null, 'DEL7 физическое удаление запрещено');
select throws_ok($$update club_events set status = 'draft' where name = 'Пустой черновик'$$, '55000', null, 'DEL7 статус deleted необратим');
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ===== DEL9. остальные списки не пострадали =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from jsonb_array_elements(club_event_list()) x), 6, 'DEL9 в списке остальные шесть мероприятий клуба (скрытое и чужое не видны)');
select lives_ok($$select club_event_delete_draft(t_ev('Второй пустой'))$$, 'DEL1 второй пустой черновик скрыт');
select is((select count(*)::int from jsonb_array_elements(club_event_list()) x), 5, 'DEL9 теперь пять');
reset role;

select * from finish();
rollback;
