-- pgTAP R-09: camp_update_participant не опускает сумму участника ниже уже оплаченного.
begin;
create extension if not exists pgtap;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 9305, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'camp', camp_save(null, 'Лагерь', 'Бакуриани', '2027-01-02', '2027-01-09', 100, null, null, true);
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 800, true);
insert into ids select 'part', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d001', (select id from camp_tariffs limit 1), 200, null, null);
select camp_pay((select id from ids where k = 'part'), 100, 'payment', '2026-11-01', 'Наличные', null);

select throws_ok($$select camp_update_participant((select id from ids where k = 'part'), null, 50, null, null, 'registered')$$, '22023', 'amount below paid', 'сумма 50 при оплаченных 100 отклоняется');
select is((select amount from camp_participants where id = (select id from ids where k = 'part')), 200::numeric, 'после отказа сумма прежняя');
select lives_ok($$select camp_update_participant((select id from ids where k = 'part'), null, 100, null, null, 'registered')$$, 'сумма, равная оплаченному, принимается');
select lives_ok($$select camp_update_participant((select id from ids where k = 'part'), null, 150, 'M', 'ок', 'registered')$$, 'сумма выше оплаченного принимается');
select is((select amount from camp_participants where id = (select id from ids where k = 'part')), 150::numeric, 'сумма обновилась');
select throws_ok($$select camp_update_participant((select id from ids where k = 'part'), null, -1, null, null, 'registered')$$, '22023', 'bad amount', 'отрицательная сумма по-прежнему отклоняется');

select * from finish();
rollback;
