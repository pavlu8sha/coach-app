-- 0210 (Issue #677, этап 3 раздела «Мероприятия», условия: docs/CLUB_EVENTS_ACCEPTANCE.md v6, разделы PAY, PAY V1, IDEM, HIST, CASH, PR11, PR12):
-- платежи мероприятий в существующем журнале service_payments (kind='event', op='payment'), приём платежа функцией club_event_pay,
-- страховочный триггер на прямую вставку, вид 'event' в kind_check, ограничение «для мероприятия только payment», баланс (засчитано, долг,
-- переплата) в списке участников и карточке, нижняя граница цены отменённой записи (PR11, PR12) и две кассовые функции.
-- Решение владельца 16.11 (V1): новых таблиц платежей нет; возвратов, переносов, сторно, отмены и правки платежа в приложении нет;
-- способ оплаты обязателен (Наличные или Перевод); ошибочный платёж исправляется вне приложения механизмом 0179 (audit_log).
-- Тела cash_report и cash_day_service пересобраны из последнего определения в master (0200): добавлены только ветка 'event' в подписи вида,
-- клубный фильтр по платежам мероприятий и название мероприятия в detail. Локальный админ мероприятий не видит (location пуст).
-- Применять после 0204. Откат: db/ops/rollback-0210-club-event-payments.sql (только пока платежей мероприятий нет).

-- 1. Виды и ограничения журнала
alter table service_payments drop constraint if exists service_payments_kind_check;
alter table service_payments add constraint service_payments_kind_check check (kind in ('equipment', 'individual', 'extra', 'visit', 'own_visit', 'event'));
alter table service_payments drop constraint if exists service_payments_event_op_check;
alter table service_payments add constraint service_payments_event_op_check check (kind <> 'event' or (op = 'payment' and cancels is null and note is null));

-- 2. Страховка от обхода функции: те же правила на уровне таблицы (PAY13). Прямая вставка без JWT админа клуба невозможна.
create or replace function service_payments_event_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev club_events; pt club_event_participants;
begin
  if new.kind <> 'event' then return new; end if;
  if new.request_id is null then raise exception 'request id required' using errcode = '22023'; end if;
  if new.amount is null or new.amount <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  perform service_method_ok(new.method);
  if new.paid_on is null or new.paid_on > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  select * into ev from club_events where id = new.ref_id for share;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id is distinct from club_event_current_club() then raise exception 'forbidden' using errcode = '42501'; end if;
  if ev.status not in ('active', 'finished') then raise exception 'event not open for payments' using errcode = '55000'; end if;
  select * into pt from club_event_participants where event_id = ev.id and player_id = new.player_id for share;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if pt.status <> 'active' then raise exception 'participant cancelled' using errcode = '55000'; end if;
  return new;
end $$;
revoke execute on function service_payments_event_guard() from public, anon, authenticated;
drop trigger if exists service_payments_event_guard on service_payments;
create trigger service_payments_event_guard before insert on service_payments for each row execute function service_payments_event_guard();

-- 3. Приём платежа. Параметры только полные (нет «черновика»), p_paid_on = null означает сегодня по Тбилиси.
-- Платёж сверх долга принимается (переплата): в ответе overpay_added показывает, сколько платежа сверх долга.
-- Блокировки: мероприятие, затем запись (тот же порядок, что у отмены, смены статуса и цены), поэтому гонки с отменой закрыты.
create or replace function club_event_pay(p_event uuid, p_player uuid, p_amount numeric, p_method text, p_paid_on date, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; uid uuid := current_user_id(); ev club_events; pt club_event_participants; ex service_payments;
        price numeric; counted numeric; pid uuid; before_amt numeric;
begin
  c := club_event_assert_admin();
  if p_request is null then raise exception 'request id required' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 100000000 then raise exception 'bad amount' using errcode = '22023'; end if;
  perform service_method_ok(p_method);
  if p_paid_on is not null and p_paid_on > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  select * into ev from club_events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pt from club_event_participants where event_id = p_event and player_id = p_player for update;
  -- повтор запроса: тот же результат без новой строки; тот же ключ с другими параметрами отклоняется
  select * into ex from service_payments where recorded_by = uid and request_id = p_request;
  if found then
    if ex.kind = 'event' and ex.ref_id = p_event and ex.player_id = p_player and ex.amount = p_amount and ex.method = btrim(p_method)
       and (p_paid_on is null or ex.paid_on = p_paid_on) then
      price := coalesce(pt.individual_price, ev.base_price);
      counted := coalesce((select sum(sp.amount) from service_payments sp where sp.kind = 'event' and sp.ref_id = p_event and sp.player_id = p_player and sp.op = 'payment'), 0);
      return jsonb_build_object('applied', false, 'payment_id', ex.id, 'price', price, 'counted', counted,
                                'debt', greatest(price - counted, 0), 'overpay', greatest(counted - price, 0), 'overpay_added', null);
    end if;
    raise exception 'request id reused' using errcode = '22023';
  end if;
  if ev.status not in ('active', 'finished') then raise exception 'event not open for payments' using errcode = '55000'; end if;
  if pt.id is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if pt.status <> 'active' then raise exception 'participant cancelled' using errcode = '55000'; end if;
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id)
  values ('event', p_event, p_player, p_amount, coalesce(p_paid_on, tbilisi_day(now())), btrim(p_method), 'payment', p_request)
  returning id into pid;
  price := coalesce(pt.individual_price, ev.base_price);
  counted := coalesce((select sum(sp.amount) from service_payments sp where sp.kind = 'event' and sp.ref_id = p_event and sp.player_id = p_player and sp.op = 'payment'), 0);
  before_amt := counted - p_amount;
  return jsonb_build_object('applied', true, 'payment_id', pid, 'price', price, 'counted', counted,
                            'debt', greatest(price - counted, 0), 'overpay', greatest(counted - price, 0),
                            'overpay_added', greatest(p_amount - greatest(price - before_amt, 0), 0));
end $$;
revoke execute on function club_event_pay(uuid, uuid, numeric, text, date, uuid) from public, anon;
grant execute on function club_event_pay(uuid, uuid, numeric, text, date, uuid) to authenticated;

-- 4. Нижняя граница цены отменённой записи (PR11, PR12) и предупреждение о переплате; тело из 0204 + граница
create or replace function club_event_participant_set_price(p_participant uuid, p_price numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; ev club_events; pt club_event_participants; eid uuid; old_eff numeric; new_eff numeric; counted numeric;
begin
  c := club_event_assert_admin();
  select event_id into eid from club_event_participants where id = p_participant;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  select * into ev from club_events where id = eid for update;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pt from club_event_participants where id = p_participant for update;
  if p_price is not null and (p_price < 0 or p_price <> round(p_price, 2) or p_price >= 100000000) then raise exception 'bad price' using errcode = '22023'; end if;
  if pt.individual_price is not distinct from p_price then return jsonb_build_object('applied', false); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'price change needs reason' using errcode = '22023'; end if;
  old_eff := coalesce(pt.individual_price, ev.base_price);
  new_eff := coalesce(p_price, ev.base_price);
  counted := coalesce((select sum(sp.amount) from service_payments sp where sp.kind = 'event' and sp.ref_id = eid and sp.player_id = pt.player_id and sp.op = 'payment'), 0);
  -- PR11/PR12: у отменённой записи цена не ниже засчитанного (долг закрывается только так); у активной ниже можно (переплата, предупреждение в ответе)
  if pt.status = 'cancelled' and new_eff < counted then raise exception 'price below counted' using errcode = '22023'; end if;
  update club_event_participants set individual_price = p_price, updated_at = now(), updated_by = current_user_id() where id = p_participant;
  insert into club_event_price_log (event_id, participant_id, scope, old_amount, new_amount, reason, actor_id)
    values (eid, p_participant, 'individual', old_eff, new_eff, btrim(p_reason), current_user_id());
  return jsonb_build_object('applied', true, 'price', new_eff, 'counted', counted, 'overpay', greatest(counted - new_eff, 0));
end $$;

-- 5. Баланс записи и мероприятия только из журнала (PAY17): тела из 0204 + поля баланса
create or replace function club_event_participants_list(p_event uuid, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid; ev club_events;
begin
  c := club_event_assert_admin();
  if p_status is not null and p_status not in ('active', 'cancelled') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into ev from club_events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', pt.id, 'player_id', pl.id, 'full_name', pl.full_name, 'group_id', pl.group_id, 'group_name', g.name,
             'player_status', pl.status, 'status', pt.status, 'base_price', ev.base_price, 'individual_price', pt.individual_price,
             'price', coalesce(pt.individual_price, ev.base_price),
             'counted', b.counted,
             'debt', greatest(coalesce(pt.individual_price, ev.base_price) - b.counted, 0),
             'overpay', greatest(b.counted - coalesce(pt.individual_price, ev.base_price), 0),
             'pay_state', case when coalesce(pt.individual_price, ev.base_price) > b.counted then 'debt'
                               when b.counted > coalesce(pt.individual_price, ev.base_price) then 'overpaid' else 'paid' end,
             'not_in_group', exists (select 1 from club_event_groups eg where eg.event_id = ev.id)
                             and (pl.group_id is null or not exists (select 1 from club_event_groups eg where eg.event_id = ev.id and eg.group_id = pl.group_id)))
           order by pl.full_name, pt.id)
      from club_event_participants pt join players pl on pl.id = pt.player_id left join groups g on g.id = pl.group_id
           cross join lateral (select coalesce(sum(sp.amount), 0) as counted from service_payments sp
                                where sp.kind = 'event' and sp.ref_id = pt.event_id and sp.player_id = pt.player_id and sp.op = 'payment') b
     where pt.event_id = p_event and (p_status is null or pt.status = p_status)), '[]'::jsonb);
end $$;

create or replace function club_event_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e club_events; c uuid;
begin
  c := club_event_assert_admin();
  select * into e from club_events where id = p_id;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if e.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'name', e.name, 'description', e.description, 'starts_on', e.starts_on, 'starts_time', e.starts_time, 'place', e.place,
    'base_price', e.base_price, 'signup_deadline', e.signup_deadline, 'capacity', e.capacity, 'status', e.status,
    'created_at', e.created_at, 'updated_at', e.updated_at,
    'finance', (select jsonb_build_object('counted', coalesce(sum(b.counted), 0), 'debt', coalesce(sum(greatest(b.price - b.counted, 0)), 0),
                                          'overpay', coalesce(sum(greatest(b.counted - b.price, 0)), 0))
                  from (select coalesce(x.individual_price, e.base_price) as price,
                               coalesce((select sum(sp.amount) from service_payments sp where sp.kind = 'event' and sp.ref_id = e.id and sp.player_id = x.player_id and sp.op = 'payment'), 0) as counted
                          from club_event_participants x where x.event_id = e.id) b),
    'active_count', (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'),
             'free_places', case when e.capacity is null then null else greatest(e.capacity - (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), 0) end,
             'over_limit', coalesce(e.capacity < (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), false),
             'club_wide', not exists (select 1 from club_event_groups g where g.event_id = e.id),
    'group_ids', coalesce((select jsonb_agg(g.group_id order by g.group_id) from club_event_groups g where g.event_id = e.id), '[]'::jsonb),
    'group_names', coalesce((select jsonb_agg(gr.name order by gr.name) from club_event_groups g join groups gr on gr.id = g.group_id where g.event_id = e.id), '[]'::jsonb));
end $$;

-- 6. Касса: ветка 'event' (CASH1–CASH5); тела из 0200 (последнее определение в master)

CREATE OR REPLACE FUNCTION public.cash_report(p_from date, p_to date, p_location text DEFAULT NULL::text, p_staff uuid DEFAULT NULL::uuid, p_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare res jsonb;
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad period' using errcode = '22023'; end if;

  with src as (
    select 'Абонемент' as kind, p.id, p.player_id, p.amount, p.paid_on, p.method, p.recorded_by, p.recorded_at, gr.location as location
      from payments p join players pl on pl.id = p.player_id left join groups gr on gr.id = pl.group_id
    union all
    select 'Сбор', c.id, c.player_id, c.amount, c.paid_on, c.method, c.recorded_by, c.recorded_at, cm.location
      from camp_payments c left join camps cm on cm.id = c.camp_id
    union all
    select 'Взнос матча', m.id, m.player_id, m.amount, m.paid_on, m.method, m.recorded_by, m.recorded_at, null
      from match_payments m
    union all
    select 'Взнос события', t.id, t.player_id, t.amount, t.paid_on, t.method, t.recorded_by, t.recorded_at, null
      from tournament_payments t
    union all
    select case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Доп. посещение' when 'own_visit' then 'Оплата за визит' when 'event' then 'Мероприятие' else 'Доп. занятие' end,
           sp.id, sp.player_id, sp.amount, sp.paid_on, sp.method, sp.recorded_by, sp.recorded_at,
           case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                        when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                        when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id)
                        when 'own_visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end
      from service_payments sp
     where sp.op <> 'opening_balance' and (sp.kind <> 'event' or exists (select 1 from club_events ce where ce.id = sp.ref_id and ce.club_id = club_event_current_club())) -- 0188: остатки до начала учёта не деньги периода; 0210: платежи мероприятий только своего клуба
  ), rows_f as (
    select s.*, case when s.method in ('Наличные', 'Перевод') then s.method else 'не указан' end as method_key
      from src s
     where s.paid_on between p_from and p_to
       and (p_location is null or s.location = p_location)
       and (p_staff is null or s.recorded_by = p_staff)
       and (is_admin() or (s.recorded_by = current_user_id()
                           and s.location in (select la.location from location_admins la where la.user_id = current_user_id())))
  ), rows_m as (
    select * from rows_f where p_method is null or method_key = p_method
  )
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from rows_m), 0),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method_key, 'sum', sm) order by method_key)
                             from (select method_key, sum(amount) sm from rows_m group by method_key) x), '[]'::jsonb),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', staff_name, 'sum', sm) order by staff_name)
                            from (select r.recorded_by as staff_id, coalesce(u.display_name, 'не указан') as staff_name, sum(r.amount) sm
                                    from rows_m r left join users u on u.id = r.recorded_by
                                   group by r.recorded_by, u.display_name) x), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', r.id, 'kind', r.kind, 'player', pl.full_name, 'amount', r.amount, 'paid_on', r.paid_on,
                        'method', r.method_key, 'staff', coalesce(u.display_name, 'не указан'), 'recorded_at', r.recorded_at,
                        'location', r.location)
                       order by r.paid_on, r.recorded_at nulls last, r.id)
                     from rows_m r join players pl on pl.id = r.player_id left join users u on u.id = r.recorded_by), '[]'::jsonb)
  ) into res;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.cash_day_service(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method, 'what', x.what,
                                        'player_id', x.player_id, 'full_name', x.full_name, 'recorded_at', x.recorded_at,
                                        'detail', x.detail)
                     order by x.recorded_at nulls last, x.id)
      from (
        select sp.id, sp.amount, sp.method, sp.player_id, pl.full_name, sp.recorded_at,
               case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Доп. посещение' when 'own_visit' then 'Оплата за визит' when 'event' then 'Мероприятие' else 'Доп. занятие' end as what,
               case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                            when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                            when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id)
                        when 'own_visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end as loc,
               case when sp.kind = 'event' then (select ce.name from club_events ce where ce.id = sp.ref_id) end as detail
          from service_payments sp join players pl on pl.id = sp.player_id
         where sp.paid_on = p_day and sp.op <> 'opening_balance' and (sp.kind <> 'event' or exists (select 1 from club_events ce where ce.id = sp.ref_id and ce.club_id = club_event_current_club())) -- 0188: остатки до начала учёта не деньги дня; 0210: платежи мероприятий только своего клуба
        union all
        select mp.id, mp.amount, mp.method, mp.player_id, pl.full_name, mp.recorded_at,
               'Взнос матча', null::text,
               concat_ws(' ', to_char(m.played_on, 'DD.MM'), nullif(m.opponent, ''))
          from match_payments mp join players pl on pl.id = mp.player_id join matches m on m.id = mp.match_id
         where mp.paid_on = p_day
        union all
        select tp.id, tp.amount, tp.method, tp.player_id, pl.full_name, tp.recorded_at,
               'Взнос события', null::text, t.name
          from tournament_payments tp join players pl on pl.id = tp.player_id join tournaments t on t.id = tp.tournament_id
         where tp.paid_on = p_day
      ) x
     where is_admin() or x.loc in (select la.location from location_admins la where la.user_id = current_user_id())
  ), '[]'::jsonb);
end $function$;

revoke execute on function club_event_participant_set_price(uuid, numeric, text), club_event_participants_list(uuid, text), club_event_get(uuid) from public, anon;
grant execute on function club_event_participant_set_price(uuid, numeric, text), club_event_participants_list(uuid, text), club_event_get(uuid) to authenticated;
