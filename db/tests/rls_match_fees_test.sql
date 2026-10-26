-- pgTAP: взносы за матч — только администратор; оплата, остаток, скидка, отмена; импортированные оплаты не пропадают.
begin;
create extension if not exists pgtap;
select plan(17);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9102, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 3');
insert into matches (id, club_id, played_on, team, opponent, kind) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Олимп', 'friendly');
-- импортированный взнос: оплачен, строк оплат нет
insert into match_fees (match_id, player_id, amount, paid) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002', 30, true);
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч1', 50);
insert into tournament_fees (tournament_id, player_id, amount, paid) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 50, true);
insert into matches (id, club_id, played_on, team, opponent, kind, tournament_id) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-11', 'U9', 'Звезда', 'game', '00000000-0000-0000-0000-0000000000aa');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select * from match_fees_list('00000000-0000-0000-0000-0000000000f1')$$, 'тренер видит взносы товарищеского матча');
select throws_ok($$select * from match_fees_list('00000000-0000-0000-0000-0000000000f2')$$, '42501', null, 'взносы матча чемпионата тренеру закрыты');
select throws_ok($$select match_pay('00000000-0000-0000-0000-0000000000f2', array['00000000-0000-0000-0000-00000000d002']::uuid[], 10, null, 'Наличные', null)$$, '42501', null, 'оплату матча чемпионата тренер принять не может');
select is(match_fee_add('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d003']::uuid[], 25), 1, 'тренер назначает взнос товарищеского матча');
select is(match_pay('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d003']::uuid[], 25, null, 'Перевод', null), 1, 'тренер принимает оплату товарищеского матча');
select throws_ok($$select match_discount('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d003', 10)$$, '42501', null, 'скидка только у администратора');
select throws_ok($$select match_cancel_payment((select id from match_payments_list('00000000-0000-0000-0000-0000000000f1') limit 1))$$, '42501', null, 'отмена платежа только у администратора');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is(match_fee_add('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002']::uuid[], 20), 1, 'добавлен только новый участник');
select is((select paid from match_fees_list('00000000-0000-0000-0000-0000000000f1') where player_id = '00000000-0000-0000-0000-00000000d002'), 30::numeric, 'импортированная оплата видна как оплачено');
select is(match_pay('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d002']::uuid[], null, null, 'Наличные', null), 0, 'у оплатившего остатка нет');
select is(match_pay('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d001']::uuid[], 5, '2026-10-20', 'Перевод', 'часть'), 1, 'частичная оплата');
select is((select paid from match_fees where player_id = '00000000-0000-0000-0000-00000000d001'), false, 'флаг paid ещё не стоит');
select is(match_pay('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d001']::uuid[], null, null, 'Наличные', null), 1, 'доплата остатка');
select is((select paid from match_fees where player_id = '00000000-0000-0000-0000-00000000d001'), true, 'оплачен полностью');
select match_cancel_payment((select id from match_payments_list('00000000-0000-0000-0000-0000000000f1') where amount = 5));
select is((select paid from match_fees where player_id = '00000000-0000-0000-0000-00000000d001'), false, 'после отмены снова не оплачено');
select throws_ok($$select match_fee_remove('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, null, 'fee already paid', 'с оплатами не убрать');
-- 0053: импортированный взнос события остаётся оплаченным после пересчёта и не оплачивается повторно
select event_set_fee('00000000-0000-0000-0000-0000000000aa', 60);
select is((select paid from event_fees('00000000-0000-0000-0000-0000000000aa')), 50::numeric, 'оплата события из импорта сохранилась');

select * from finish();
rollback;
