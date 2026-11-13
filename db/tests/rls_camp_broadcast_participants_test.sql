-- pgTAP: рассылка «записанным на сбор» (0187, аудит C-07, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 69-71).
-- Фикстура как в rls_camp_broadcasts_test.sql.
begin;
create extension if not exists pgtap;
select plan(31);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9951, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000a2', 9952, 'Второй админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9953, 'Родитель двоих (долг)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9954, 'Родитель оплатившего', false),
  ('00000000-0000-0000-0000-0000000000b3', 9955, 'Родитель неучастника', false),
  ('00000000-0000-0000-0000-0000000000b4', 9956, 'Гость подтверждённый (долг)', false),
  ('00000000-0000-0000-0000-0000000000b5', 9957, 'Родитель с выключенными уведомлениями', false),
  ('00000000-0000-0000-0000-0000000000b6', 9958, 'Родитель с отозванным согласием', false),
  ('00000000-0000-0000-0000-0000000000b7', 9959, 'Второй родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b8', 9960, 'Родитель отменившего', false),
  ('00000000-0000-0000-0000-0000000000b9', 9961, 'Родитель из чужого клуба', false),
  ('00000000-0000-0000-0000-0000000000ba', 9962, 'Родитель неактивного игрока', false),
  ('00000000-0000-0000-0000-0000000000c1', 9963, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000d1', 9964, 'Локальный админ', false);
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b5';
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вася', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', 'Гена', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', 'Дима', 'active'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', 'Егор', 'active'),
  ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-00000000c001', 'Женя', 'active'),
  ('00000000-0000-0000-0000-00000000d008', '00000000-0000-0000-0000-00000000c002', 'Зоя', 'active'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c001', 'Игорь', 'inactive');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b7', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b3', 'test', now()),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000b5', 'test', now()),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000b6', 'test', now()),
  ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000000b8', 'test', now()),
  ('00000000-0000-0000-0000-00000000d008', '00000000-0000-0000-0000-0000000000b9', 'test', now()),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-0000000000ba', 'test', now());
insert into camps (id, club_id, name, location, starts_on, ends_on, full_payment_deadline) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10', '2098-12-20'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c001', 'Сбор без срока', 'Исани', '2099-02-03', '2099-02-10', null);
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000cb', 'Другой', 500, true);
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'camps.notify', 'on', '');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
grant execute on function as_user(uuid), as_service() to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated, service_role;
create or replace function nq(u uuid, k text) returns int language sql security definer as $$
  select count(*)::int from notifications where kind = k and user_id = u
$$;
create or replace function ntext(u uuid, k text) returns text language sql security definer as $$
  select string_agg(text, E'\n---\n' order by created_at, id) from notifications where kind = k and user_id = u
$$;
create or replace function nall(k text) returns int language sql security definer as $$
  select count(*)::int from notifications where kind = k
$$;
create or replace function bsend(cid uuid, k text, b text, n int) returns jsonb language plpgsql as $$
begin
  return camp_broadcast_send(cid, k, b, n, camp_broadcast_preview(cid, k, b)->>'token');
end $$;
grant execute on function nq(uuid, text), ntext(uuid, text), nall(text), bsend(uuid, text, text, int) to public;

-- Участники сбора: Аня и Боря (родитель b1; у Ани есть второй родитель b7), Вася оплачен полностью (b2), Дима (b5, уведомления выключены),
-- Егор (b6, согласие отозвано), Женя отменён (b8), гость подтверждён (b4). Частичная оплата: Аня 400 из 1000.
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'anya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', null);
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'vasya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b5');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b6');
select camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000b8');
select camp_parent_cancel(camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000000e1', null));
select as_user('00000000-0000-0000-0000-0000000000b4');
select camp_apply('00000000-0000-0000-0000-0000000000ca', 'Гость Петров', '2015-01-01', 'Папа', '555 11 11 11', '00000000-0000-0000-0000-0000000000e1', null);
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_application_decide((select id from camp_applications where child_name = 'Гость Петров'), true, null);
select camp_pay((select id from ids where k = 'anya'), 400, 'payment', current_date, 'cash', null);
select camp_pay((select id from ids where k = 'vasya'), 1000, 'payment', current_date, 'cash', null);
reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b6';
delete from notifications;

-- ===== 39. Кто может: только администратор =====
create or replace function npids(u uuid, k text) returns uuid[] language sql security definer as $$
  select player_ids from notifications where kind = k and user_id = u
$$;
grant execute on function npids(uuid, text) to public;
-- Участник другого сбора того же клуба: его родитель (b3, Гена) не получатель
reset role;
insert into camps (id, club_id, name, location, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000c001', 'Летний сбор', 'Исани', '2099-07-03', '2099-07-10');
insert into camp_tariffs (id, camp_id, name, price, active) values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000cc', 'Лето', 100, true);
select as_user('00000000-0000-0000-0000-0000000000b3');
select camp_parent_register('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000e3', null);
reset role;
delete from notifications;

-- ===== 70. Права =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'participants', 'Текст')$$, '42501', 'forbidden', 'родитель предпросмотр не открывает');
select throws_ok($$select bsend('00000000-0000-0000-0000-0000000000ca', 'participants', 'Текст', 1)$$, '42501', 'forbidden', 'родитель не отправляет');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'participants', 'Текст')$$, '42501', 'forbidden', 'локальный администратор не отправляет');

-- ===== 69. Состав =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'participants', '   ')$$, '22023', 'bad text', 'текст обязателен');
select throws_ok($$select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'other', 'Текст')$$, '22023', 'bad kind', 'неизвестный вид отклоняется');
create temp table pv as select camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'participants', 'Сбор в 9:00 у стадиона.') as j;
select is((select (j->>'recipients')::int from pv), 4, 'получатели: родитель двоих, второй родитель Ани, родитель Васи, владелец гостевой записи');
select is((select string_agg(x->>'name', ',' order by x->>'name') from pv, jsonb_array_elements(j->'list') x),
          'Второй родитель Ани,Гость подтверждённый (долг),Родитель двоих (долг),Родитель оплатившего', 'список получателей поимённо');
select is((select string_agg((x->>'name') || ':' || (x->>'reason'), ',') from pv, jsonb_array_elements(j->'blocked') x),
          'Родитель с выключенными уведомлениями:notifications_off', 'недоступный показан с причиной');
select is((select j->>'sample' from pv), E'Сбор «Зимний сбор»:\nСбор в 9:00 у стадиона.', 'текст сообщения без имён детей и сумм');
select is((select (j->>'unreachable')::int from pv), 2, 'записанных, до семьи которых не дойдёт: Дима (уведомления выключены) и Егор (нет доступа)');
select is((camp_broadcast_preview('00000000-0000-0000-0000-0000000000ca', 'info', 'Сбор в 9:00 у стадиона.')->>'recipients')::int, 5,
          'рассылка всем родителям клуба прежняя (гостям не уходит, родитель неучастника получает)');

-- ===== 70. Отправка =====
select throws_ok($$select bsend('00000000-0000-0000-0000-0000000000ca', 'participants', 'Сбор в 9:00 у стадиона.', 5)$$, '22023', 'recipients changed', 'неверное число получателей: отправки нет');
select is(nall('camp_broadcast_participants'), 0, 'предпросмотр и отказ ничего не ставят');
select is((bsend('00000000-0000-0000-0000-0000000000ca', 'participants', 'Сбор в 9:00 у стадиона.', 4)->>'recipients')::int, 4, 'отправка четырём');
select is(nall('camp_broadcast_participants'), 4, 'в очереди четыре сообщения');
select is(nq('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_participants'), 1, 'родитель двоих детей получает одно сообщение');
select is(nq('00000000-0000-0000-0000-0000000000b7', 'camp_broadcast_participants'), 1, 'второй родитель получает своё');
select is(nq('00000000-0000-0000-0000-0000000000b4', 'camp_broadcast_participants'), 1, 'владелец гостевой записи получает');
select is(nq('00000000-0000-0000-0000-0000000000b3', 'camp_broadcast_participants'), 0, 'родитель участника другого сбора не получает');
select is(nq('00000000-0000-0000-0000-0000000000b8', 'camp_broadcast_participants'), 0, 'отменивший запись не получает');
select is(nq('00000000-0000-0000-0000-0000000000b6', 'camp_broadcast_participants'), 0, 'родитель без доступа к ребёнку не получает');
select is(nq('00000000-0000-0000-0000-0000000000b9', 'camp_broadcast_participants'), 0, 'родитель из чужого клуба не получает');
select is(nq('00000000-0000-0000-0000-0000000000b5', 'camp_broadcast_participants'), 0, 'родитель с выключенными уведомлениями не получает');
select is(ntext('00000000-0000-0000-0000-0000000000b2', 'camp_broadcast_participants'), E'Сбор «Зимний сбор»:\nСбор в 9:00 у стадиона.', 'текст сообщения');
select is((select array_agg(x order by x) from unnest(npids('00000000-0000-0000-0000-0000000000b1', 'camp_broadcast_participants')) x),
          array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[], 'в строке очереди дети получателя на сборе (проверка согласия при выдаче)');
select is(npids('00000000-0000-0000-0000-0000000000b4', 'camp_broadcast_participants'), null::uuid[], 'у владельца только гостевой записи список детей пустой');
select throws_ok($$select bsend('00000000-0000-0000-0000-0000000000ca', 'participants', 'Сбор в 9:00 у стадиона.', 4)$$, '22023', 'duplicate broadcast', 'тот же текст повторно в течение десяти минут не уходит');
select is((select kind || '|' || body || '|' || recipients from camp_broadcast_list('00000000-0000-0000-0000-0000000000ca') where kind = 'participants'),
          'participants|Сбор в 9:00 у стадиона.|4', 'журнал: вид, текст, число получателей');

-- ===== Проверка согласия при выдаче (0176) =====
reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b7';
select as_service();
select count(*) from claim_notifications(50);
reset role;
select is((select state || '|' || last_error from notifications where kind = 'camp_broadcast_participants' and user_id = '00000000-0000-0000-0000-0000000000b7'),
          'skipped|consent', 'доступ к ребёнку снят после постановки: сообщение не выдаётся');
select is((select state from notifications where kind = 'camp_broadcast_participants' and user_id = '00000000-0000-0000-0000-0000000000b4'),
          'pending', 'сообщение владельцу гостевой записи выдаётся (общее, без проверки детей)');

-- ===== Уведомления по сборам выключены =====
update club_settings set value = 'off' where key = 'camps.notify';
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select bsend('00000000-0000-0000-0000-0000000000ca', 'participants', 'Другой текст', 3)$$, '22023', 'notifications off', 'при выключенных уведомлениях по сборам отправки нет');

select * from finish();
rollback;
