-- pgTAP D-02: импортированный paid = true (без строк оплат) не теряется после явной оплаты, для события и для матча.
begin;
create extension if not exists pgtap;
select plan(13);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9302, 'Админ', true);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Импорт 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Импорт 2');
insert into tournaments (id, club_id, team, kind, name, fee) values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Ч1', 50);
insert into tournament_fees (tournament_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 50, true),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d002', 50, true);
insert into matches (id, club_id, played_on, team, opponent, kind) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Олимп', 'friendly');
insert into match_fees (match_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 30, true),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002', 30, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000a1');

-- событие: оплата-«остаток» ничего не создаёт и данные не трогает
select is(event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d002']::uuid[], null, null, 'Наличные', null), 0, 'событие: у импортированного оплатившего остатка нет');
select is((select count(*)::int from tournament_payments where player_id = '00000000-0000-0000-0000-00000000d002'), 0, 'событие: пустой вызов не создаёт строк');

-- событие: явная оплата 20 поверх импортированных 50
select is(event_pay('00000000-0000-0000-0000-0000000000aa', array['00000000-0000-0000-0000-00000000d001']::uuid[], 20, '2026-10-20', 'Перевод', null), 1, 'событие: явная оплата принята');
select is((select paid from event_fees('00000000-0000-0000-0000-0000000000aa') where player_id = '00000000-0000-0000-0000-00000000d001'), 70::numeric, 'событие: импортированные 50 + новые 20, без потери и без двойного учёта');
select is((select paid from tournament_fees where player_id = '00000000-0000-0000-0000-00000000d001'), true, 'событие: paid остался true');
select is((select count(*)::int from tournament_payments where player_id = '00000000-0000-0000-0000-00000000d001' and method = 'import' and amount = 50), 1, 'событие: импорт материализован одной строкой на 50');

-- событие: отмена новой оплаты возвращает ровно импортированные 50
select event_cancel_payment((select id from event_payments('00000000-0000-0000-0000-0000000000aa') where amount = 20));
select is((select paid from event_fees('00000000-0000-0000-0000-0000000000aa') where player_id = '00000000-0000-0000-0000-00000000d001'), 50::numeric, 'событие: после отмены остались импортированные 50');
select is((select paid from tournament_fees where player_id = '00000000-0000-0000-0000-00000000d001'), true, 'событие: после отмены paid true');

-- матч
select is(match_pay('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d002']::uuid[], null, null, 'Наличные', null), 0, 'матч: у импортированного оплатившего остатка нет');
select is(match_pay('00000000-0000-0000-0000-0000000000f1', array['00000000-0000-0000-0000-00000000d001']::uuid[], 5, '2026-10-20', 'Перевод', null), 1, 'матч: явная оплата принята');
select is((select paid from match_fees_list('00000000-0000-0000-0000-0000000000f1') where player_id = '00000000-0000-0000-0000-00000000d001'), 35::numeric, 'матч: импортированные 30 + новые 5');
select is((select paid from match_fees where player_id = '00000000-0000-0000-0000-00000000d001'), true, 'матч: paid остался true');
select match_cancel_payment((select id from match_payments_list('00000000-0000-0000-0000-0000000000f1') where amount = 5));
select is((select paid from match_fees_list('00000000-0000-0000-0000-0000000000f1') where player_id = '00000000-0000-0000-0000-00000000d001'), 30::numeric, 'матч: после отмены остались импортированные 30');

select * from finish();
rollback;
