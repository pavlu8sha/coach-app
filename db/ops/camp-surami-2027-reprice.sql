-- Winter Camp 2027: пересчёт суммы у уже записанных игроков после смены тарифов (Surami).
-- Причина: camp_participants.amount — снимок цены тарифа на момент записи; смена camp_tariffs.price его не меняет.
-- Правило Павла (12.11): тариф «Футболист» остаётся, меняется только цена (1350); любой другой тариф
-- (бывший «Ребёнок + 2 родителя», «Ребёнок + 1 родитель» и т.п.) → «Футболист + 2 родителя» по его цене (3100).
-- Касается только записей registered. Ручные суммы тоже приводятся к цене тарифа (видны в ПРОВЕРКЕ заранее).
-- Если внесено больше новой цены, запись НЕ меняется (сумма не может быть ниже оплаченного): нужен возврат разницы
-- вручную, затем повторный запуск. Платежи не трогаются. Изменения пишутся в историю записи (триггер camp_participants_log),
-- уведомлений не вызывают.
-- Цены тарифов должны быть уже новыми (1350 и 3100); переименование «Ребенок + 2 родителя» → «Футболист + 2 родителя» скрипт делает сам.
-- Отключённые тарифы («Ребенок + родитель» и т.п.) тоже переводятся: записи на них станут «Футболист + 2 родителя». НЕ ЗАПУСКАТЬ без слова владельца. Повторный запуск безопасен.

-- Названия тарифов сравниваются без учёта регистра, «е»/«ё» и лишних пробелов (как в update.sql из PR #622).

-- ===== ПРОВЕРКА (только чтение) =====
-- Тарифы сбора:
select t.id, t.name, t.price, t.active from camp_tariffs t join camps c on c.id = t.camp_id
 where c.name ilike '%winter%camp%2027%' order by t.price;
-- Что изменится: новая сумма, внесено, переплата (> 0 — запись будет пропущена, нужен возврат):
with c as (select id from camps where name ilike '%winter%camp%2027%'),
     f  as (select t.id, t.price from camp_tariffs t, c where t.camp_id = c.id and regexp_replace(replace(lower(btrim(t.name)),'ё','е'),'\s+',' ','g') = 'футболист'),
     f2 as (select t.id, 'Футболист + 2 родителя'::text as name, t.price from camp_tariffs t, c where t.camp_id = c.id and t.active and regexp_replace(replace(lower(btrim(t.name)),'ё','е'),'\s+',' ','g') in ('футболист + 2 родителя', 'ребенок + 2 родителя'))
select p.id, p.player_id, p.guest_name, p.tariff_id as tariff_id_now, t.name as tariff_now, p.amount as amount_now,
       case when p.tariff_id = f.id then 'Футболист' else f2.name end as tariff_new,
       case when p.tariff_id = f.id then f.price else f2.price end as amount_new,
       q.paid,
       greatest(q.paid - case when p.tariff_id = f.id then f.price else f2.price end, 0) as overpaid
  from camp_participants p
  join c on c.id = p.camp_id
  join camp_tariffs t on t.id = p.tariff_id
  cross join f cross join f2
  cross join lateral (select coalesce(sum(x.amount), 0) as paid from camp_payments x where x.participant_id = p.id) q
 where p.status = 'registered'
   and (p.amount <> case when p.tariff_id = f.id then f.price else f2.price end or p.tariff_id not in (f.id, f2.id))
 order by tariff_now, p.amount;

-- ВАЖНО: сохраните вывод этой выборки (Export → CSV в SQL Editor) до ПРИМЕНЕНИЯ. Это снимок для отката.

-- ===== ПРИМЕНЕНИЕ =====
begin;
do $$
declare cid uuid; n int; u1 int; u2 int; f uuid; fp numeric; f2 uuid; f2p numeric;
begin
  select count(*) into n from camps where name ilike '%winter%camp%2027%';
  if n <> 1 then raise exception 'ожидался ровно один сбор Winter Camp 2027, найдено %', n; end if;
  select id into cid from camps where name ilike '%winter%camp%2027%';
  select id, price into f, fp from camp_tariffs where camp_id = cid and regexp_replace(replace(lower(btrim(name)),'ё','е'),'\s+',' ','g') = 'футболист' and active;
  -- «Футболист + 2 родителя» — это бывший «Ребенок + 2 родителя» (тот же тариф, id тот же); если ещё не переименован, переименовываем здесь
  select id, price into f2, f2p from camp_tariffs where camp_id = cid and active and regexp_replace(replace(lower(btrim(name)),'ё','е'),'\s+',' ','g') in ('футболист + 2 родителя', 'ребенок + 2 родителя');
  update camp_tariffs set name = 'Футболист + 2 родителя' where id = f2 and name <> 'Футболист + 2 родителя';
  if f is null or f2 is null then raise exception 'нет активных тарифов «Футболист» и «Футболист + 2 родителя» / «Ребенок + 2 родителя»: проверьте названия в ПРОВЕРКЕ'; end if;

  -- «Футболист»: тариф тот же, новая цена
  update camp_participants p set amount = fp
   where p.camp_id = cid and p.status = 'registered' and p.tariff_id = f and p.amount <> fp
     and fp >= coalesce((select sum(x.amount) from camp_payments x where x.participant_id = p.id), 0);
  get diagnostics u1 = row_count;
  -- любой другой тариф: «Футболист + 2 родителя»
  update camp_participants p set tariff_id = f2, amount = f2p
   where p.camp_id = cid and p.status = 'registered' and p.tariff_id <> f and (p.tariff_id <> f2 or p.amount <> f2p)
     and f2p >= coalesce((select sum(x.amount) from camp_payments x where x.participant_id = p.id), 0);
  get diagnostics u2 = row_count;

  select count(*) into n from camp_participants p
   where p.camp_id = cid and p.status = 'registered'
     and not ((p.tariff_id = f and p.amount = fp) or (p.tariff_id = f2 and p.amount = f2p));
  raise notice 'Футболист: %, переведено/пересчитано на «Футболист + 2 родителя»: %, пропущено из-за переплаты (нужен возврат): %', u1, u2, n;
end $$;
commit;

-- Результат: повторите вторую выборку ПРОВЕРКИ. Должны остаться только записи с overpaid > 0.

-- ===== ОТКАТ (только если понадобится) =====
-- По сохранённому снимку из ПРОВЕРКИ: для каждой строки вернуть tariff_id_now и amount_now.
-- Подставьте строки снимка в values(...). Платежи скрипт не менял, их откатывать не нужно.
-- begin;
-- update camp_participants p set tariff_id = v.tariff_id, amount = v.amount
--   from (values
--     ('<id>'::uuid, '<tariff_id_now>'::uuid, <amount_now>::numeric)
--   ) as v(id, tariff_id, amount)
--  where p.id = v.id;
-- commit;
