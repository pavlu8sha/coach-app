-- pgTAP: реквизиты и правила оплаты (0099, #239): читают вошедшие пользователи, пишет только администратор через payment_info_save.
begin;
create extension if not exists pgtap;
select plan(12);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9501, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b2', 9502, 'Родитель', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- исходная запись создана миграцией только если клуб был; в тесте клуб заведён позже, поэтому создаём её администратором
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select payment_info_save(
  '[{"label":"Beneficiary’s Bank","value":"JSC TBC Bank"},{"label":"Bank Code","value":"TBCBGE22"},{"label":"Beneficiary’s IBAN","value":"GE11TB7050036080100015"},{"label":"Name of Beneficiary","value":"F.C. Kickstart LLC"}]'::jsonb,
  '[{"title":"1. Абонементы","items":["Только на один месяц."]}]'::jsonb)$$, 'администратор сохраняет реквизиты и правила');

select is((select count(*)::int from payment_info), 1, 'запись одна на клуб');
select is((select updated_by from payment_info), '00000000-0000-0000-0000-0000000000a1'::uuid, 'сохранено, кто и когда обновил');

-- повторное сохранение обновляет ту же запись
select lives_ok($$select payment_info_save(
  '[{"label":"Beneficiary’s Bank","value":"JSC TBC Bank"},{"label":"Bank Code","value":"TBCBGE22"},{"label":"Beneficiary’s IBAN","value":"GE11TB7050036080100015"},{"label":"Name of Beneficiary","value":"F.C. Kickstart LLC"}]'::jsonb,
  '[{"title":"1. Абонементы","items":["Только на один месяц.","Оплата с 22-го по 28-е."]}]'::jsonb)$$, 'повторное сохранение');
select is((select jsonb_array_length(rules -> 0 -> 'items') from payment_info), 2, 'правила обновлены в той же записи');

-- проверка формы данных
select throws_ok($$select payment_info_save('[{"label":"Bank Code","value":"X"}]'::jsonb, '[{"title":"a","items":["b"]}]'::jsonb)$$, '22023', 'bad details', 'реквизитов должно быть ровно четыре');
select throws_ok($$select payment_info_save(
  '[{"label":"Beneficiary’s Bank","value":"JSC TBC Bank"},{"label":"Bank Code","value":"TBCBGE22"},{"label":"Лишнее поле","value":"x"},{"label":"Name of Beneficiary","value":"F.C. Kickstart LLC"}]'::jsonb,
  '[{"title":"a","items":["b"]}]'::jsonb)$$, '22023', 'bad details', 'названия реквизитов менять нельзя');
select throws_ok($$select payment_info_save(
  '[{"label":"Beneficiary’s Bank","value":"JSC TBC Bank"},{"label":"Bank Code","value":""},{"label":"Beneficiary’s IBAN","value":"GE11TB7050036080100015"},{"label":"Name of Beneficiary","value":"F.C. Kickstart LLC"}]'::jsonb,
  '[{"title":"a","items":["b"]}]'::jsonb)$$, '22023', 'bad details', 'пустое значение реквизита отвергается');
select throws_ok($$select payment_info_save(
  '[{"label":"Beneficiary’s Bank","value":"JSC TBC Bank"},{"label":"Bank Code","value":"TBCBGE22"},{"label":"Beneficiary’s IBAN","value":"GE11TB7050036080100015"},{"label":"Name of Beneficiary","value":"F.C. Kickstart LLC"}]'::jsonb,
  '[{"title":"a","items":[]}]'::jsonb)$$, '22023', 'bad rules', 'раздел правил без пунктов отвергается');

-- родитель читает, но не пишет
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from payment_info), 1, 'родитель читает реквизиты и правила');
select throws_ok($$select payment_info_save('[]'::jsonb, '[]'::jsonb)$$, '42501', 'forbidden', 'родитель не сохраняет');
select throws_ok($$update payment_info set rules = '[]'::jsonb$$, '42501', null, 'прямая запись закрыта');

select * from finish();
rollback;
