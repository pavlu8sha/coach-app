-- pgTAP: штат матча и статистика тренеров (0043).
begin;
create extension if not exists pgtap;
select plan(12);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8802, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8803, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000c001', '2026-10-03', 'U9', 'Динамо', 2, 1),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Сансона', 0, 0);
insert into training_log (club_id, external_id, held_on, coach, group_label, kind, hours, held) values
  ('00000000-0000-0000-0000-00000000c001', 'k1', '2026-10-05', 'Павел', 'U9', 'Групповая', 1.5, true),
  ('00000000-0000-0000-0000-00000000c001', 'k2', '2026-10-06', 'Павел', 'U9', 'Групповая', 1, false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_staff_set('00000000-0000-0000-0000-00000000f001', '[]'::jsonb)$$, '42501', 'forbidden', 'тренер не меняет штат матча');

select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select match_staff_set('00000000-0000-0000-0000-00000000f001', '[{"coach":"Павел","role":"Тренер","reg":true},{"coach":"Соприк","role":"Оператор","reg":false}]'::jsonb)$$, 'админ задаёт штат');
select throws_ok($$select match_staff_set('00000000-0000-0000-0000-00000000f001', '[{"coach":"Павел","role":"Судья"}]'::jsonb)$$, '22023', 'bad role', 'неизвестная роль отклоняется');
select is((select count(*)::int from match_staff), 2, 'после отклонённой записи штат не изменился');
select lives_ok($$select match_staff_set('00000000-0000-0000-0000-00000000f001', '[{"coach":"Павел","role":"Тренер","reg":true},{"coach":"Соприк","role":"Оператор","reg":false}]'::jsonb)$$, 'повторная запись заменяет штат');
select is((select count(*)::int from match_staff), 2, 'без дублей');
select is((select staff->0->>'coach' from match_staff_list('2026-10-01', '2026-10-31') where team = 'U9' and played_on = '2026-10-03'), 'Павел', 'список игр со штатом');
select is((select hours from trainer_stats('2026-10-01', '2026-10-31') where coach = 'Павел'), 1.5::numeric, 'админ видит часы; непроведённая не считается');
select is((select reg_pct from trainer_stats('2026-10-01', '2026-10-31') where coach = 'Соприк'), 0, 'регламент не выполнен: 0%');

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select as_coach from trainer_stats('2026-10-01', '2026-10-31') where coach = 'Павел'), 1, 'тренер видит статистику: игр как тренер');
select is((select hours from trainer_stats('2026-10-01', '2026-10-31') where coach = 'Павел'), null, 'часы тренеру не показываются');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from trainer_stats('2026-10-01', '2026-10-31')$$, '42501', 'forbidden', 'родитель статистику тренеров не видит');

select * from finish();
rollback;
