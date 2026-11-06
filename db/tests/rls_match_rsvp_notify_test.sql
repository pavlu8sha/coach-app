-- pgTAP: уведомления о матчах с кнопками «Будет» / «Не будет», автонапоминания и ответ по Telegram (миграция 0137, Issue #274, PR 2b).
begin;
create extension if not exists pgtap;
select plan(39);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000c1', 7002, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7004, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 7005, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 7006, 'Родитель 3', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Сидоров Иван', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Павел', 'active'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Поздний Игрок', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b1', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b3', 't', now(), null),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000b3', 't', now(), null);

delete from notifications; -- уведомление о назначении тренера из подготовки данных
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon, service_role;
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '', true); -- ответ по Telegram ставит sub на время своей транзакции; в тесте одна транзакция
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function mid(k text) returns uuid language sql stable as $$ select v from ids where ids.k = mid.k $$;
create or replace function inv_of(m uuid, p uuid) returns uuid language sql stable as $$ select id from match_invitations where match_id = m and player_id = p $$;
grant execute on function as_user(uuid), mid(text), inv_of(uuid, uuid) to authenticated, anon, service_role;

-- ---------- черновик: тишина; публикация: приглашения ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'm1', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Олимп', now() + interval '5 days', 'Стадион', 'ул. Мира 1', 'Форма синяя');
select match_rsvp_invite(mid('m1'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d005']::uuid[]);
reset role; set constraints all immediate; set constraints all deferred;
select is((select string_agg(kind, ',') from notifications), null, 'черновик и состав уведомлений не создают');
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_publish(mid('m1'));
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_invite'), 3, 'публикация: по одному сообщению каждому из трёх родителей');
select is((select jsonb_array_length(buttons) from notifications where user_id = '00000000-0000-0000-0000-0000000000b1'), 2, 'у родителя двух детей две пары кнопок');
select is((select jsonb_array_length(buttons) from notifications where user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'у второго родителя одного ребёнка одна пара кнопок');
select is((select buttons->0->0->>'data' from notifications where user_id = '00000000-0000-0000-0000-0000000000b2'),
  'r:' || inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d001') || ':y', 'кнопка «Будет» несёт номер приглашения');
select is((select buttons->0->1->>'text' from notifications where user_id = '00000000-0000-0000-0000-0000000000b2'), 'Пётр: Не будет', 'подпись кнопки с именем ребёнка');
select ok((select text from notifications where user_id = '00000000-0000-0000-0000-0000000000b2') like '%Олимп%Стадион%Форма синяя%Иванов Пётр%', 'в тексте соперник, место, заметка и ребёнок');
select ok((select text from notifications where user_id = '00000000-0000-0000-0000-0000000000b1') like '%Иванов Павел%' and (select text from notifications where user_id = '00000000-0000-0000-0000-0000000000b1') like '%Иванов Пётр%', 'родитель двух детей видит обоих в одном сообщении');
select ok((select length('r:' || gen_random_uuid() || ':y')) <= 64, 'данные кнопки укладываются в лимит Telegram (64 байта)');

-- ---------- ответ по нажатию кнопки ----------
select set_config('role', 'service_role', true);
select is((select rsvp_answer_by_telegram(7004, inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d001'), 'yes')->>'ok'), 'true', 'родитель отвечает через бота');
reset role; set constraints all immediate; set constraints all deferred;
select is((select response || ':' || responded_by::text from match_invitations where match_id = mid('m1') and player_id = '00000000-0000-0000-0000-00000000d001'),
  'yes:00000000-0000-0000-0000-0000000000b1', 'ответ записан, автор — этот родитель');
select set_config('role', 'service_role', true);
select is((select rsvp_answer_by_telegram(7005, inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d001'), 'no')->>'ok'), 'true', 'второй родитель меняет общий ответ');
select is((select rsvp_answer_by_telegram(7006, inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d001'), 'yes')->>'code'), 'forbidden', 'чужой родитель за чужого ребёнка не отвечает');
select is((select rsvp_answer_by_telegram(9999, inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d001'), 'yes')->>'code'), 'unknown_user', 'неизвестный Telegram-аккаунт отклонён');
select is((select rsvp_answer_by_telegram(7004, gen_random_uuid(), 'yes')->>'code'), 'not_found', 'несуществующее приглашение');
select is((select rsvp_answer_by_telegram(7004, inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d005'), 'maybe')->>'code'), 'bad_request', 'неверный ответ отклонён');
reset role; set constraints all immediate; set constraints all deferred;
select is((select response from match_invitations where match_id = mid('m1') and player_id = '00000000-0000-0000-0000-00000000d001'), 'no', 'неудачные попытки ответ не меняют');

-- ---------- напоминания: ручное ставит сообщение только не ответившим ----------
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_remind_unanswered(mid('m1'));
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_reminder'), 2, 'напоминание получили родители не ответивших детей (родитель 1 и родитель 3)');
select is((select jsonb_array_length(buttons) from notifications where kind = 'rsvp_reminder' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'в напоминании только не ответивший ребёнок');
select ok((select text from notifications where kind = 'rsvp_reminder' and user_id = '00000000-0000-0000-0000-0000000000b1') not like '%Иванов Пётр%', 'ответивший ребёнок в напоминании не упомянут');

-- ---------- автонапоминания ----------
select set_config('role', 'service_role', true);
select is(rsvp_auto_reminders(), 0, 'приглашение только что отправлено: автонапоминаний нет (матч через 5 дней)');
reset role; set constraints all immediate; set constraints all deferred;
delete from match_reminder_log;
delete from notifications;
-- матч через 40 часов, приглашение было вчера
select as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'm2', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Динамо', now() + interval '40 hours', null, null, null);
select match_rsvp_invite(mid('m2'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[]);
select match_rsvp_publish(mid('m2'));
reset role; set constraints all immediate; set constraints all deferred;
delete from notifications;
select set_config('role', 'service_role', true);
select is(rsvp_auto_reminders(), 0, 'приглашение отправлено меньше 12 часов назад: автонапоминания нет');
reset role; set constraints all immediate; set constraints all deferred;
update matches set published_at = now() - interval '13 hours' where id = mid('m2');
select set_config('role', 'service_role', true);
select is(rsvp_auto_reminders(), 3, 'за 40 часов: напоминания трём родителям, не ответившим за детей (b1, b2 по Иванову, b3)');
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(distinct kind)::int from match_reminder_log where match_id = mid('m2')), 1, 'вид один');
select is((select kind from match_reminder_log where match_id = mid('m2') limit 1), 'auto_48h', 'вид auto_48h');
select set_config('role', 'service_role', true);
select is(rsvp_auto_reminders(), 0, 'повторный запуск cron дублей не создаёт');
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from match_reminder_log where recipient_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'родитель получил одно напоминание за сутки');

-- ---------- перенос и отмена ----------
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_reschedule(mid('m1'), now() + interval '7 days', 'Новый стадион', null);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_reschedule'), 3, 'перенос: сообщения всем родителям');
select ok((select bool_and(buttons is not null) from notifications where kind = 'rsvp_reschedule'), 'в сообщении о переносе есть кнопки');
select ok((select text like '%Прежние ответы сброшены%' from notifications where kind = 'rsvp_reschedule' limit 1), 'сказано, что ответы сброшены');
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_cancel(mid('m1'), 'Дождь');
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_cancel'), 3, 'отмена: сообщения всем родителям');
select ok((select bool_and(buttons is null) from notifications where kind = 'rsvp_cancel'), 'в сообщении об отмене кнопок ответа нет');
select ok((select bool_and(text like '%Причина: Дождь%') from notifications where kind = 'rsvp_cancel'), 'причина отмены в тексте');
select set_config('role', 'service_role', true);
select is((select rsvp_answer_by_telegram(7004, inv_of(mid('m1'), '00000000-0000-0000-0000-00000000d001'), 'yes')->>'code'), 'closed', 'по кнопке из старого сообщения отменённый матч не принимает ответ');
reset role; set constraints all immediate; set constraints all deferred;

-- ---------- поздно приглашённый, отключённые уведомления ----------
delete from notifications;
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b3';
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_invite(mid('m2'), array['00000000-0000-0000-0000-00000000d006']::uuid[]);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications), 0, 'родитель с отключёнными уведомлениями сообщений не получает');
update users set notifications_enabled = true where id = '00000000-0000-0000-0000-0000000000b3';
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_remove(mid('m2'), array['00000000-0000-0000-0000-00000000d006']::uuid[]);
select match_rsvp_invite(mid('m2'), array['00000000-0000-0000-0000-00000000d006']::uuid[]);
reset role; set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from notifications where kind = 'rsvp_invite' and user_id = '00000000-0000-0000-0000-0000000000b3'), 1, 'вернули игрока в опубликованный матч: приглашение его родителю');

-- ---------- права и отправитель ----------
select set_config('role', 'service_role', true);
select ok((select bool_or(buttons is not null) from claim_notifications(10)), 'отправитель получает кнопки вместе с текстом');
reset role; set constraints all immediate; set constraints all deferred;
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select rsvp_answer_by_telegram(7004, gen_random_uuid(), 'yes')$$, '42501', null, 'родитель не вызывает ответ по Telegram напрямую');
select throws_ok($$select rsvp_auto_reminders()$$, '42501', null, 'родитель не запускает автонапоминания');

select * from finish();
rollback;
