-- pgTAP: родитель видит долги и оплаты по всем видам только своего ребёнка и только после включения показа (0058).
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 9201, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000b2', 9202, 'Чужой', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v', now());

insert into equipment_orders (id, club_id, player_id, ordered_on, total, paid) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', '2026-09-10', 160, 60),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d002', '2026-09-10', 100, 0);
insert into equipment_order_lines (order_id, kit, quantity, unit_price) values ('00000000-0000-0000-0000-0000000000e1', 'Форма', 1, 160);
insert into individual_sessions (id, club_id, external_id, starts_at, topic, goalkeepers) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000c001', 'i1', now() at time zone 'Asia/Tbilisi' - interval '3 days', null, true),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000c001', 'i2', now() at time zone 'Asia/Tbilisi' + interval '3 days', null, false);
insert into individual_bookings (session_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 50, false),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 50, false);
insert into extra_sessions (id, club_id, starts_on, amount, place) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date - 2, 20, 'Зал');
insert into extra_bookings (session_id, player_id, paid, paid_amount) values ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d001', true, 20);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_dues()), 0, 'пока показ не включён, родитель ничего не получает');

reset role;
insert into club_settings (club_id, key, scope, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', '', 'true');

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_dues() where kind = 'eq'), 1, 'экипировка своего ребёнка видна');
select is((select debt from parent_dues() where kind = 'eq'), 100::numeric, 'долг по экипировке = сумма минус оплачено');
select is((select count(*)::int from parent_dues() where kind = 'ind'), 1, 'прошедшее индивидуальное занятие видно, будущее нет');
select is((select debt from parent_dues() where kind = 'extra'), 0::numeric, 'оплаченная дополнительная тренировка: долга нет');
select is((select count(*)::int from parent_dues() where player_id = '00000000-0000-0000-0000-00000000d002'), 0, 'чужого ребёнка родитель не видит');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from parent_dues()), 0, 'родитель без привязки ничего не видит');

select * from finish();
rollback;
