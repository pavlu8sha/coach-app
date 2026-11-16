-- 0206: итог за месяц у игрока «Платит за визит» считает и доп. посещения чужих групп (session_guests, 0178/0201).
-- Находка владельца 2026-11-16: у Polosin Kirill «ноябрь: визитов 0», хотя у него оплаченное доп. посещение; player_visit_month (0200) считал только own_visits.
-- Условия: docs/PAY_PER_VISIT_VISITS_ACCEPTANCE.md. Меняется только player_visit_month: в ответ добавлено guest_visits, visits/accrued/paid включают доп. посещения
-- (день занятия по Тбилиси не раньше pay_mode_from). Тело взято из последнего определения (0200; grep -lEi "function +(public\.)?player_visit_month *\(" db/migrations/*.sql).
-- Права не меняются (create or replace). Откат: db/ops/rollback-0206-visit-month-guests.sql. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
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
           'guest_visits', count(*) filter (where v.guest),
           'accrued', coalesce(sum(v.amount), 0),
           'paid', coalesce(sum(case when v.paid then coalesce(v.paid_amount, v.amount) else 0 end), 0))
    into res
    from (
      select ov.amount, ov.paid, ov.paid_amount, false as guest
        from own_visits ov join sessions s on s.id = ov.session_id
       where ov.player_id = p and date_trunc('month', tbilisi_day(s.starts_at))::date = mm
      union all
      select sg.amount, sg.paid, sg.paid_amount, true
        from session_guests sg join sessions s on s.id = sg.session_id
       where sg.player_id = p and pl.pay_mode_from is not null and tbilisi_day(s.starts_at) >= pl.pay_mode_from
         and date_trunc('month', tbilisi_day(s.starts_at))::date = mm
    ) v;
  return res || jsonb_build_object('subscription_price', tariff_for(pl.club_id, pl.group_id, mm));
end $$;

commit;
