-- Интеграционный сценарий: дополнительная тренировка на стыке записи, оплаты (service_payments), долга родителя,
-- посещения, баллов, отмены тренировки и уведомлений. Плюс сверка журнала баллов (points_consistency) после цепочки.
-- Отдельные модули проверены в rls_extra_*_test.sql, rls_service_payments_test.sql, rls_points_*_test.sql.
-- Данные вымышленные; тренировка сегодня без времени (запись ещё открыта, долг уже считается).
begin;
create extension if not exists pgtap;
select plan(24);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9941, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9942, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000b1', 9943, 'Родитель 1 (Аня U9 и Гриша U11)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9944, 'Родитель 2 (Боря U9)', false),
  ('00000000-0000-0000-0000-0000000000b3', 9945, 'Родитель 3 (Дима U11)', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Дима', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b3', 'test', now());
insert into club_settings (club_id, key, value, scope) values
  ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true', '');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2020-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create or replace function x1() returns uuid language sql stable as $$ select id from ids where k = 'x1' $$;
create or replace function extra_debt(p uuid) returns text language sql as $$
  select coalesce(string_agg(due::int || '/' || paid::int || '/' || debt::int, ','), 'нет') from parent_dues() where kind = 'extra' and player_id = p $$;
grant execute on function x1(), extra_debt(uuid) to authenticated;

-- тренировка для U9 плюс персонально Гриша из U11
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'x1', extra_create_session((now() at time zone 'Asia/Tbilisi')::date, 30, 'Зал', array['00000000-0000-0000-0000-0000000000e1']::uuid[], array['00000000-0000-0000-0000-00000000d002']::uuid[]);

-- ===== 1. Целевая аудитория: кто может записаться =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_signup('extra', x1(), '00000000-0000-0000-0000-00000000d001');
select booking_signup('extra', x1(), '00000000-0000-0000-0000-00000000d002');
select as_user('00000000-0000-0000-0000-0000000000b2');
select booking_signup('extra', x1(), '00000000-0000-0000-0000-00000000d003');
select as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select booking_signup('extra', x1(), '00000000-0000-0000-0000-00000000d004')$$, '22023', 'not eligible', 'ребёнок не из целевой группы и не приглашённый лично не записывается');
select is((select count(*)::int from booking_board() where session_id = x1()), 0, 'нецелевая семья не видит тренировку на доске записи');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select eligible from booking_board() where session_id = x1()), '["00000000-0000-0000-0000-00000000d001", "00000000-0000-0000-0000-00000000d002"]'::jsonb,
  'у семьи оба ребёнка в списке допущенных (один по группе, другой лично)');
select is(extra_debt('00000000-0000-0000-0000-00000000d001') || ' ' || extra_debt('00000000-0000-0000-0000-00000000d002'), '30/0/30 30/0/30', 'после записи долг по каждому ребёнку');

-- ===== 2. Оплата: частичная, повтор, отмена оплаты, полная =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_paid(x1(), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', 20, null);
select extra_set_paid(x1(), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', 20, null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(extra_debt('00000000-0000-0000-0000-00000000d001'), '30/20/10', 'частичная оплата: остаток долга');
reset role;
select is((select count(*)::int from service_payments where player_id = '00000000-0000-0000-0000-00000000d001'), 1, 'повторная отметка оплаты не создала второй платёж');
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_paid(x1(), '00000000-0000-0000-0000-00000000d001', false, null, null, null);
select extra_set_paid(x1(), '00000000-0000-0000-0000-00000000d001', true, 'Перевод', null, null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(extra_debt('00000000-0000-0000-0000-00000000d001'), '30/30/0', 'отмена и повторная полная оплата: долга нет');
reset role;
select is((select string_agg(amount::int || ':' || method || ':' || (cancels is not null)::text, ',' order by amount) from service_payments where player_id = '00000000-0000-0000-0000-00000000d001'),
  '-20:Наличные:true,20:Наличные:false,30:Перевод:false', 'история оплат: исходная, сторно со ссылкой и новая оплата отдельными строками');
select is((select sum(amount)::int from service_payments where player_id = '00000000-0000-0000-0000-00000000d001'), 30, 'сумма по истории равна оплаченному');

-- ===== 3. Посещение и баллы, роль тренера =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select extra_set_attended(x1(), '00000000-0000-0000-0000-00000000d001', true);
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select extra_set_attended(x1(), '00000000-0000-0000-0000-00000000d002', true)$$, '42501', 'forbidden', 'родитель не отмечает посещение');
select throws_ok($$select booking_cancel('extra', x1(), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'attendance marked', 'после отметки родитель запись не отменяет');
reset role;
select is((select string_agg(pl.full_name || ':' || l.points, ',') from points_ledger l join players pl on pl.id = l.player_id where l.status = 'active'), 'Аня:2',
  'баллы получил только отмеченный ребёнок');

-- ===== 4. Отмена тренировки клубом: записи, журнал отмен, долг, уведомления =====
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select extra_cancel_session(x1(), 'Дождь')$$, '22023', 'attendance marked', 'отмена с отметкой «был» отклонена (#630); сначала снимается отметка');
select extra_set_attended(x1(), '00000000-0000-0000-0000-00000000d001', null);
select extra_cancel_session(x1(), 'Дождь');
select throws_ok($$select extra_cancel_session(x1(), 'Ещё раз')$$, '55000', 'session cancelled', 'повторная отмена отклонена');
reset role;
select is((select string_agg(pl.full_name || ':' || c.status, ',' order by pl.full_name) from booking_cancellations c join players pl on pl.id = c.player_id), 'Аня:awaiting,Боря:cancelled,Гриша:cancelled',
  'после снятия отметки все записи закрыты в журнале отмен; оплаченная Аня ждёт решения');
select is((select count(*)::int from extra_bookings where session_id = x1()), 0, 'активных записей после отмены нет');
select is((select string_agg(u.display_name || ':' || n.text, ' | ' order by u.display_name) from notifications n join users u on u.id = n.user_id where n.kind = 'booking_cancelled'),
  (select string_agg(x, ' | ' order by x) from (values
     ('Родитель 1 (Аня U9 и Гриша U11):Тренировка отменена: ' || booking_session_label('extra', x1()) || '. Причина: Дождь. Записан(ы): Аня, Гриша. Оплата, если была, сохранена: администратор свяжется с вами.'),
     ('Родитель 2 (Боря U9):Тренировка отменена: ' || booking_session_label('extra', x1()) || '. Причина: Дождь. Записан(ы): Боря. Оплата, если была, сохранена: администратор свяжется с вами.')) v(x)),
  'об отмене узнали семьи всех записей, по одному сообщению; Аня попала после снятия отметки');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-0000000000b3'), 0, 'нецелевая семья сообщений не получила');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(extra_debt('00000000-0000-0000-0000-00000000d002'), 'нет', 'после отмены тренировки долга за неё нет');
select throws_ok($$select booking_signup('extra', x1(), '00000000-0000-0000-0000-00000000d002')$$, '55000', 'session cancelled', 'на отменённую тренировку записаться нельзя');
select throws_ok($$select waitlist_join('extra', x1(), '00000000-0000-0000-0000-00000000d002')$$, '55000', 'session cancelled', 'в очередь отменённой тренировки встать нельзя');
reset role;
select is((select sum(amount)::int from service_payments where player_id = '00000000-0000-0000-0000-00000000d001'), 30, 'отмена тренировки не меняет историю оплат');

-- ===== 5. Сверка журнала баллов после всей цепочки =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (r->>'changes')::int || '/' || jsonb_array_length(r->'exceptions') from (select points_consistency(false) r) x), '0/0', 'сверка журнала баллов с источниками: расхождений и исключений нет');
reset role;
select is((select count(*)::int from notifications n
            where n.player_ids is not null and exists (select 1 from unnest(n.player_ids) x(pid)
              where not exists (select 1 from player_guardians g where g.user_id = n.user_id and g.player_id = x.pid))),
  0, 'ни одно уведомление о ребёнке не ушло не его опекуну');

select * from finish();
rollback;
