-- pgTAP: сборы для администратора (0037).
begin;
create extension if not exists pgtap;
select plan(15);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8601, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8602, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c002', 'Чужой', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select camp_save(null, 'Лагерь', 'Бакуриани', '2027-01-02', '2027-01-09', 100, null, null, true)$$, '42501', 'forbidden', 'тренер не создаёт сборы');

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'camp', camp_save(null, 'Лагерь', 'Бакуриани', '2027-01-02', '2027-01-09', 100, '2026-12-01', '2026-12-20', true);
select throws_ok($$select camp_save(null, 'Плохой', null, '2027-02-10', '2027-02-01', 0, null, null, true)$$, '22023', 'bad dates', 'конец раньше начала отклоняется');
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 800, true);
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 850, true);
select is((select count(*)::int from camp_tariffs where camp_id = (select id from ids where k = 'camp')), 1, 'повторное сохранение тарифа меняет цену, а не дублирует');
insert into ids select 'part', camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d001', (select id from camp_tariffs limit 1), null, 'M', null);
select is((select amount from camp_participants where id = (select id from ids where k = 'part')), 850::numeric, 'сумма по умолчанию — цена тарифа');
select throws_ok($$select camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d001', (select id from camp_tariffs limit 1), null, null, null)$$, '23505', 'already registered', 'дважды записать нельзя');
select throws_ok($$select camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d009', (select id from camp_tariffs limit 1), null, null, null)$$, '22023', 'player not in club', 'игрок чужого клуба отклоняется');

insert into ids select 'pay', camp_pay((select id from ids where k = 'part'), 100, 'booking', '2026-11-01', 'Наличные', null);
select throws_ok($$select camp_pay((select id from ids where k = 'part'), -5, 'payment', null, null, null)$$, '22023', 'bad amount', 'платёж должен быть положительным');
select throws_ok($$select camp_pay((select id from ids where k = 'part'), 5, 'refund', null, null, null)$$, '22023', 'bad kind', 'вид платежа только бронь или оплата');
select is((select sum(amount) from camp_payments where participant_id = (select id from ids where k = 'part')), 100::numeric, 'итог по участнику 100');

select camp_cancel_payment((select id from ids where k = 'pay'));
select is((select sum(amount) from camp_payments where participant_id = (select id from ids where k = 'part')), 0::numeric, 'отмена платежа даёт строку с минусом, итог 0');
select is((select count(*)::int from camp_payments where participant_id = (select id from ids where k = 'part')), 2, 'исходный платёж не удалён');
select throws_ok($$select camp_cancel_payment((select id from ids where k = 'pay'))$$, '23505', 'already cancelled', 'повторная отмена отклоняется');

select camp_update_participant((select id from ids where k = 'part'), null, 850, 'L', 'отказ', 'declined');
select is((select status from camp_participants where id = (select id from ids where k = 'part')), 'declined', 'отказ ставится статусом, строка остаётся');
select lives_ok($$select camp_register((select id from ids where k = 'camp'), '00000000-0000-0000-0000-00000000d001', (select id from camp_tariffs limit 1), null, null, null)$$, 'после отказа можно записать снова');
select is((select count(*)::int from camp_participants), 1, 'одна строка участника на игрока и сбор');

select * from finish();
rollback;
