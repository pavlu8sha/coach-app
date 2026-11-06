-- pgTAP: уведомления об изменении данных опубликованного матча и об исключении игрока; одно сообщение на семью за операцию (миграция 0139, Issue #274, ТЗ §6).
begin;
create extension if not exists pgtap;
select plan(21);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000c1', 7002, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7004, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 7005, 'Родитель 2', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Павел', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Сидоров Иван', 'active');
-- родитель 1: двое детей (Пётр, Павел); родитель 2: Пётр и Иван
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b1', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 't', now(), null);
delete from notifications;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon, service_role;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function mid(k text) returns uuid language sql stable as $$ select v from ids where ids.k = mid.k $$;
create or replace function inv_of(m uuid, p uuid) returns uuid language sql stable as $$ select id from match_invitations where match_id = m and player_id = p $$;
grant execute on function as_user(uuid), mid(text), inv_of(uuid, uuid) to authenticated, anon, service_role;

-- ---------- черновик: приглашения пачкой молчат; публикация ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'm1', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Олимп', (date_trunc('day', now() at time zone 'Asia/Tbilisi') + interval '5 days 12 hours') at time zone 'Asia/Tbilisi', 'Стадион', 'ул. Мира 1', null);
select match_rsvp_invite(mid('m1'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000d002']::uuid[]);
set constraints all immediate; set constraints all deferred; -- конец транзакции приглашения черновика (в тесте одна общая транзакция)
select match_rsvp_publish(mid('m1'));
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_invite'), 2, 'публикация: по одному сообщению каждому родителю');
-- родитель 1 ответил за Петра
select set_config('role', 'service_role', true);
select is((select rsvp_answer_by_telegram(7004, inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d001'), 'yes')->>'ok'), 'true', 'ответ Петра записан');
reset role; set constraints all immediate; set constraints all deferred;
delete from notifications;

-- ---------- изменение данных ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_update(mid('m1'), '{"venue": "Новый стадион", "notes": "Форма белая"}'::jsonb);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_update'), 2, 'изменение данных: сообщение каждому родителю');
select ok((select bool_and(text like '%Что изменилось:%▸ Место: Стадион → Новый стадион%▸ Заметка: не указано → Форма белая%') from notifications where kind = 'rsvp_update'), 'в тексте что именно изменилось');
select ok((select bool_and(text like '%Прежние ответы сохранены%') from notifications where kind = 'rsvp_update'), 'сказано, что ответы сохранены');
select is((select jsonb_array_length(buttons) from notifications where kind = 'rsvp_update' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'кнопки только за не ответившего ребёнка (Павел), Пётр уже ответил');
select is((select jsonb_array_length(buttons) from notifications where kind = 'rsvp_update' and user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'у второго родителя: Пётр ответил, остался Иван');
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_update(mid('m1'), '{"venue": "Новый стадион"}'::jsonb);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications), 0, 'правка без реальных изменений сообщений не создаёт');
-- время того же дня
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_update(mid('m1'), jsonb_build_object('starts_at', (select starts_at + interval '1 hour' from matches where id = mid('m1'))));
reset role; set constraints all immediate; set constraints all deferred;
select ok((select bool_and(text like '%▸ Время:%') from notifications where kind = 'rsvp_update') and (select count(*) from notifications where kind = 'rsvp_update') = 2, 'смена времени: уведомление с прежним и новым временем');
delete from notifications;

-- ---------- перенос не даёт «изменения данных» ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_reschedule(mid('m1'), now() + interval '9 days', 'Третий стадион', null);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_update'), 0, 'перенос даёт только сообщение о переносе');
select is((select count(*)::int from notifications where kind = 'rsvp_reschedule'), 2, 'сообщение о переносе каждому родителю');
delete from notifications;

-- ---------- исключение: одно сообщение на семью ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_remove(mid('m1'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d005']::uuid[]);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_removed' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'двое детей родителя 1 исключены одной операцией: одно сообщение');
select ok((select text like '%Иванов Павел, Иванов Пётр%' from notifications where kind = 'rsvp_removed' and user_id = '00000000-0000-0000-0000-0000000000b1'), 'в сообщении оба ребёнка');
select is((select count(*)::int from notifications where kind = 'rsvp_removed' and user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'второй родитель Петра тоже уведомлён');
select ok((select text like '%Иванов Пётр%' and text not like '%Сидоров%' from notifications where kind = 'rsvp_removed' and user_id = '00000000-0000-0000-0000-0000000000b2'), 'у него только исключённый ребёнок, Иван в сообщении нет');
select ok((select bool_and(buttons is null) from notifications where kind = 'rsvp_removed'), 'у сообщения об исключении кнопок ответа нет');
delete from notifications;

-- ---------- возврат двоих: одно сообщение с кнопками ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_invite(mid('m1'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d005']::uuid[]);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_invite' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'двое детей приглашены заново одной операцией: одно сообщение');
select is((select jsonb_array_length(buttons) from notifications where kind = 'rsvp_invite' and user_id = '00000000-0000-0000-0000-0000000000b1'), 2, 'две пары кнопок в одном сообщении');
select is((select count(*)::int from notifications where kind = 'rsvp_invite' and user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'второму родителю Петра приглашение только за Петра');

-- ---------- черновик и отменённый матч молчат ----------
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'm2', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Черновик', now() + interval '6 days', null, null, null);
select match_rsvp_invite(mid('m2'), array['00000000-0000-0000-0000-00000000d001']::uuid[]);
select match_rsvp_update(mid('m2'), '{"venue": "Где-то"}'::jsonb);
select match_rsvp_remove(mid('m2'), array['00000000-0000-0000-0000-00000000d001']::uuid[]);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications), 0, 'черновик: ни приглашений, ни изменений, ни исключений в сообщениях нет');
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_cancel(mid('m1'), 'Дождь');
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_cancel'), 2, 'отмена как прежде: по сообщению родителям');

select * from finish();
rollback;
