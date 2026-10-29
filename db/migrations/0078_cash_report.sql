-- 0078 (#264): кассовый отчёт по сотрудникам и способам оплаты. Только администратор (глобальный; права по локациям — отдельно).
-- Источники: payments (абонемент), camp_payments (сборы), match_payments (взносы матчей), tournament_payments (взносы событий).
-- Учитываются строки журналов по дате оплаты paid_on (фактическая дата денег). Отмена — строка с минусом: видна в детализации,
-- сумма сходится, положительным поступлением не считается. Способ вне двух допустимых («Наличные», «Перевод») — «не указан».
-- Карты в модели нет. Локация: для абонемента и сборов — группа игрока и локация сбора; для взносов матчей и событий
-- локации нет, они попадают в отчёт только без фильтра по локации.
-- Итоги по сотрудникам, по способам и общая сумма считаются из одного набора строк, поэтому сходятся.

create or replace function cash_report(
  p_from date, p_to date,
  p_location text default null, p_staff uuid default null, p_method text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
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
  ), rows_f as (
    select s.*, case when s.method in ('Наличные', 'Перевод') then s.method else 'не указан' end as method_key
      from src s
     where s.paid_on between p_from and p_to
       and (p_location is null or s.location = p_location)
       and (p_staff is null or s.recorded_by = p_staff)
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
end $$;

revoke execute on function cash_report(date, date, text, uuid, text) from public, anon;
grant execute on function cash_report(date, date, text, uuid, text) to authenticated;
