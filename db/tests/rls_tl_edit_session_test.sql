-- pgTAP: изменение времени и места тренировки в журнале (0062).
begin;
create extension if not exists pgtap;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9402, 'Тренер', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000a1');
select tl_add('2026-10-20', 'Павел', 'U9-A', 'Групповая', '17:00', '18:00', 'Зал', true);
select tl_add('2026-10-20', 'Дима', 'U9-A', 'Групповая', '17:00', '18:00', 'Зал', true);

select is(tl_edit_session('2026-10-20', 'U9-A', '17:00', '18:30', '20:00', 'Стадион'), 2, 'изменены строки обоих тренеров');
select is((select count(*)::int from training_log where held_on = '2026-10-20' and starts_at = '18:30' and location = 'Стадион'), 2, 'время и место обновились');
select is((select hours from training_log where coach = 'Павел'), 1.5::numeric, 'часы пересчитаны по новому времени');
select is((select count(*)::int from training_log where external_id like '%|18:30|%'), 2, 'ключи строк обновлены');
select throws_ok($$select tl_edit_session('2026-10-20', 'U9-A', '17:00', '18:30', '20:00', 'Зал')$$, 'P0002', 'not found', 'по старому времени больше ничего нет');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select tl_edit_session('2026-10-20', 'U9-A', '18:30', '19:00', '20:00', 'Зал')$$, '42501', 'forbidden', 'тренер время тренировки менять не может');

select * from finish();
rollback;
