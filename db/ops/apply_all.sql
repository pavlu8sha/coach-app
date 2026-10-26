-- Миграции 0058–0058 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0058.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0058 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0058_parent_dues.sql =====
-- Родителю: всё, что по ребёнку к оплате и оплачено, не только абонемент (экипировка, индивидуальные и вратарские, дополнительные, сборы).
-- Показ управляется той же клубной настройкой parent_debt_enabled, что и долг по абонементу; ребёнка видит только его привязанный родитель.
-- Абонемент по месяцам остаётся в parent_debts(), здесь он не повторяется.
create or replace function parent_dues()
returns table (player_id uuid, kind text, title text, on_date date, due numeric, paid numeric, debt numeric)
language plpgsql stable security definer set search_path = public as $$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  )
  select o.player_id, 'eq'::text,
         coalesce((select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id), 'Экипировка'),
         o.ordered_on, o.total, o.paid, greatest(o.total - o.paid, 0)
  from equipment_orders o join kids k on k.pid = o.player_id
  union all
  select b.player_id, 'ind'::text, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end,
         s.starts_at::date, b.amount, case when b.paid then b.amount else 0 end, case when b.paid then 0 else b.amount end
  from individual_bookings b join individual_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_at < local_now
  union all
  select b.player_id, 'extra'::text, 'Дополнительная тренировка' || coalesce(', ' || s.place, ''),
         s.starts_on, s.amount, case when b.paid then coalesce(b.paid_amount, s.amount) else 0 end,
         case when b.paid then greatest(s.amount - coalesce(b.paid_amount, s.amount), 0) else s.amount end
  from extra_bookings b join extra_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_on <= today
  union all
  select cp.player_id, 'camp'::text, c.name, c.starts_on, cp.amount, coalesce(pm.amt, 0), greatest(cp.amount - coalesce(pm.amt, 0), 0)
  from camp_participants cp join camps c on c.id = cp.camp_id join kids k on k.pid = cp.player_id
  left join lateral (select sum(x.amount) amt from camp_payments x where x.participant_id = cp.id) pm on true
  where cp.status = 'registered'
  order by 4 desc;
end $$;

revoke execute on function parent_dues() from public, anon;
grant execute on function parent_dues() to authenticated;

commit;
