-- pgTAP: «Внесено за день» в кассе (0086): оплаты экипировки и доп. занятий, индивидуальные — только глобальному админу.
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9302, 'Гио', false),
  ('00000000-0000-0000-0000-0000000000c2', 9303, 'Тренер', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Исани'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U13', 'Квартал');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Вика', 'active');
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000b1', 'Исани');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'Форма', 300, '2026-09-01');

-- взносы матча и события, оплаченные 30.10
insert into matches (id, club_id, played_on, team, opponent, kind) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-30', 'U9', 'Звезда', 'friendly');
insert into match_fees (match_id, player_id, amount) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 25);
insert into match_payments (match_id, player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 25, '2026-10-30', 'Наличные');
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч1', 200);
insert into tournament_fees (tournament_id, player_id, amount) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 200);
insert into tournament_payments (tournament_id, player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 100, '2026-10-30', 'Перевод');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

-- оплаты 30.10 заводит глобальный админ: экипировка Исани и Квартала, доп. занятия обеих локаций, индивидуальное
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'eq1', eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Исани', 300);
insert into ids select 'eq3', eq_create_order('00000000-0000-0000-0000-00000000d003', '[{"kit":"Форма"}]'::jsonb, null, '8', false, 'Квартал', 300);
select eq_add_payment((select id from ids where k = 'eq1'), 40, '2026-10-30', 'Наличные');
select eq_add_payment((select id from ids where k = 'eq3'), 40, '2026-10-30', 'Перевод');
insert into ids select 'ex1', extra_create_session('2026-10-28', 25, 'Исани');
select extra_add_player((select id from ids where k = 'ex1'), '00000000-0000-0000-0000-00000000d001');
select extra_set_paid((select id from ids where k = 'ex1'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null, '2026-10-30');
insert into ids select 'ex3', extra_create_session('2026-10-29', 25, 'Квартал');
select extra_add_player((select id from ids where k = 'ex3'), '00000000-0000-0000-0000-00000000d003');
select extra_set_paid((select id from ids where k = 'ex3'), '00000000-0000-0000-0000-00000000d003', true, 'Перевод', null, '2026-10-30');
insert into ids select 'ind', ind_create_session('2026-10-30', '12:00', false, 'Дриблинг');
select ind_add_player((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001');
select ind_set_paid((select id from ids where k = 'ind'), '00000000-0000-0000-0000-00000000d001', true, 'Перевод', '2026-10-30');

select is(jsonb_array_length(cash_day_service('2026-10-30')), 7, 'глобальный админ видит все оплаты дня: экипировка, доп. занятия, индивидуальное, взнос матча и события');
select is((select x->>'detail' from jsonb_array_elements(cash_day_service('2026-10-30')) x where x->>'what' = 'Взнос матча'), '30.10 Звезда', 'взнос матча в ленте с датой и соперником');

-- локальный админ Гио: только Исани — экипировка и доп. занятие; Квартал и индивидуальное скрыты
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(jsonb_array_length(cash_day_service('2026-10-30')), 2, 'Гио видит оплаты своей локации');
select is((select sum((x->>'amount')::numeric) from jsonb_array_elements(cash_day_service('2026-10-30')) x), 65::numeric, 'сумма оплат Гио: 40 + 25');
select is((select count(*)::int from jsonb_array_elements(cash_day_service('2026-10-30')) x where x->>'what' = 'Индивидуальное'), 0, 'индивидуальные занятия Гио не видит');
select is((select count(*)::int from jsonb_array_elements(cash_day_service('2026-10-30')) x where x->>'what' like 'Взнос%'), 0, 'взносы матчей и событий без локации локальный админ не видит');

-- тренер без локации: отказ
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select cash_day_service('2026-10-30')$$, '42501', 'forbidden', 'тренер без локации не видит оплаты дня');

select * from finish();
rollback;
