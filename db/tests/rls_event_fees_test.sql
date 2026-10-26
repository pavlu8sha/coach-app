-- pgTAP: взносы за события — только администратор; оплата, остаток, скидка, отмена, защита от удаления из состава.
begin;
create extension if not exists pgtap;
select plan(13);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9002, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2');
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч1', 50);
insert into tournament_fees (tournament_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 50),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d002', 50);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select * from event_fees('00000000-0000-0000-0000-0000000000aa')$$, '42501', null, 'тренер не видит взносы');
select throws_ok($$select event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d001']::uuid[], 10, null, 'Наличные', null)$$, '42501', null, 'тренер не принимает оплату');
select throws_ok($$select event_set_fee('00000000-0000-0000-0000-0000000000aa', 1)$$, '42501', null, 'тренер не меняет взнос');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is(event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d001']::uuid[], 20, '2026-10-20', 'Перевод', 'часть'), 1, 'частичная оплата');
select is((select paid from event_fees('00000000-0000-0000-0000-0000000000aa') where player_id = '00000000-0000-0000-0000-00000000d001'), 20::numeric, 'оплачено 20');
select is((select paid from tournament_fees where player_id = '00000000-0000-0000-0000-00000000d001'), false, 'флаг paid ещё не стоит');
select is(event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[], null, null, 'Наличные', null), 2, 'массовая доплата остатка');
select is((select count(*)::int from tournament_fees where paid), 2, 'оба оплатили');
select event_discount('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d002', 40);
select is((select due from event_fees('00000000-0000-0000-0000-0000000000aa') where player_id = '00000000-0000-0000-0000-00000000d002'), 40::numeric, 'скидка меняет сумму к оплате');
select event_cancel_payment((select id from event_payments('00000000-0000-0000-0000-0000000000aa') where player_id = '00000000-0000-0000-0000-00000000d001' and amount = 30));
select is((select paid from tournament_fees where player_id = '00000000-0000-0000-0000-00000000d001'), false, 'после отмены снова не оплачено');
select throws_ok($$select event_cancel_payment((select id from event_payments('00000000-0000-0000-0000-0000000000aa') where amount = 30 limit 1))$$, '22023', null, 'повторная отмена запрещена');
select throws_ok($$select event_roster_remove('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001')$$, null, 'fee already paid', 'с оплатами из состава не убрать');
select event_set_fee('00000000-0000-0000-0000-0000000000aa', 60);
select is((select due from event_fees('00000000-0000-0000-0000-0000000000aa') where player_id = '00000000-0000-0000-0000-00000000d002'), 40::numeric, 'смена взноса не трогает игрока с оплатой/скидкой');

select * from finish();
rollback;
