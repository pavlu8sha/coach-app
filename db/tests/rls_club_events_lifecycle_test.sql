-- pgTAP: раздел «Мероприятия», этап 1 (0201, Issue #677, docs/CLUB_EVENTS_ACCEPTANCE.md v6): мероприятие, группы, статусы,
-- базовая цена с историей, права, один клуб. Тесты написаны до миграции: на master они красные.
-- Права проверяются на базе с привилегиями по умолчанию Supabase: объекты раздела пересоздаются при выключенных умолчаниях и включённых.
begin;
create extension if not exists pgtap;
select plan(156);

-- чистая пересборка объектов раздела при привилегиях по умолчанию Supabase
drop table if exists club_event_price_log, club_event_log, club_event_groups, club_events cascade;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0201_club_events.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000a2', 8802, 'Второй админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8803, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8804, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000d1', 8805, 'Локальный админ', false),
  ('00000000-0000-0000-0000-0000000000e0', 8806, 'Без прав', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U13-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());

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

-- ===== ACL4. права на объекты (при умолчаниях Supabase) =====
select ok(has_function_privilege('authenticated', 'club_event_create(text,text,date,time,text,numeric,timestamp,integer,uuid[],text)', 'execute'), 'ACL4 authenticated вызывает club_event_create');
select ok(not has_function_privilege('anon', 'club_event_create(text,text,date,time,text,numeric,timestamp,integer,uuid[],text)', 'execute'), 'ACL4 anon не вызывает club_event_create');
select ok(not has_function_privilege('public', 'club_event_create(text,text,date,time,text,numeric,timestamp,integer,uuid[],text)', 'execute'), 'ACL4 public не вызывает club_event_create');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'club\_event\_%'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'ACL4 ни одна функция club_event_* не доступна anon и public');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('club_event_assert_admin', 'club_event_guard', 'club_event_log_add', 'club_event_isolation_ok')
              and has_function_privilege('authenticated', p.oid, 'execute')), 0, 'ACL4 служебные функции недоступны authenticated');
select is((select count(*)::int from (values ('club_events'), ('club_event_groups'), ('club_event_log'), ('club_event_price_log')) t(n)
            where has_table_privilege('anon', 'public.' || n, 'select') or has_table_privilege('authenticated', 'public.' || n, 'insert')
               or has_table_privilege('authenticated', 'public.' || n, 'update') or has_table_privilege('authenticated', 'public.' || n, 'delete')
               or has_table_privilege('service_role', 'public.' || n, 'insert') or has_table_privilege('service_role', 'public.' || n, 'update')
               or has_table_privilege('service_role', 'public.' || n, 'delete')), 0, 'ACL3/ACL5 таблицы: anon без чтения, authenticated и service_role без записи');
select ok(has_table_privilege('authenticated', 'public.club_events', 'select') and has_table_privilege('service_role', 'public.club_events', 'select'), 'ACL2/ACL5 чтение таблицы выдано authenticated (через RLS) и service_role');

-- ===== ACL1. создавать и менять может только админ =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select club_event_create('Пикник', null, '2026-12-01', '12:00', 'Парк', 10, null, null, null, 'draft')$$, '42501', 'forbidden', 'ACL1 тренер не создаёт мероприятие');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select club_event_create('Пикник', null, '2026-12-01', '12:00', 'Парк', 10, null, null, null, 'draft')$$, '42501', 'forbidden', 'ACL1 родитель не создаёт');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select club_event_create('Пикник', null, '2026-12-01', '12:00', 'Парк', 10, null, null, null, 'draft')$$, '42501', 'forbidden', 'ACL1 локальный админ не создаёт');
select as_user('00000000-0000-0000-0000-0000000000e0');
select throws_ok($$select club_event_create('Пикник', null, '2026-12-01', '12:00', 'Парк', 10, null, null, null, 'draft')$$, '42501', 'forbidden', 'ACL6 пользователь без is_admin не создаёт');
select as_anon();
select throws_ok($$select club_event_create('Пикник', null, '2026-12-01', '12:00', 'Парк', 10, null, null, null, 'draft')$$, '42501', null, 'ACL1 anon не создаёт');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from club_events), 0, 'ACL1 после отказов мероприятий нет');

-- ===== EV1–EV3. создание =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_create('Теория', 'Тактика', '2026-12-05', '15:00', 'Класс', 0, null, null, null, 'draft')$$, 'EV1/PR13 админ создаёт черновик с ценой 0 без групп');
select lives_ok($$select club_event_create('Пикник', null, '2026-12-06', '12:00', 'Парк', 15.50, '2026-12-04 18:00', 20, array['00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e1']::uuid[], 'active')$$, 'EV1/EV3 админ создаёт активное с дедлайном, лимитом и группами (дубль группы в списке)');
reset role;
select is((select status from club_events where name = 'Теория'), 'draft', 'EV1 статус черновик');
select is((select status from club_events where name = 'Пикник'), 'active', 'EV1 статус активное');
select is((select club_id from club_events where name = 'Пикник'), '00000000-0000-0000-0000-00000000c001'::uuid, 'ISO1 club_id выставлен сервером');
select is((select starts_on::text || ' ' || starts_time::text from club_events where name = 'Пикник'), '2026-12-06 12:00:00', 'EV11 дата и время хранятся как введено (местное, Тбилиси)');
select is((select count(*)::int from club_event_groups g join club_events e on e.id = g.event_id where e.name = 'Пикник'), 2, 'EV3 две группы без дубля');
select is((select count(*)::int from club_event_groups g join club_events e on e.id = g.event_id where e.name = 'Теория'), 0, 'EV3 без групп = общеклубное');
select is((select count(*)::int from club_event_log where action = 'created'), 2, 'EV9 создание записано в журнал изменений');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (club_event_get((select id from club_events where name = 'Теория')) ->> 'club_wide')::boolean), true, 'EV3 get: общеклубное');
select is((select (club_event_get((select id from club_events where name = 'Пикник')) ->> 'club_wide')::boolean), false, 'EV3 get: по группам');

-- EV2. неверные данные
select throws_ok($$select club_event_create('', null, '2026-12-01', '12:00', null, 1, null, null, null, 'draft')$$, '22023', null, 'EV2 пустое название');
select throws_ok($$select club_event_create('   ', null, '2026-12-01', '12:00', null, 1, null, null, null, 'draft')$$, '22023', null, 'EV2 название из пробелов');
select throws_ok($$select club_event_create('Х', null, '2026-12-01', '12:00', null, -1, null, null, null, 'draft')$$, '22023', null, 'EV2/PR8 отрицательная цена');
select throws_ok($$select club_event_create('Х', null, '2026-12-01', '12:00', null, null, null, null, null, 'draft')$$, '22023', null, 'EV2 цена не задана');
select throws_ok($$select club_event_create('Х', null, '2026-12-01', '12:00', null, 1.005, null, null, null, 'draft')$$, '22023', null, 'PR8 цена с тремя знаками');
select throws_ok($$select club_event_create('Х', null, null, null, null, 1, null, null, null, 'draft')$$, '22023', null, 'EV2 дата-время не заданы');
select throws_ok($$select club_event_create('Х', null, '2026-12-01', '12:00', null, 1, null, null, null, 'finished')$$, '22023', null, 'EV2 создать сразу завершённым нельзя');
select throws_ok($$select club_event_create('Х', null, '2026-12-01', '12:00', null, 1, null, 0, null, 'draft')$$, '22023', null, 'LD5 лимит 0');
select throws_ok($$select club_event_create('Х', null, '2026-12-01', '12:00', null, 1, null, -3, null, 'draft')$$, '22023', null, 'LD5 лимит отрицательный');
select throws_ok($$select club_event_create('Х', null, '2026-12-01', '12:00', null, 1, null, null, array['00000000-0000-0000-0000-0000000000ff']::uuid[], 'draft')$$, 'P0002', null, 'EV3 несуществующая группа');
reset role;
select is((select count(*)::int from club_events), 2, 'EV2 после отказов лишних мероприятий нет');

-- ===== EV4. переходы статусов =====
create temp table ids on commit drop as select
  (select id from club_events where name = 'Теория') as draft_id,
  (select id from club_events where name = 'Пикник') as active_id;
grant all on ids to authenticated;
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_set_status((select draft_id from ids), 'active')$$, 'EV4 черновик → активное');
select lives_ok($$select club_event_set_status((select draft_id from ids), 'cancelled')$$, 'EV4 активное → отменённое');
select lives_ok($$select club_event_set_status((select draft_id from ids), 'active')$$, 'EV4/EV7 отменённое → активное (реактивация)');
select lives_ok($$select club_event_set_status((select draft_id from ids), 'finished')$$, 'EV4 активное → завершённое');
select throws_ok($$select club_event_set_status((select draft_id from ids), 'active')$$, '55000', null, 'EV4 завершённое → активное нельзя');
select throws_ok($$select club_event_set_status((select draft_id from ids), 'draft')$$, '55000', null, 'EV4 завершённое → черновик нельзя');
select throws_ok($$select club_event_set_status((select draft_id from ids), 'cancelled')$$, '55000', null, 'EV4 завершённое → отменённое нельзя');
select throws_ok($$select club_event_set_status((select active_id from ids), 'draft')$$, '55000', null, 'EV4 активное → черновик нельзя');
select throws_ok($$select club_event_set_status((select active_id from ids), 'active')$$, '55000', null, 'EV4 активное → активное нельзя');
select lives_ok($$select club_event_set_status((select active_id from ids), 'cancelled')$$, 'EV4 активное → отменённое (пикник)');
select throws_ok($$select club_event_set_status((select active_id from ids), 'finished')$$, '55000', null, 'EV4 отменённое → завершённое нельзя');
select throws_ok($$select club_event_set_status((select active_id from ids), 'draft')$$, '55000', null, 'EV4 отменённое → черновик нельзя');
select throws_ok($$select club_event_set_status((select active_id from ids), 'cancelled')$$, '55000', null, 'EV4 отменённое → отменённое нельзя');
select throws_ok($$select club_event_set_status((select active_id from ids), 'bogus')$$, '22023', null, 'EV4 неизвестный статус');
select throws_ok($$select club_event_set_status('00000000-0000-0000-0000-0000000000ff', 'active')$$, 'P0002', null, 'EV4 мероприятие не найдено');
select lives_ok($$select club_event_set_status((select active_id from ids), 'active')$$, 'EV7 пикник реактивирован');
reset role;
-- P1: черновик → отменённое запрещён; отменить можно только активное
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_create('Черновик остаётся', null, '2026-12-11', null, null, 5, null, null, null, 'draft')$$, 'EV12 создан черновик');
select throws_ok($$select club_event_set_status((select id from club_events where name = 'Черновик остаётся'), 'cancelled')$$, '55000', null, 'EV4/P1 черновик → отменённое нельзя');
select throws_ok($$select club_event_set_status((select id from club_events where name = 'Черновик остаётся'), 'finished')$$, '55000', null, 'EV4 черновик → завершённое нельзя');
select lives_ok($$select club_event_set_status(club_event_create('Отмена до начала', null, '2026-12-10', '10:00', null, 5, null, null, null, 'active'), 'cancelled')$$, 'EV4 активное → отменённое (отдельное мероприятие)');
reset role;
select is((select count(*)::int from club_event_log where action = 'status'), 7, 'EV9 каждый успешный переход записан в журнал (7 переходов)');

-- ===== EV6. завершение только вручную =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_create('Давно прошло', null, '2020-01-01', '10:00', null, 5, null, null, null, 'active')$$, 'EV6 активное мероприятие с датой в прошлом создаётся');
reset role;
select is((select status from club_events where name = 'Давно прошло'), 'active', 'EV6 статус сам не меняется после даты');

-- ===== EV9/PR. редактирование и цена =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((club_event_update((select active_id from ids), '{"name": "Пикник 2", "description": "Новое", "place": "Лес", "signup_deadline": null, "capacity": 25}'::jsonb) ->> 'applied')::boolean, true, 'EV9 правка названия, описания, места, дедлайна, лимита');
reset role;
select is((select name || '|' || coalesce(place, '') || '|' || coalesce(signup_deadline::text, '-') || '|' || capacity from club_events where id = (select active_id from ids)), 'Пикник 2|Лес|-|25', 'EV9 поля изменились, дедлайн очищен');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_update((select draft_id from ids), '{"name": "Теория (завершена)"}'::jsonb)$$, 'EV9 правка завершённого мероприятия разрешена');
select lives_ok($$select club_event_update((select draft_id from ids), '{"place": "Зал"}'::jsonb)$$, 'EV9 правка места завершённого');
select lives_ok($$select club_event_update((select id from club_events where name = 'Отмена до начала'), '{"place": "Дом"}'::jsonb)$$, 'EV9 правка отменённого мероприятия разрешена');
select lives_ok($$select club_event_update((select active_id from ids), jsonb_build_object('starts_on', '2026-12-07', 'starts_time', '13:30', 'group_ids', jsonb_build_array('00000000-0000-0000-0000-0000000000e2')))$$, 'EV9 смена даты, времени и групп');
reset role;
select is((select starts_on::text || ' ' || starts_time::text from club_events where id = (select active_id from ids)), '2026-12-07 13:30:00', 'EV9 дата и время изменены');
select is((select array_agg(group_id)::text from club_event_groups where event_id = (select active_id from ids)), '{00000000-0000-0000-0000-0000000000e2}', 'EV9 группы заменены');
select ok((select count(*) from club_event_log where action = 'updated' and event_id = (select active_id from ids)) >= 2, 'EV9 правки записаны в журнал (до и после)');
select ok((select (before ->> 'name') = 'Пикник' and (after ->> 'name') = 'Пикник 2' from club_event_log where action = 'updated' and event_id = (select active_id from ids) order by at, id limit 1), 'EV9 журнал хранит прежнее и новое значение');

select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_update((select active_id from ids), '{"name": ""}'::jsonb)$$, '22023', null, 'EV2 правка: пустое название');
select throws_ok($$select club_event_update((select active_id from ids), '{"capacity": 0}'::jsonb)$$, '22023', null, 'LD5 правка: лимит 0');
select lives_ok($$select club_event_update((select active_id from ids), '{"capacity": null}'::jsonb)$$, 'LD1 лимит можно снять');
select throws_ok($$select club_event_update((select active_id from ids), '{"unknown_field": 1}'::jsonb)$$, '22023', null, 'EV9 неизвестное поле отклоняется');
select throws_ok($$select club_event_update((select active_id from ids), '{"status": "finished"}'::jsonb)$$, '22023', null, 'EV4 статус меняется только club_event_set_status, не правкой');
select throws_ok($$select club_event_update((select active_id from ids), '{"base_price": "abc"}'::jsonb, 'причина')$$, '22023', null, 'PR8 цена не число');
select throws_ok($$select club_event_update((select active_id from ids), '{"base_price": -5}'::jsonb, 'причина')$$, '22023', null, 'PR8 цена отрицательная');
select throws_ok($$select club_event_update((select active_id from ids), '{"base_price": 10.001}'::jsonb, 'причина')$$, '22023', null, 'PR8 цена с тремя знаками');
select throws_ok($$select club_event_update((select active_id from ids), '{"base_price": 20}'::jsonb)$$, '22023', null, 'PR4 цена без причины');
select throws_ok($$select club_event_update((select active_id from ids), '{"base_price": 20}'::jsonb, '  ')$$, '22023', null, 'PR4 причина из пробелов');
select throws_ok($$select club_event_update((select active_id from ids), '{"base_price": 20}'::jsonb, 'ab')$$, '22023', null, 'PR4 причина 2 символа');
reset role;
select is((select base_price from club_events where id = (select active_id from ids)), 15.50::numeric, 'PR4/PR8 после отказов цена не изменилась');
select is((select count(*)::int from club_event_price_log), 0, 'PR4 после отказов истории цен нет');

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_update((select active_id from ids), '{"base_price": 20}'::jsonb, 'Подорожал автобус')$$, 'PR5 смена базовой цены с причиной');
select lives_ok($$select club_event_update((select active_id from ids), '{"base_price": 20}'::jsonb)$$, 'PR10 то же значение: причина не нужна');
select lives_ok($$select club_event_update((select draft_id from ids), '{"base_price": 3}'::jsonb, 'Исправили цену')$$, 'PR9 цену завершённого можно менять с причиной');
reset role;
select is((select count(*)::int from club_event_price_log), 2, 'PR5/PR10 в истории две строки (повтор не пишет)');
select ok((select old_amount = 15.50 and new_amount = 20 and reason = 'Подорожал автобус' and scope = 'base' and actor_id = '00000000-0000-0000-0000-0000000000a1' and at is not null
             from club_event_price_log where event_id = (select active_id from ids)), 'PR5 история: было, стало, причина, автор, время');
select is((select base_price from club_events where id = (select active_id from ids)), 20::numeric, 'PR1 базовая цена обновлена');

-- ===== ACL1/ACL2. права на чтение и правки =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select club_event_update((select active_id from ids), '{"name": "Взлом"}'::jsonb)$$, '42501', 'forbidden', 'ACL1 тренер не правит');
select throws_ok($$select club_event_set_status((select active_id from ids), 'cancelled')$$, '42501', 'forbidden', 'ACL1 тренер не меняет статус');
select throws_ok($$select club_event_list(null)$$, '42501', 'forbidden', 'ACL2 тренер не читает список');
select throws_ok($$select club_event_get((select active_id from ids))$$, '42501', 'forbidden', 'ACL2 тренер не читает карточку');
select throws_ok($$select club_event_history((select active_id from ids))$$, '42501', 'forbidden', 'ACL2 тренер не читает историю');
select is((select count(*)::int from club_events), 0, 'ACL2 тренер прямым запросом не видит мероприятий (RLS)');
select is((select count(*)::int from club_event_price_log) + (select count(*)::int from club_event_log) + (select count(*)::int from club_event_groups), 0, 'ACL2 тренер не видит журналы и группы');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select club_event_list(null)$$, '42501', 'forbidden', 'ACL2 родитель не читает список');
select is((select count(*)::int from club_events), 0, 'ACL2 родитель прямым запросом не видит мероприятий');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select club_event_list(null)$$, '42501', 'forbidden', 'ACL2 локальный админ не читает список');
select is((select count(*)::int from club_events), 0, 'ACL2 локальный админ прямым запросом не видит');
select as_anon();
select throws_ok($$select club_event_list(null)$$, '42501', null, 'ACL2 anon не читает список');
select throws_ok($$select count(*) from club_events$$, '42501', null, 'ACL4 anon без права на таблицу');
reset role;
select set_config('request.jwt.claims', '', true);

-- ===== ACL3. прямая запись запрещена, в том числе админу =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$insert into club_events (club_id, name, starts_on, base_price) values ('00000000-0000-0000-0000-00000000c001', 'Прямо', current_date, 1)$$, '42501', null, 'ACL3 админ не вставляет напрямую');
select throws_ok($$update club_events set name = 'Прямо'$$, '42501', null, 'ACL3 админ не обновляет напрямую');
select throws_ok($$delete from club_events$$, '42501', null, 'ACL3/EV5 админ не удаляет напрямую');
select throws_ok($$insert into club_event_price_log (event_id, scope, new_amount, reason) values ((select active_id from ids), 'base', 1, 'руками')$$, '42501', null, 'ACL3 история цен не пишется напрямую');
select is((select count(*)::int from club_events), 5, 'ACL2 админ читает таблицу напрямую (5 мероприятий)');
select is(jsonb_array_length(club_event_list(null)), 5, 'ACL2 админ: список из 5');
reset role;

-- ===== EV5/HIST2. удаление и правка истории запрещены и владельцу таблиц =====
select throws_ok($$delete from club_events$$, 'P0001', null, 'EV5 DELETE мероприятий отклонён триггером');
select throws_ok($$truncate club_events cascade$$, 'P0001', null, 'EV5 TRUNCATE мероприятий отклонён');
select throws_ok($$delete from club_event_log$$, 'P0001', null, 'HIST2 журнал изменений не удаляется');
select throws_ok($$update club_event_log set action = 'x'$$, 'P0001', null, 'HIST2 журнал изменений не правится');
select throws_ok($$delete from club_event_price_log$$, 'P0001', null, 'HIST2 история цен не удаляется');
select throws_ok($$update club_event_price_log set reason = 'иначе'$$, 'P0001', null, 'HIST2 история цен не правится');
select throws_ok($$truncate club_event_price_log$$, 'P0001', null, 'HIST2 TRUNCATE истории цен отклонён');
select is((select count(*)::int from pg_proc where proname in ('club_event_delete', 'club_event_remove', 'club_event_purge')), 0, 'EV5 функций удаления мероприятия нет');
-- ISO2/клуб меняется только функцией, не правкой данных
select is((select count(*)::int from club_events where club_id <> '00000000-0000-0000-0000-00000000c001'), 0, 'ISO1 все мероприятия в клубе Клуб');

-- ===== ACL7/NOSIDE. отдельность от событий-турниров =====
select is((select count(*)::int from pg_proc where proname like 'club\_event\_%' and (prosrc like '%is_any_coach%' or prosrc like '%event_assert_staff%' or prosrc like '%tournaments%')), 0, 'ACL7/T1 функции раздела не используют тренерские проверки и tournaments');
select is((select count(*)::int from tournaments), 0, 'NOSIDE2 таблица tournaments не затронута');

-- ===== EV2/EV9/EV13. время необязательно =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_create('Без времени', null, '2026-12-20', null, null, 7, null, null, null, 'active')$$, 'EV2 создание без времени');
select is((club_event_get((select id from club_events where name = 'Без времени')) ->> 'starts_time'), null, 'EV2 время не указано: null, не 00:00');
select lives_ok($$select club_event_update((select id from club_events where name = 'Без времени'), '{"starts_time": "09:30"}'::jsonb)$$, 'EV9 время добавляется правкой');
select lives_ok($$select club_event_update((select id from club_events where name = 'Без времени'), '{"starts_time": null}'::jsonb)$$, 'EV9 время очищается');
select is((club_event_get((select id from club_events where name = 'Без времени')) ->> 'starts_time'), null, 'EV9 после очистки время null, не 00:00');
select throws_ok($$select club_event_update((select id from club_events where name = 'Без времени'), '{"starts_on": null}'::jsonb)$$, '22023', null, 'EV2 дату очистить нельзя');
select throws_ok($$select club_event_update((select id from club_events where name = 'Без времени'), '{"starts_time": "25:99"}'::jsonb)$$, '22023', null, 'EV9 неверное время');
select is((select count(*)::int from club_event_log where event_id = (select id from club_events where name = 'Без времени') and action = 'updated'), 2, 'EV9 добавление и очистка времени записаны в журнал');
-- EV13: открытые (черновик, активное) сверху по ближайшей дате, завершённые и отменённые ниже
select is((select string_agg(x ->> 'name', '|' order by ord) from jsonb_array_elements(club_event_list(null)) with ordinality t(x, ord)),
  'Давно прошло|Пикник 2|Черновик остаётся|Без времени|Отмена до начала|Теория (завершена)', 'EV13 порядок списка: открытые по дате, затем завершённые и отменённые');
reset role;

-- ===== ISO. клубная изоляция (P16, RLS и запрет по умолчанию) =====
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000c002', 'U13-A');
-- ISO5: два клуба, у админов нет users.club_id: раздел закрыт
select is(club_event_isolation_ok(), false, 'ISO9 сторож: клубов два, у админов нет club_id: красный');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_event_create('Два клуба', null, '2026-12-01', null, null, 1, null, null, null, 'draft')$$, '42501', 'club not determined', 'ISO5 два клуба без club_id: создание закрыто');
select throws_ok($$select club_event_list(null)$$, '42501', 'club not determined', 'ISO5 список закрыт');
select throws_ok($$select club_event_get((select id from club_events where name = 'Пикник 2'))$$, '42501', 'club not determined', 'ISO5 карточка закрыта');
select throws_ok($$select club_event_update((select id from club_events where name = 'Пикник 2'), '{"place": "Х"}'::jsonb)$$, '42501', 'club not determined', 'ISO5 правка закрыта');
select throws_ok($$select club_event_set_status((select id from club_events where name = 'Пикник 2'), 'cancelled')$$, '42501', 'club not determined', 'ISO5 смена статуса закрыта');
select is((select count(*)::int from club_events), 0, 'ISO5 прямое чтение таблицы (RLS) закрыто');
reset role;
-- ISO4: club_id админов выставлен
update users set club_id = '00000000-0000-0000-0000-00000000c001' where id = '00000000-0000-0000-0000-0000000000a1';
update users set club_id = '00000000-0000-0000-0000-00000000c002' where id = '00000000-0000-0000-0000-0000000000a2';
select is(club_event_isolation_ok(), true, 'ISO9 сторож зелёный: у всех админов club_id задан');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_event_get((select id from club_events where name = 'Пикник 2'))$$, 'ISO4 А1 читает мероприятие своего клуба');
select lives_ok($$select club_event_update((select id from club_events where name = 'Пикник 2'), '{"place": "Другое место"}'::jsonb)$$, 'ISO4 А1 правит своё');
select throws_ok($$select club_event_update((select id from club_events where name = 'Пикник 2'), '{"group_ids": ["00000000-0000-0000-0000-0000000000e9"]}'::jsonb)$$, '22023', null, 'ISO2 группа другого клуба отклоняется');
select throws_ok($$select club_event_create('Чужая группа', null, '2026-12-01', null, null, 1, null, null, array['00000000-0000-0000-0000-0000000000e9']::uuid[], 'draft')$$, '22023', null, 'ISO2 создание с группой другого клуба отклоняется');
select is((select count(*)::int from club_events), 6, 'ISO4 А1 прямым чтением видит только свой клуб (6)');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a2');
select is(jsonb_array_length(club_event_list(null)), 0, 'ISO4 А2 в списке не видит мероприятий клуба 1');
select is((select count(*)::int from club_events), 0, 'ISO4 А2 прямым чтением не видит клуб 1');
select is((select count(*)::int from club_event_log) + (select count(*)::int from club_event_price_log) + (select count(*)::int from club_event_groups), 0, 'ISO4 А2 не видит журналы и группы клуба 1');
select lives_ok($$select club_event_create('Клуб 2', null, '2026-12-02', null, null, 3, null, null, array['00000000-0000-0000-0000-0000000000e9']::uuid[], 'active')$$, 'ISO4 А2 создаёт мероприятие в клубе 2');
select is(jsonb_array_length(club_event_list(null)), 1, 'ISO4 А2 видит только своё (1)');
reset role;
select is((select club_id from club_events where name = 'Клуб 2'), '00000000-0000-0000-0000-00000000c002'::uuid, 'ISO1 клуб мероприятия берётся у вызывающего, не от клиента');
-- чужое мероприятие по id: отказ 42501 во всех функциях
select as_user('00000000-0000-0000-0000-0000000000a2');
reset role;
create temp table ids3 on commit drop as select (select id from club_events where name = 'Пикник 2') as other_id;
grant all on ids3 to authenticated;
select as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select club_event_get((select other_id from ids3))$$, '42501', 'forbidden', 'ISO4 А2: get чужого мероприятия');
select throws_ok($$select club_event_history((select other_id from ids3))$$, '42501', 'forbidden', 'ISO4 А2: history чужого');
select throws_ok($$select club_event_update((select other_id from ids3), '{"place": "Взлом"}'::jsonb)$$, '42501', 'forbidden', 'ISO4 А2: update чужого');
select throws_ok($$select club_event_set_status((select other_id from ids3), 'cancelled')$$, '42501', 'forbidden', 'ISO4 А2: смена статуса чужого');
-- ISO6: club_id пользователь сам не меняет
select lives_ok($q$do $x$ begin begin update users set club_id = '00000000-0000-0000-0000-00000000c001' where id = '00000000-0000-0000-0000-0000000000a2'; exception when others then null; end; end $x$$q$, 'ISO6 попытка сменить свой club_id не падает тестом');
reset role;
select is((select club_id from users where id = '00000000-0000-0000-0000-0000000000a2'), '00000000-0000-0000-0000-00000000c002'::uuid, 'ISO6 users.club_id пользователем не меняется');
-- ISO10: тренер, родитель, локальный админ и при двух клубах закрыты
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select club_event_list(null)$$, '42501', null, 'ISO10 тренер закрыт и при двух клубах');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select club_event_list(null)$$, '42501', null, 'ISO10 локальный админ закрыт и при двух клубах');
reset role;
-- ISO8: тела функций раздела не используют глобальный is_admin() без клуба
select is((select count(*)::int from pg_proc where proname in ('club_event_create', 'club_event_update', 'club_event_set_status', 'club_event_list', 'club_event_get', 'club_event_history')
             and prosrc not like '%club_event_assert_admin%'), 0, 'ISO8 каждая функция раздела проверяет админа и клуб через club_event_assert_admin');
select is((select count(*)::int from pg_policies where tablename like 'club\_event%' and qual not like '%club_event_current_club%'), 0, 'ISO8 каждая политика таблиц раздела проверяет клуб');
-- clean up second club
select is(club_event_isolation_ok(), true, 'ISO9 сторож остаётся зелёным');


select * from finish();
rollback;
