-- pgTAP: ind_cap — дефолты мест 6 (индивидуальные) и 7 (вратарские), ошибка на неверном значении (0119, #468).
begin;
create extension if not exists pgtap;
select plan(14);

insert into clubs (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'Клуб без настроек'),
  ('00000000-0000-0000-0000-00000000c002', 'Клуб с настройками');

select is(ind_cap('00000000-0000-0000-0000-00000000c001', false), 6, 'нет настройки: индивидуальные = 6');
select is(ind_cap('00000000-0000-0000-0000-00000000c001', true), 7, 'нет настройки: вратарские = 7');

insert into club_settings (club_id, key, value) values
  ('00000000-0000-0000-0000-00000000c002', 'ind.capIndividual', '   '),
  ('00000000-0000-0000-0000-00000000c002', 'ind.capGoalkeepers', '');
select is(ind_cap('00000000-0000-0000-0000-00000000c002', false), 6, 'пробелы вместо значения: дефолт 6');
select is(ind_cap('00000000-0000-0000-0000-00000000c002', true), 7, 'пустая строка: дефолт 7');

update club_settings set value = '4' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capIndividual';
update club_settings set value = ' 9,0 ' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capGoalkeepers';
select is(ind_cap('00000000-0000-0000-0000-00000000c002', false), 4, 'заданное значение имеет приоритет над дефолтом');
select is(ind_cap('00000000-0000-0000-0000-00000000c002', true), 9, 'запятая и пробелы допустимы: 9,0 = 9');

update club_settings set value = 'abc' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capIndividual';
select throws_ok($$select ind_cap('00000000-0000-0000-0000-00000000c002', false)$$, '22023', 'invalid setting ind.capIndividual: abc', 'нечисло: ошибка, не дефолт');

update club_settings set value = '2.5' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capIndividual';
select throws_ok($$select ind_cap('00000000-0000-0000-0000-00000000c002', false)$$, '22023', 'invalid setting ind.capIndividual: 2.5', 'дробное: ошибка');

update club_settings set value = '0' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capIndividual';
select throws_ok($$select ind_cap('00000000-0000-0000-0000-00000000c002', false)$$, '22023', 'invalid setting ind.capIndividual: 0', 'ноль: ошибка');

update club_settings set value = '-3' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capIndividual';
select throws_ok($$select ind_cap('00000000-0000-0000-0000-00000000c002', false)$$, '22023', 'invalid setting ind.capIndividual: -3', 'отрицательное: ошибка');

update club_settings set value = '101' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capGoalkeepers';
select throws_ok($$select ind_cap('00000000-0000-0000-0000-00000000c002', true)$$, '22023', 'invalid setting ind.capGoalkeepers: 101', 'больше 100: ошибка');

update club_settings set value = 'NaN' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capGoalkeepers';
select throws_ok($$select ind_cap('00000000-0000-0000-0000-00000000c002', true)$$, '22023', 'invalid setting ind.capGoalkeepers: NaN', 'NaN: ошибка');

update club_settings set value = '100' where club_id = '00000000-0000-0000-0000-00000000c002' and key = 'ind.capGoalkeepers';
select is(ind_cap('00000000-0000-0000-0000-00000000c002', true), 100, 'граница 100 допустима');

select is(has_function_privilege('authenticated', 'ind_cap(uuid, boolean)', 'execute'), false, 'ind_cap закрыта от authenticated');

select * from finish();
rollback;
