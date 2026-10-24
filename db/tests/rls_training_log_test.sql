-- pgTAP: учёт проведённых тренировок и часов тренеров (0038).
begin;
create extension if not exists pgtap;
select plan(13);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8702, 'Тренер', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select tl_confirm('2026-10-05', 'U9', 'Групповая', '17:00', '18:30', 'Зал', array['Павел'])$$, '42501', 'forbidden', 'тренер не подтверждает тренировки');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is(tl_confirm('2026-10-05', 'U9', 'Групповая', '17:00', '18:30', 'Зал', array['Павел', 'Соприк']), 2, 'по строке на каждого тренера');
select is((select hours from training_log where coach = 'Павел'), 1.5::numeric, 'часы: 17:00–18:30 = 1.5');
select is((select weekday from training_log where coach = 'Павел'), 'Пн', 'день недели по дате');
select is(tl_confirm('2026-10-05', 'U9', 'Групповая', '17:00', '18:30', 'Зал', array['Павел']), 0, 'повторное подтверждение не дублирует');
select throws_ok($$select tl_confirm('2999-01-01', 'U9', 'Групповая', '17:00', '18:00', null, array['Павел'])$$, '22023', 'date in the future', 'будущую тренировку подтвердить нельзя');
select throws_ok($$select tl_add('2026-10-05', 'Павел', 'U9', 'Другая', '17:00', '18:00', null)$$, '22023', 'bad kind', 'неизвестный тип отклоняется');

select tl_add('2026-10-06', 'Павел', 'U9', 'Групповая', '17:00', '18:00', null, false);
select is(tl_confirm('2026-10-06', 'U9', 'Групповая', '17:00', '18:00', null, array['Павел']), 1, 'отметка «Нет» превращается в «Да»');
select is((select count(*)::int from training_log where held_on = '2026-10-06'), 1, 'без второй строки');

select tl_replace_coach((select id from training_log where coach = 'Соприк'), 'Цотне');
select is((select count(*)::int from training_log where coach = 'Цотне'), 1, 'тренер заменён');
select throws_ok($$select tl_replace_coach((select id from training_log where coach = 'Цотне'), 'Павел')$$, '23505', 'coach already in', 'тот же тренер дважды на тренировке не нужен');
select tl_set_held((select id from training_log where coach = 'Цотне'), false);
select is((select held from training_log where coach = 'Цотне'), false, 'тренировку можно снять с проведённых');
select is((select count(distinct external_id)::int from training_log), 3, 'ключи строк уникальны');

select * from finish();
rollback;
