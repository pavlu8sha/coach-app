-- pgTAP: автор и время платежа (0077). Автор ставит сервер по сессии, клиентское значение заменяется; после записи не меняется.
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Гил', true),
  ('00000000-0000-0000-0000-0000000000a2', 9102, 'Дима', true),
  ('00000000-0000-0000-0000-0000000000b1', 9103, 'Паша', false);
insert into groups (id, club_id, name, location) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Исани');
insert into players (id, club_id, group_id, full_name) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня');
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- запись без пользователя (импорт через service role) сохраняет переданное значение и не получает время
insert into payments (id, player_id, amount, paid_on, method, recorded_by) values
  ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000d001', 10, '2026-10-01', 'Наличные', null);
select is((select recorded_at from payments where id = '00000000-0000-0000-0000-0000000000f0'), null::timestamptz, 'импорт без пользователя: время не выдумывается');

-- вошедший администратор Дима подставляет чужого автора: сервер записывает Диму
select as_user('00000000-0000-0000-0000-0000000000a2');
insert into payments (id, player_id, amount, paid_on, method, recorded_by) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-06', 'Перевод', '00000000-0000-0000-0000-0000000000a1');
select is((select recorded_by from payments where id = '00000000-0000-0000-0000-0000000000f1'), '00000000-0000-0000-0000-0000000000a2'::uuid, 'автор платежа — вошедший пользователь, а не значение клиента');
select isnt((select recorded_at from payments where id = '00000000-0000-0000-0000-0000000000f1'), null::timestamptz, 'время записи проставлено сервером');

-- сбор: автор и время тоже ставит сервер
insert into camps (id, club_id, name, starts_on, ends_on) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000c001', 'Сбор', '2026-10-01', '2026-10-31');
insert into camp_participants (camp_id, player_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000d001');
insert into camp_payments (id, camp_id, participant_id, player_id, amount, paid_on, kind, method, recorded_by)
  select '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c2', cp.id, cp.player_id, 30, '2026-10-06', 'payment', 'Наличные', '00000000-0000-0000-0000-0000000000a1'
    from camp_participants cp where cp.camp_id = '00000000-0000-0000-0000-0000000000c2';
select is((select recorded_by from camp_payments where id = '00000000-0000-0000-0000-0000000000c3'), '00000000-0000-0000-0000-0000000000a2'::uuid, 'сбор: автор — вошедший пользователь');

-- после записи автор не меняется (даже администратором)
select throws_ok(
  $$update payments set recorded_by = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'автор платежа нельзя изменить после записи');
select throws_ok(
  $$update camp_payments set recorded_at = '2001-01-01' where id = '00000000-0000-0000-0000-0000000000c3'$$,
  '42501', null, 'время сбора нельзя изменить после записи');

-- обычный пользователь без прав не записывает платежи
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$insert into payments (player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-00000000d001', 1, '2026-10-07', 'Наличные')$$,
  '42501', null, 'не администратор не пишет оплаты');

select * from finish();
rollback;
