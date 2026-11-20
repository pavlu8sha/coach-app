-- Откат 0213: вернуть player_set_pay_mode без вызова дозаполнения и удалить own_visits_backfill. Созданные ею строки own_visits не удаляются (это визиты, по ним могут быть оплаты).
drop function if exists own_visits_backfill(uuid);
-- Исходное тело player_set_pay_mode из 0200:
create or replace function player_set_pay_mode(p uuid, mode text, from_d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare pl players; nf date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mode is null or mode not in ('subscription', 'per_visit') then raise exception 'bad pay mode' using errcode = '22023'; end if;
  select * into pl from players where id = p for update;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  nf := case when mode = 'per_visit' then coalesce(from_d, tbilisi_day(now())) else null end;
  if nf is not null and nf > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
  if pl.pay_mode = mode and pl.pay_mode_from is not distinct from nf then return; end if;
  update players set pay_mode = mode, pay_mode_from = nf where id = p;
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (current_user_id(), 'player_pay_mode', 'players', p,
          jsonb_build_object('pay_mode', pl.pay_mode, 'pay_mode_from', pl.pay_mode_from),
          jsonb_build_object('pay_mode', mode, 'pay_mode_from', nf));
end $$;
revoke execute on function player_set_pay_mode(uuid, text, date) from public, anon;
grant execute on function player_set_pay_mode(uuid, text, date) to authenticated;
