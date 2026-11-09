-- pgTAP: финансовая история сборов не удаляется и не перезаписывается (0165, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условие 3а):
-- платежи и записи участников нельзя удалить и править прямыми запросами никому, включая администратора и service_role.
begin;
create extension if not exists pgtap;
select plan(23);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000d1', 9902, 'Локальный админ', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', 'Игрок', 'active');
insert into camps (id, club_id, name, location, starts_on, ends_on, active) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Сбор', 'Исани', '2099-01-03', '2099-01-10', true),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c001', 'Пустой сбор', 'Исани', '2099-02-03', '2099-02-10', true);
insert into camp_tariffs (id, camp_id, name, price, active) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Тариф', 1000, true);

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

-- Штатные сценарии работают как раньше
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'g', camp_register_guest('00000000-0000-0000-0000-0000000000ca', 'Гость', null, '00000000-0000-0000-0000-0000000000e1', null, null, null);
insert into ids select 'p', camp_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', null, null, null);
insert into ids select 'pay', camp_pay((select id from ids where k = 'g'), 400, 'payment', current_date, 'Наличные', null);
select camp_pay((select id from ids where k = 'p'), 300, 'payment', current_date, 'Наличные', null);
select lives_ok($$select camp_cancel_payment((select id from ids where k = 'pay'))$$, 'штатная отмена платежа (запись возврата) работает');
select is((select count(*)::int from camp_payments where participant_id = (select id from ids where k = 'g')), 2, 'платёж и возврат остаются в журнале');
select is((select coalesce(sum(amount), 0) from camp_payments where participant_id = (select id from ids where k = 'g')), 0::numeric, 'сумма платежей после отмены нулевая');
select lives_ok($$select camp_update_participant((select id from ids where k = 'g'), null, 1200, null, 'комментарий', 'registered')$$, 'штатная правка участника работает');
select is((select count(*)::int from camp_payments), 3, 'администратор читает платежи');

-- Администратор: прямые запросы закрыты
select throws_ok($$delete from camp_payments where id = (select id from ids where k = 'pay')$$, '42501', null, 'администратор не удаляет платёж прямым запросом');
select throws_ok($$update camp_payments set amount = 1 where id = (select id from ids where k = 'pay')$$, '42501', null, 'администратор не правит платёж прямым запросом');
select throws_ok($$insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind) select camp_id, id, player_id, 5, current_date, 'payment' from camp_participants where id = (select id from ids where k = 'p')$$, '42501', null, 'администратор не вставляет платёж мимо camp_pay');
select throws_ok($$delete from camp_participants where id = (select id from ids where k = 'g')$$, '42501', null, 'администратор не удаляет участника прямым запросом');
select throws_ok($$update camp_participants set amount = 1 where id = (select id from ids where k = 'g')$$, '42501', null, 'администратор не правит участника прямым запросом');
select throws_ok($$insert into camp_participants (camp_id, guest_name, tariff_id, amount, status) values ('00000000-0000-0000-0000-0000000000ca', 'Мимо', '00000000-0000-0000-0000-0000000000e1', 1, 'registered')$$, '42501', null, 'администратор не вставляет участника мимо RPC');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$delete from camp_payments$$, '42501', null, 'локальный администратор не удаляет платежи');
select as_service();
select throws_ok($$delete from camp_payments$$, '42501', null, 'service_role не удаляет платежи');
select throws_ok($$update camp_payments set amount = 1$$, '42501', null, 'service_role не правит платежи');
select throws_ok($$delete from camp_participants$$, '42501', null, 'service_role не удаляет участников');

-- Владелец базы: защита и на уровне триггеров (в том числе каскадов и truncate)
reset role;
select throws_ok($$delete from camp_payments where id = (select id from ids where k = 'pay')$$, 'P0001', 'immutable', 'триггер: удаление платежа отклоняется');
select throws_ok($$update camp_payments set amount = 1 where id = (select id from ids where k = 'pay')$$, 'P0001', 'immutable', 'триггер: правка платежа отклоняется');
select throws_ok($$truncate camp_payments$$, 'P0001', 'immutable', 'триггер: очистка журнала платежей отклоняется');
select throws_ok($$delete from camp_participants where id = (select id from ids where k = 'g')$$, 'P0001', 'immutable', 'триггер: удаление участника отклоняется');
select throws_ok($$delete from camps where id = '00000000-0000-0000-0000-0000000000ca'$$, null::char(5), null::text, 'удаление сбора с участниками и платежами отклоняется');
select throws_ok($$delete from players where id = '00000000-0000-0000-0000-0000000000f1'$$, null::char(5), null::text, 'удаление игрока с платежами сбора отклоняется');
select lives_ok($$delete from camps where id = '00000000-0000-0000-0000-0000000000cb'$$, 'сбор без участников и платежей удаляется как раньше');
select ok(not has_table_privilege('service_role', 'camp_payments', 'update') and not has_table_privilege('service_role', 'camp_payments', 'delete') and has_table_privilege('service_role', 'camp_payments', 'insert')
  and not has_table_privilege('service_role', 'camp_participants', 'delete') and not has_table_privilege('authenticated', 'camp_payments', 'insert'), 'права: у service_role только добавление платежей (импорт), у вошедших только чтение');

select * from finish();
rollback;
