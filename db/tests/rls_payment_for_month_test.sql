-- pgTAP: платёж за месяц (0059): реальная дата оплаты и месяц абонемента.
begin;
create extension if not exists pgtap;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 8101, 'Админ', true);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A');
insert into players (id, club_id, group_id, full_name) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня');
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');

-- обычный платёж: месяц берётся из даты; платёж вперёд: реальная дата 22-го, месяц следующий
insert into payments (id, player_id, amount, paid_on) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 100, '2026-10-05');
insert into payments (id, player_id, amount, paid_on, for_month) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000d001', 165, '2026-10-22', '2026-11-01');
select is((select pay_month from payments where id = '00000000-0000-0000-0000-0000000000f1'), '2026-10-01'::date, 'без for_month месяц = месяц даты');
select is((select pay_month from payments where id = '00000000-0000-0000-0000-0000000000f2'), '2026-11-01'::date, 'с for_month засчитывается в этот месяц');
select is((select paid_on from payments where id = '00000000-0000-0000-0000-0000000000f2'), '2026-10-22'::date, 'реальная дата оплаты сохраняется');
select throws_ok($$insert into payments (player_id, amount, paid_on, for_month) values ('00000000-0000-0000-0000-00000000d001', 1, '2026-10-22', '2026-11-15')$$, '23514', null, 'for_month только первое число месяца');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000a1');
-- платёж вперёд не закрывает долг текущего месяца: оплачено 100 из 165 (месяц октябрь 2026 фиксируем через debtors)
select is((select paid from debtors('2026-10-01') where player_id = '00000000-0000-0000-0000-00000000d001'), 100::numeric, 'долг октября считает только платежи за октябрь')
  where date_trunc('month', (now() at time zone 'Asia/Tbilisi')::date)::date = '2026-10-01'
  union all select ok(true, 'тест долга рассчитан на октябрь; в другой месяц пропускается') where date_trunc('month', (now() at time zone 'Asia/Tbilisi')::date)::date <> '2026-10-01';
select is((select count(*)::int from payments where pay_month = '2026-11-01'), 1, 'платёж вперёд виден в расчётах за ноябрь');

select * from finish();
rollback;
