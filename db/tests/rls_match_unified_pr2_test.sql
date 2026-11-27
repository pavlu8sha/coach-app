-- pgTAP: единый экран матча, PR 2 (0227): тренер не отменяет и не переносит матч, не меняет время опубликованного; save_match не принимает результат у черновика и отменённого.
-- Условия: docs/MATCH_UNIFIED_SCREEN_PR2_ACCEPTANCE.md. Фикстуры вымышленные. Права проверяются при умолчаниях Supabase.
begin;
create extension if not exists pgtap;
select plan(35);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0227_match_unified_pr2.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А'), ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 7951, 'Админ А', true,  '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c1', 7952, 'Тренер А', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c2', 7953, 'Тренер Б', false, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000b1', 7954, 'Родитель', false, null);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U12'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000c002', 'U12');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2', 'active');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create or replace function mid(k text) returns uuid language sql stable as $$ select v from ids where ids.k = mid.k $$;
grant execute on function mid(text) to authenticated;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. права на выполнение при умолчаниях Supabase
select ok(has_function_privilege('authenticated', 'match_rsvp_cancel(uuid, text)', 'execute') and not has_function_privilege('anon', 'match_rsvp_cancel(uuid, text)', 'execute') and not has_function_privilege('public', 'match_rsvp_cancel(uuid, text)', 'execute'), 'match_rsvp_cancel: authenticated да, anon и public нет');
select ok(has_function_privilege('authenticated', 'match_rsvp_reschedule(uuid, timestamptz, text, text)', 'execute') and not has_function_privilege('anon', 'match_rsvp_reschedule(uuid, timestamptz, text, text)', 'execute'), 'match_rsvp_reschedule: authenticated да, anon нет');
select ok(has_function_privilege('authenticated', 'match_rsvp_update(uuid, jsonb)', 'execute') and not has_function_privilege('anon', 'match_rsvp_update(uuid, jsonb)', 'execute'), 'match_rsvp_update: authenticated да, anon нет');
select ok(has_function_privilege('authenticated', 'save_match(uuid, uuid, date, text, int, int, jsonb)', 'execute') and not has_function_privilege('anon', 'save_match(uuid, uuid, date, text, int, int, jsonb)', 'execute'), 'save_match: authenticated да, anon нет');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']) from pg_proc p where p.oid in (to_regprocedure('match_rsvp_cancel(uuid,text)'), to_regprocedure('match_rsvp_reschedule(uuid,timestamptz,text,text)'), to_regprocedure('match_rsvp_update(uuid,jsonb)'), to_regprocedure('save_match(uuid,uuid,date,text,integer,integer,jsonb)'))), 'четыре функции: security definer и search_path с pg_temp');

-- 2. публикуем матч тренером (создание и состав остаются за тренером)
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'p', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Динамо', now() + interval '5 days', 'Стадион', 'Адрес', null)$$, 'тренер создаёт черновик');
select lives_ok($$select match_rsvp_invite(mid('p'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[])$$, 'тренер приглашает игроков');
-- черновик: тренер правит время, как раньше
select lives_ok($$select match_rsvp_update(mid('p'), jsonb_build_object('starts_at', now() + interval '5 days 1 hour'))$$, 'у черновика тренер меняет время');
select lives_ok($$select match_rsvp_publish(mid('p'))$$, 'тренер публикует матч');

-- 3. результат черновика не принимается; опубликованный (до начала) принимается
select lives_ok($$insert into ids select 'd', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U12', 'Черновик-соперник', now() + interval '6 days', null, null, null)$$, 'второй черновик создан');
select throws_ok($$select save_match(mid('d'), '00000000-0000-0000-0000-0000000000e1', current_date, 'Черновик-соперник', null, null, '[]'::jsonb)$$, '55000', 'match is a draft', 'save_match у черновика отклоняется');
select throws_ok($$select save_match_tech(mid('d'), '00000000-0000-0000-0000-0000000000e1', null, current_date, 'Черновик-соперник', null, null, '[]'::jsonb, false)$$, '55000', 'match is a draft', 'save_match_tech у черновика отклоняется');
select lives_ok($$select save_match(mid('p'), '00000000-0000-0000-0000-0000000000e1', current_date, 'Динамо', null, null, '[]'::jsonb)$$, 'опубликованный матч принимает отметки (поведение не меняется)');

-- 4. тренер: правка полей разрешена, смена времени опубликованного нет
select lives_ok($$select match_rsvp_update(mid('p'), '{"opponent": "Торпедо", "notes": "Форма синяя"}'::jsonb)$$, 'тренер правит соперника и заметки опубликованного матча');
select throws_ok($$select match_rsvp_update(mid('p'), jsonb_build_object('starts_at', now() + interval '5 days 2 hours'))$$, '42501', 'only admin can cancel or reschedule', 'тренер не меняет время опубликованного матча');
select lives_ok($$select match_rsvp_update(mid('p'), jsonb_build_object('starts_at', (select starts_at from matches where id = mid('p'))))$$, 'то же время (без изменения) не считается переносом');
select throws_ok($$select match_rsvp_reschedule(mid('p'), now() + interval '7 days')$$, '42501', 'only admin can cancel or reschedule', 'тренер не переносит матч');
select throws_ok($$select match_rsvp_cancel(mid('p'), 'Дождь')$$, '42501', 'only admin can cancel or reschedule', 'тренер не отменяет матч');
select is((select lifecycle_status from matches where id = mid('p')), 'published', 'матч остался опубликованным');

-- 5. чужой клуб: прежняя ошибка forbidden
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select match_rsvp_cancel(mid('p'), 'x')$$, '42501', 'forbidden', 'тренер чужого клуба: forbidden');
select throws_ok($$select match_rsvp_reschedule(mid('p'), now() + interval '7 days')$$, '42501', 'forbidden', 'тренер чужого клуба не переносит');
select throws_ok($$select save_match(mid('p'), '00000000-0000-0000-0000-0000000000e9', current_date, 'Торпедо', null, null, '[]'::jsonb)$$, '42501', null, 'тренер чужого клуба не сохраняет результат');

-- 6. родитель
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_cancel(mid('p'), 'x')$$, '42501', null, 'родитель не отменяет');
select throws_ok($$select match_rsvp_reschedule(mid('p'), now() + interval '7 days')$$, '42501', null, 'родитель не переносит');

-- 7. администратор: прежнее поведение
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select match_rsvp_update(mid('p'), jsonb_build_object('starts_at', now() + interval '5 days 3 hours'))$$, 'администратор меняет время в пределах дня');
select lives_ok($$select match_rsvp_reschedule(mid('p'), now() + interval '8 days')$$, 'администратор переносит матч');
select is((select rescheduled_count from matches where id = mid('p')), 1, 'перенос записан');
select lives_ok($$select match_rsvp_cancel(mid('p'), 'Дождь')$$, 'администратор отменяет матч');
select is((select lifecycle_status from matches where id = mid('p')), 'cancelled', 'матч отменён');
select throws_ok($$select save_match(mid('p'), '00000000-0000-0000-0000-0000000000e1', current_date, 'Торпедо', null, null, '[]'::jsonb)$$, '55000', 'match is cancelled', 'save_match у отменённого матча отклоняется (администратор тоже)');
select throws_ok($$select save_match_tech(mid('p'), '00000000-0000-0000-0000-0000000000e1', null, current_date, 'Торпедо', null, null, '[]'::jsonb, true)$$, '55000', 'match is cancelled', 'save_match_tech у отменённого матча отклоняется');
-- администратор удаляет черновик как раньше
select lives_ok($$select match_rsvp_delete_draft(mid('d'))$$, 'черновик удаляется как раньше');

-- 8. матч без подтверждения (legacy) сохраняется как раньше
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into ids select 'l', save_match(null, '00000000-0000-0000-0000-0000000000e1', current_date - 1, 'Старый-соперник', 2, 1, '[]'::jsonb)$$, 'новый обычный матч создаётся');
select lives_ok($$select save_match(mid('l'), '00000000-0000-0000-0000-0000000000e1', current_date - 1, 'Старый-соперник', 3, 1, '[]'::jsonb)$$, 'обычный матч правится');
select is((select goals_for from matches where id = mid('l')), 3, 'счёт обычного матча обновлён');

select * from finish();
rollback;
