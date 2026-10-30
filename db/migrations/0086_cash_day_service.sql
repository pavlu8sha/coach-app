-- 0086 (#259): список «Внесено за день» в кассе видит оплаты экипировки, индивидуальных и доп. занятий (журнал service_payments, 0083).
-- Область видимости как у отчёта (0085): глобальный админ — все; локальный — только свои локации. Индивидуальные занятия
-- (нет локации) видит только глобальный админ. Отмена здесь не предлагается: её делают в своих разделах.

create or replace function cash_day_service(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method, 'what', x.what,
                                        'player_id', x.player_id, 'full_name', x.full_name)
                     order by x.recorded_at nulls last, x.id)
      from (
        select sp.id, sp.amount, sp.method, sp.player_id, pl.full_name, sp.recorded_at,
               case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' else 'Доп. занятие' end as what,
               case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                            when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id) end as loc
          from service_payments sp join players pl on pl.id = sp.player_id
         where sp.paid_on = p_day
      ) x
     where is_admin() or x.loc in (select la.location from location_admins la where la.user_id = current_user_id())
  ), '[]'::jsonb);
end $$;

revoke execute on function cash_day_service(date) from public, anon;
grant execute on function cash_day_service(date) to authenticated;
