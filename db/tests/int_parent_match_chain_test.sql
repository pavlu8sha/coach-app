-- Интеграционный сценарий: матч (RSVP) на стыке с записью на тренировки и уведомлениями.
-- Уведомления и жизненный цикл RSVP по отдельности проверены в rls_match_rsvp*_test.sql; здесь проверяется,
-- что ответ родителя, перенос и отмена матча согласованно меняют пересечения при записи на индивидуальные,
-- «Мои матчи» родителя и состав у тренера, а неуспешные действия ничего не ставят в очередь уведомлений.
-- Данные вымышленные; время матча и занятий в 12:00/18:00 по Тбилиси через 5 дней (не зависит от времени суток прогона).
begin;
create extension if not exists pgtap;
select plan(23);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9921, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9922, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000b1', 9923, 'Родитель 1 (Аня U9 и Гриша U11)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9924, 'Родитель 2 (Боря U9)', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create temp table nsnap (n int);
grant all on nsnap to authenticated;
create or replace function n_mark() returns void language sql as $$ delete from nsnap; insert into nsnap select count(*)::int from notifications $$;
create or replace function n_new() returns int language sql as $$ select (select count(*)::int from notifications) - (select n from nsnap) $$;
create or replace function day5() returns date language sql stable as $$ select (now() at time zone 'Asia/Tbilisi')::date + 5 $$;
create or replace function conflicts(sess text, p uuid) returns text language sql as $$
  select coalesce(string_agg(kind, ',' order by kind), '') from booking_conflicts('individual', (select id from ids where k = sess), p) $$;
grant execute on function day5(), conflicts(text, uuid) to authenticated;

-- матч U9 в 12:00, индивидуальные в 12:00 и 18:00 того же дня
select as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'm', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Соперник', (day5() + time '12:00') at time zone 'Asia/Tbilisi', 'Поле', null, null, null);
select match_rsvp_seed((select id from ids where k = 'm'), '00000000-0000-0000-0000-0000000000e1');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i12', ind_create_session(day5(), '12:00', false, 'Полдень', '13:00');
insert into ids select 'i18', ind_create_session(day5(), '18:00', false, 'Вечер', '19:00');

-- ===== 1. Черновик матча не влияет на родителя =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(conflicts('i12', '00000000-0000-0000-0000-00000000d001'), '', 'черновик матча не даёт пересечения при записи');
select is((select count(*)::int from match_rsvp_my_matches()), 0, 'черновик не виден в «Моих матчах»');
select throws_ok($$select match_rsvp_answer((select id from ids where k = 'm'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, '42501', 'forbidden', 'на черновик ответить нельзя');

-- ===== 2. Публикация: пересечение у приглашённого ребёнка, не у брата из другой группы =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_publish((select id from ids where k = 'm'));
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(conflicts('i12', '00000000-0000-0000-0000-00000000d001'), 'match', 'опубликованный матч: запись на индивидуальную в то же время показывает пересечение');
select is(conflicts('i12', '00000000-0000-0000-0000-00000000d002'), '', 'у брата из другой группы (не приглашён) пересечения нет');
select is(conflicts('i18', '00000000-0000-0000-0000-00000000d001'), '', 'занятие в другое время того же дня не пересекается');

-- ===== 3. Ответ родителя меняет пересечение; родитель отвечает только за своих =====
select match_rsvp_answer((select id from ids where k = 'm'), '00000000-0000-0000-0000-00000000d001', 'no');
select is(conflicts('i12', '00000000-0000-0000-0000-00000000d001'), '', 'ответ «не будет»: матч больше не мешает записи');
select match_rsvp_answer((select id from ids where k = 'm'), '00000000-0000-0000-0000-00000000d001', 'yes');
select is(conflicts('i12', '00000000-0000-0000-0000-00000000d001'), 'match', 'ответ «будет»: пересечение вернулось');
reset role;
select n_mark();
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_answer((select id from ids where k = 'm'), '00000000-0000-0000-0000-00000000d003', 'no')$$, '42501', 'forbidden', 'за чужого ребёнка ответить нельзя');
select throws_ok($$select match_rsvp_answer((select id from ids where k = 'm'), '00000000-0000-0000-0000-00000000d002', 'yes')$$, '42501', 'forbidden', 'за своего, но не приглашённого ребёнка ответить нельзя');
select throws_ok($$select match_rsvp_cancel((select id from ids where k = 'm'), 'Хочу')$$, '42501', null, 'родитель не может отменить матч');
reset role;
select is(n_new(), 0, 'отклонённые действия родителя не поставили уведомлений');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select string_agg(full_name || ':' || coalesce(response, '-') || ':' || coalesce(responded_by_name, '-'), ',' order by full_name) from match_rsvp_roster((select id from ids where k = 'm'))),
  'Аня:yes:Родитель 1 (Аня U9 и Гриша U11),Боря:-:-', 'тренер видит ответ родителя и кто ответил; не ответивший без ответа');

-- ===== 4. Перенос: пересечение переезжает, ответы сброшены, уведомлены только приглашённые семьи =====
reset role;
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_reschedule((select id from ids where k = 'm'), (day5() + time '18:00') at time zone 'Asia/Tbilisi', null, null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(conflicts('i12', '00000000-0000-0000-0000-00000000d001') || '|' || conflicts('i18', '00000000-0000-0000-0000-00000000d001'), '|match',
  'после переноса пересечение ушло с 12:00 и появилось в 18:00');
select is((select coalesce(response, '-') || '/' || can_answer::text from match_rsvp_my_matches() where player_id = '00000000-0000-0000-0000-00000000d001'), '-/true',
  'после переноса ответ сброшен, родитель может ответить заново');
reset role;
select is((select string_agg(u.display_name, ',' order by u.display_name) from notifications n join users u on u.id = n.user_id where n.kind = 'rsvp_reschedule'),
  'Родитель 1 (Аня U9 и Гриша U11),Родитель 2 (Боря U9)', 'о переносе узнали обе приглашённые семьи, по одному сообщению');
select ok(not exists (select 1 from notifications where kind = 'rsvp_reschedule' and text like '%Гриша%'), 'в сообщении о переносе нет не приглашённого брата');

-- ===== 5. Отмена: пересечений нет, ответить нельзя, тренер и родитель видят отмену =====
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000c1');
select match_rsvp_cancel((select id from ids where k = 'm'), 'Дождь');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(conflicts('i18', '00000000-0000-0000-0000-00000000d001'), '', 'отменённый матч не мешает записи на тренировку');
select is((select lifecycle_status || '/' || can_answer::text from match_rsvp_my_matches() where player_id = '00000000-0000-0000-0000-00000000d001'), 'cancelled/false',
  'родитель видит отмену, ответить нельзя');
select throws_ok($$select match_rsvp_answer((select id from ids where k = 'm'), '00000000-0000-0000-0000-00000000d001', 'yes')$$, '55000', 'match is cancelled', 'ответ на отменённый матч отклоняется');
select lives_ok($$select booking_signup('individual', (select id from ids where k = 'i18'), '00000000-0000-0000-0000-00000000d001')$$, 'запись на тренировку в бывшее время матча проходит');
reset role;
select is((select count(*)::int from notifications where kind = 'rsvp_cancel'), 2, 'об отмене узнали обе приглашённые семьи, по одному сообщению');
select is((select count(*)::int from notifications n
            where n.player_ids is not null and exists (select 1 from unnest(n.player_ids) x(pid)
              where not exists (select 1 from player_guardians g where g.user_id = n.user_id and g.player_id = x.pid))),
  0, 'ни одно уведомление о ребёнке не ушло не его опекуну');

select * from finish();
rollback;
