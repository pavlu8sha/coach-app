-- pgTAP: #652 этап 1 (0202), идемпотентный eq_create_order. Условия: docs/acceptance/eq-652-stage1-create-order-2026-11-16.md (Ч1–Ч9, Ч12 в файле отката).
begin;
create extension if not exists pgtap;
select plan(32);

-- Права проверяются на базе с привилегиями по умолчанию Supabase: функция создаётся заново и получает их автоматически.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid);
\i db/migrations/0202_eq_create_order_idempotent.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-0000006521c1', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000006521a1', 965201, 'Админ', true),
  ('00000000-0000-0000-0000-0000006521a2', 965202, 'Второй админ', true),
  ('00000000-0000-0000-0000-0000006521b1', 965203, 'Гио', false),
  ('00000000-0000-0000-0000-0000006521b2', 965204, 'Родитель', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-0000006521d1', '00000000-0000-0000-0000-0000006521c1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-0000006521d2', '00000000-0000-0000-0000-0000006521c1', 'Боря', 'active');
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000006521b1', 'Исани');
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-0000006521c1', 'Форма', 300, '2026-09-01'),
  ('00000000-0000-0000-0000-0000006521c1', 'Дождевик', 110, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

-- Ч1: сигнатура и права
select ok(to_regprocedure('public.eq_create_order(uuid,jsonb,text,text,boolean,text,numeric,uuid)') is not null, 'Ч1: есть версия с ключом');
select ok(to_regprocedure('public.eq_create_order(uuid,jsonb,text,text,boolean,text,numeric)') is null, 'Ч1: семиаргументной перегрузки нет');
select ok(not has_function_privilege('anon', 'eq_create_order(uuid,jsonb,text,text,boolean,text,numeric,uuid)', 'execute'), 'Ч9: anon не вызывает (привилегии по умолчанию Supabase)');
select ok(has_function_privilege('authenticated', 'eq_create_order(uuid,jsonb,text,text,boolean,text,numeric,uuid)', 'execute'), 'Ч9: authenticated вызывает');

-- Ч9: кто вызывает
select as_user('00000000-0000-0000-0000-0000006521b1');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Форма"}]'::jsonb, null, null, false, null)$$, '42501', 'forbidden', 'Ч9: локальный админ не создаёт заказ');
select as_user('00000000-0000-0000-0000-0000006521b2');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Форма"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652f01')$$, '42501', 'forbidden', 'Ч9: родитель не создаёт заказ');

select as_user('00000000-0000-0000-0000-0000006521a1');

-- Ч2: повтор
insert into ids select 'o1', eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Форма","size":"M","quantity":2}]'::jsonb, 'Аня', '7', false, 'Исани', null, '00000000-0000-0000-0000-000000652a01');
select is((select total from equipment_orders where id = (select id from ids where k = 'o1')), 600::numeric, 'Ч5: итог по каталогу 2 × 300');
select is((select created_by::text || '/' || request_id::text from equipment_orders where id = (select id from ids where k = 'o1')), '00000000-0000-0000-0000-0000006521a1/00000000-0000-0000-0000-000000652a01', 'Ч2: автор и ключ записаны');
select is(eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Форма","size":"M","quantity":2}]'::jsonb, 'Аня', '7', false, 'Исани', null, '00000000-0000-0000-0000-000000652a01'),
  (select id from ids where k = 'o1'), 'Ч2: повтор с тем же ключом возвращает тот же заказ');
select is((select count(*)::int from equipment_orders where player_id = '00000000-0000-0000-0000-0000006521d1'), 1, 'Ч2: второго заказа нет');
select is((select count(*)::int from equipment_order_lines where order_id = (select id from ids where k = 'o1')), 1, 'Ч2: строк не прибавилось');
select is((select total || '/' || paid from equipment_orders where id = (select id from ids where k = 'o1')), '600.00/0.00', 'Ч2: итог и paid не изменились');

-- Ч3: тот же ключ для другого запроса
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма","size":"M","quantity":2}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652a01')$$, '22023', 'request id reused', 'Ч3: другой игрок');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Форма","size":"M","quantity":3}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652a01')$$, '22023', 'request id reused', 'Ч3: другое количество');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Форма","size":"L","quantity":2}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652a01')$$, '22023', 'request id reused', 'Ч3: другой размер');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Дождевик","size":"M","quantity":2}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652a01')$$, '22023', 'request id reused', 'Ч3: другая позиция');
select is((select count(*)::int from equipment_orders where player_id in ('00000000-0000-0000-0000-0000006521d1', '00000000-0000-0000-0000-0000006521d2')), 1, 'Ч3: отказы ничего не создали');

-- Ч4: ключ принадлежит автору
select as_user('00000000-0000-0000-0000-0000006521a2');
insert into ids select 'o2', eq_create_order('00000000-0000-0000-0000-0000006521d1', '[{"kit":"Форма","size":"M","quantity":2}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652a01');
select isnt((select id from ids where k = 'o2'), (select id from ids where k = 'o1'), 'Ч4: другой администратор с тем же ключом создаёт свой заказ');
select as_user('00000000-0000-0000-0000-0000006521a1');

-- Ч5: без ключа
insert into ids select 'o3', eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма"}]'::jsonb, null, null, false, null);
insert into ids select 'o4', eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма"}]'::jsonb, null, null, false, null);
select isnt((select id from ids where k = 'o3'), (select id from ids where k = 'o4'), 'Ч5: без ключа каждый вызов создаёт заказ');
select is((select quantity from equipment_order_lines where order_id = (select id from ids where k = 'o3')), 1, 'Ч8: без количества берётся 1');
select is((select total from equipment_orders where id = (select id from ids where k = 'o3')), 300::numeric, 'Ч5: цена по каталогу');
select lives_ok($$select eq_create_order(p => '00000000-0000-0000-0000-0000006521d2', lines => '[{"kit":"Форма"}]'::jsonb, insc => null, num => null, inst => false, loc => null)$$, 'Ч1: вызов по именам без ключа (как PostgREST) работает');
insert into ids select 'o5', eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма"}]'::jsonb, null, null, false, null, 525);
select is((select total from equipment_orders where id = (select id from ids where k = 'o5')), 525::numeric, 'Ч5: custom_total заменяет итог');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма"}]'::jsonb, null, null, false, null, -1)$$, '22023', 'bad amount', 'Ч8: отрицательная сумма отклоняется');

-- Ч8: проверка входных данных
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма","quantity":0}]'::jsonb, null, null, false, null)$$, '22023', 'bad quantity', 'Ч8: количество 0');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма","quantity":11}]'::jsonb, null, null, false, null)$$, '22023', 'bad quantity', 'Ч8: количество 11');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма","quantity":"x"}]'::jsonb, null, null, false, null)$$, '22023', 'bad quantity', 'Ч8: количество не число');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма","quantity":1.5}]'::jsonb, null, null, false, null)$$, '22023', 'bad quantity', 'Ч8: дробное количество');
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '["Форма"]'::jsonb, null, null, false, null)$$, '22023', 'bad line', 'Ч8: строка не объект');

-- Ч7: ошибка не оставляет следов, повтор с тем же ключом после исправления проходит
select throws_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма"},{"kit":"Шапка"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652a02')$$, '22023', 'kit not in catalog', 'Ч7: позиция вне каталога отклоняется');
select is((select count(*)::int from equipment_orders where request_id = '00000000-0000-0000-0000-000000652a02'), 0, 'Ч7: заказ с этим ключом не создан');
select lives_ok($$select eq_create_order('00000000-0000-0000-0000-0000006521d2', '[{"kit":"Форма"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-000000652a02')$$, 'Ч7: повтор с исправленным составом проходит');

select * from finish();
rollback;
