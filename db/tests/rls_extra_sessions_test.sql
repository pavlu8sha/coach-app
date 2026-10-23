-- pgTAP: дополнительные тренировки для администратора (0035).
begin;
create extension if not exists pgtap;
select plan(11);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8402, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c002', 'Чужой', 'active');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table sid (id uuid);
grant all on sid to authenticated;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select extra_create_session('2026-11-10', 20, 'Зал')$$, '42501', 'forbidden', 'тренер не создаёт тренировки');

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into sid select extra_create_session('2026-11-10', 20, 'Зал');
select throws_ok($$select extra_create_session('2026-11-10', 30, null)$$, '23505', 'session exists', 'в один день одна тренировка');
select throws_ok($$select extra_create_session('2026-11-11', -5, null)$$, '22023', 'bad amount', 'отрицательная сумма отклоняется');
select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d001');
select throws_ok($$select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d001')$$, '23505', 'already booked', 'дважды записать нельзя');
select throws_ok($$select extra_add_player((select id from sid), '00000000-0000-0000-0000-00000000d009')$$, '22023', 'player not in club', 'игрок чужого клуба отклоняется');

select extra_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d001', true, 'Наличные');
select is((select paid_amount from extra_bookings where session_id = (select id from sid)), 20::numeric, 'оплата по умолчанию на сумму тренировки');
select throws_ok($$select extra_remove_player((select id from sid), '00000000-0000-0000-0000-00000000d001')$$, '22023', 'booking is paid', 'оплаченную запись убрать нельзя');
select throws_ok($$select extra_edit_session((select id from sid), '2026-11-12', 20, 'Зал')$$, '22023', 'session has payments', 'с оплатами дату менять нельзя');
select lives_ok($$select extra_edit_session((select id from sid), '2026-11-10', 20, 'Другой зал')$$, 'место менять можно');
select throws_ok($$select extra_delete_session((select id from sid))$$, '22023', 'session has payments', 'с оплатами удалить нельзя');

select extra_set_paid((select id from sid), '00000000-0000-0000-0000-00000000d001', false);
select lives_ok($$select extra_delete_session((select id from sid))$$, 'после отмены оплаты тренировку можно удалить');

select * from finish();
rollback;
