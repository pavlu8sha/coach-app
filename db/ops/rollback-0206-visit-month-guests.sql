-- ОТКАТ 0206: возвращает player_visit_month из 0200 (только визиты своей группы, без guest_visits). Данные не меняются. Сначала db/ops/preflight.sql.
begin;
create or replace function player_visit_month(p uuid, m date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mm date := date_trunc('month', m)::date; pl players; res jsonb;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach() or is_guardian_of(p) or is_self_player(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
           'month', mm,
           'visits', count(*),
           'accrued', coalesce(sum(v.amount), 0),
           'paid', coalesce(sum(case when v.paid then coalesce(v.paid_amount, v.amount) else 0 end), 0))
    into res
    from own_visits v join sessions s on s.id = v.session_id
   where v.player_id = p and date_trunc('month', tbilisi_day(s.starts_at))::date = mm;
  return res || jsonb_build_object('subscription_price', tariff_for(pl.club_id, pl.group_id, mm));
end $$;
commit;
