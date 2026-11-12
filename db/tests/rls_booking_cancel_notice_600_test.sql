-- pgTAP: уведомление администратору об отмене записи, дополнительные проверки (issue #600, реализация 0174).
-- Условия: docs/BOOKING_CANCEL_NOTICE_600_ACCEPTANCE.md. Даты относительные, от текущего дня по Тбилиси.
begin;
create extension if not exists pgtap;
select plan(47);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9711, 'Админ 1', true),
  ('00000000-0000-0000-0000-0000000000a2', 9712, 'Админ 2', true),
  ('00000000-0000-0000-0000-0000000000a3', 9713, 'Админ 3 (уведомления выключены)', true),
  ('00000000-0000-0000-0000-0000000000b1', 9714, 'Родитель 1 (двое детей)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9715, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 9716, 'Родитель 3 (в очереди)', false);
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000a3';
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b3', 'test', now());
insert into club_settings (club_id, key, value, scope) values
  ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c001', 'ind.capIndividual', '1', '');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
-- число уведомлений об отмене
create or replace function cn() returns int language sql as $$ select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%' $$;

-- занятия (вместимость индивидуальной 1): i1 Аня (неоплачена, Боря в очереди), i2 Гриша (оплачена),
-- g1 вратарская Аня и Гриша, x1 дополнительная Вера (оплачена 30), f1..f3 для ошибок отмены
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 3, '19:00', false, 'Тема 1');
insert into ids select 'i2', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 4, '19:00', false, 'Тема 2');
insert into ids select 'g1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 5, '19:00', true, 'Вратари');
insert into ids select 'x1', extra_create_session((now() at time zone 'Asia/Tbilisi')::date + 6, 20, 'Поле');
select extra_set_time((select id from ids where k = 'x1'), '18:30', '19:30');
insert into ids select 'f1', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 7, '19:00', false, 'Ошибки 1');
insert into ids select 'f2', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 8, '19:00', false, 'Ошибки 2');
insert into ids select 'f3', ind_create_session((now() at time zone 'Asia/Tbilisi')::date + 9, '19:00', false, 'Ошибки 3');
reset role;

-- запись родителями: текст о новой записи одинаков для всех видов
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_signup('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, 'запись Ани на индивидуальную');
select lives_ok($$select booking_signup('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d002')$$, 'запись Гриши на индивидуальную');
select lives_ok($$select booking_signup('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d001')$$, 'запись Ани на вратарскую');
select lives_ok($$select booking_signup('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d002')$$, 'запись Гриши на ту же вратарскую');
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select booking_signup('extra', (select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d003')$$, 'запись Веры на дополнительную');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Запись на занятие:%'
           and text not in ('Запись на занятие: Аня. Откройте приложение: Ещё → Индивидуальные.',
                            'Запись на занятие: Гриша. Откройте приложение: Ещё → Индивидуальные.',
                            'Запись на занятие: Вера. Откройте приложение: Ещё → Индивидуальные.')), 0,
          'текст о новой записи одинаков для индивидуальной, вратарской и дополнительной');
select is((select count(*)::int from notifications where text like '%Индивидуальные / Дополнительные%'), 0, 'устаревшего «Индивидуальные / Дополнительные» нет');
select is((select count(*)::int from notifications where kind = 'booking' and text = 'Запись на занятие: Вера. Откройте приложение: Ещё → Индивидуальные.'), 2,
          'о записи Веры: по одному каждому администратору с включёнными уведомлениями');

-- оплаты: Гриша на i2 (по цене занятия), Вера на x1 (30)
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_set_paid((select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d002', true, 'Наличные');
select extra_set_paid((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d003', true, 'Наличные', 30);
select ind_add_player((select id from ids where k = 'f1'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'f2'), '00000000-0000-0000-0000-00000000d001');
select ind_add_player((select id from ids where k = 'f3'), '00000000-0000-0000-0000-00000000d001');
select ind_set_attended((select id from ids where k = 'f2'), '00000000-0000-0000-0000-00000000d001', true);
reset role;
update individual_sessions set starts_at = (now() at time zone 'Asia/Tbilisi') - interval '1 hour' where id = (select id from ids where k = 'f3');
create temp table snap as select (select count(*) from service_payments)::int as n, (select coalesce(sum(amount), 0) from service_payments) as total,
  (select amount from individual_bookings where session_id = (select id from ids where k = 'i2') and player_id = '00000000-0000-0000-0000-00000000d002') as i2_amount;
select ok((select i2_amount from snap) > 0, 'оплаченная индивидуальная: сумма оплаты больше нуля');

-- очередь ожидания: на i1 мест нет, Боря встаёт в очередь
select as_user('00000000-0000-0000-0000-0000000000b3');
select lives_ok($$select waitlist_join('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004')$$, 'Боря встаёт в очередь на занятое i1');
reset role;

-- 4. неуспешные отмены: ни уведомления, ни изменений
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'чужого ребёнка не отменить');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'f2'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'attendance marked', 'посещаемость отмечена: отмены нет');
select throws_ok($$select booking_cancel('individual', (select id from ids where k = 'f3'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'session already started', 'занятие началось: отмены нет');
select throws_ok($$select booking_cancel('camp', (select id from ids where k = 'f1'), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'bad kind', 'неверный вид занятия');
select throws_ok($$select booking_cancel('goalkeeper', (select id from ids where k = 'f1'), '00000000-0000-0000-0000-00000000d001')$$, 'P0002', 'booking not found', 'вид не совпадает с занятием');
reset role;
select is(cn(), 0, 'после пяти неуспешных отмен уведомлений об отмене нет');
select is((select count(*)::int from booking_cancellations), 0, 'после неуспешных отмен строк отмены нет');
select is((select count(*)::int from individual_bookings where session_id in (select id from ids where k in ('i1', 'f2', 'f3', 'f1'))), 4, 'записи после неуспешных отмен на месте');

-- 7. неоплаченная индивидуальная Ани на i1 (вместимость 1, Боря в очереди)
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001')$$, 'отмена неоплаченной записи Ани');
reset role;
select is(cn(), 2, 'одна отмена: два уведомления, по одному на каждого администратора с включёнными уведомлениями');
select is((select array_agg(user_id order by user_id) from notifications where kind = 'booking' and text like 'Отмена записи%'),
          array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2']::uuid[], 'получатели: только администраторы 1 и 2');
select is((select status || '/' || amount from booking_cancellations where session_id = (select id from ids where k = 'i1')), 'cancelled/0.00', 'неоплаченная: статус «Отменена», сумма 0');
select is((select count(*)::int from individual_bookings where session_id = (select id from ids where k = 'i1')), 0, 'место на i1 освободилось');
select is((select count(*)::int from notifications where kind = 'waitlist_offer' and user_id = '00000000-0000-0000-0000-0000000000b3'), 1, 'родитель из очереди получил одно прежнее сообщение о свободном месте');
select is((select count(*)::int from notifications where kind = 'waitlist_offer'), 1, 'других сообщений очереди нет');
select is((select count(*)::int from booking_waitlist where player_id = '00000000-0000-0000-0000-00000000d004'), 1, 'очередь от отмены не меняется');
select as_user('00000000-0000-0000-0000-0000000000b3');
select lives_ok($$select waitlist_claim('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004')$$, 'место занимается из очереди как раньше');
reset role;

-- 6. оплаченная индивидуальная Гриши
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('individual', (select id from ids where k = 'i2'), '00000000-0000-0000-0000-00000000d002')$$, 'отмена оплаченной записи Гриши');
reset role;
select is((select status from booking_cancellations where session_id = (select id from ids where k = 'i2')), 'awaiting', 'оплаченная индивидуальная: ждёт решения');
select is((select amount from booking_cancellations where session_id = (select id from ids where k = 'i2')), (select i2_amount from snap), 'оплаченная индивидуальная: сумма отмены равна оплате');
select is(cn(), 4, 'вторая отмена: ещё по одному каждому администратору');

-- 5. двое детей одной семьи на одной вратарской
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d001')$$, 'отмена вратарской записи Ани');
reset role;
select is((select count(*)::int from individual_bookings where session_id = (select id from ids where k = 'g1') and player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'запись Гриши на ту же вратарскую осталась');
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select booking_cancel('goalkeeper', (select id from ids where k = 'g1'), '00000000-0000-0000-0000-00000000d002')$$, 'отмена вратарской записи Гриши');
reset role;
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи на занятие: Аня, Вратарская тренировка%'), 2, 'вратарская Ани: по одному на администратора, с её именем');
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи на занятие: Гриша, Вратарская тренировка%'), 2, 'вратарская Гриши: по одному на администратора, с его именем');

-- 6. оплаченная дополнительная Веры (30)
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select booking_cancel('extra', (select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d003')$$, 'отмена оплаченной дополнительной Веры');
reset role;
select is((select status || '/' || amount from booking_cancellations where session_id = (select id from ids where k = 'x1')), 'awaiting/30.00', 'оплаченная дополнительная: ждёт решения, сумма 30');
select is((select count(*)::int from extra_bookings where session_id = (select id from ids where k = 'x1')), 0, 'место на дополнительной освободилось');
select is((select count(*)::int from service_payments), (select n from snap), 'журнал оплат: число строк не изменилось');
select is((select coalesce(sum(amount), 0) from service_payments), (select total from snap), 'журнал оплат: сумма не изменилась');

-- 1–3. итог: пять отмен, ровно одно уведомление на администратора на отмену, без дублей
select is(cn(), 10, 'пять успешных отмен: десять уведомлений (5 × 2 администратора)');
select is((select count(*)::int from (select user_id, text from notifications where kind = 'booking' and text like 'Отмена записи%' group by 1, 2 having count(*) > 1) d), 0, 'ни у одного администратора нет дубля');
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%' and user_id = '00000000-0000-0000-0000-0000000000a1'), 5, 'у администратора 1 ровно пять');
select is((select count(*)::int from notifications where text like 'Отмена записи%' and user_id not in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')), 0,
          'ни родители, ни администратор с выключенными уведомлениями уведомлений об отмене не получили');
select is((select count(*)::int from notifications where kind = 'booking' and text like 'Отмена записи%' and player_ids is not null), 0, 'уведомление об отмене общее (player_ids пусто), проверка согласий его не глушит');
select is((select count(*)::int from booking_cancellations), 5, 'пять строк отмены, по одной на успешную отмену');

select * from finish();
rollback;
