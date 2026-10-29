-- pgTAP D-03: нельзя убрать из состава события игрока с оплаченным взносом (флаг paid из импорта или строки оплат).
begin;
create extension if not exists pgtap;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Импорт'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'С оплатой'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Без оплаты');
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч1', 50);
insert into tournament_fees (tournament_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 50, true),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d002', 50, false),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d003', 50, false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000a1');

select throws_ok($$select event_roster_remove('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001')$$, null, 'fee already paid', 'импортированный paid=true убрать нельзя');
select is((select count(*)::int from tournament_fees where player_id = '00000000-0000-0000-0000-00000000d001'), 1, 'импортированный взнос на месте');

select event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d002']::uuid[], 10, null, 'Наличные', null);
select throws_ok($$select event_roster_remove('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d002')$$, null, 'fee already paid', 'со строками оплат убрать нельзя');
select is((select count(*)::int from tournament_fees where player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'взнос с оплатой на месте');

select lives_ok($$select event_roster_remove('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d003')$$, 'неоплаченного убрать можно');
select is((select count(*)::int from tournament_fees where player_id = '00000000-0000-0000-0000-00000000d003'), 0, 'неоплаченный взнос удалён');

select * from finish();
rollback;
