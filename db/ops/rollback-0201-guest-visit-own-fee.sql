-- ОТКАТ 0201: возвращает session_guest_add из 0178 (цена гостя всегда visit.fee). Уже созданные строки session_guests не меняются. Сначала db/ops/preflight.sql.
begin;
create or replace function session_guest_add(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses sessions; pl players; club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select * into pl from players where id = p;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  select g.club_id into club from groups g where g.id = ses.group_id;
  if pl.club_id is distinct from club then raise exception 'player not found' using errcode = 'P0002'; end if;
  if tbilisi_day(ses.starts_at) > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
  if pl.group_id is not distinct from ses.group_id then raise exception 'same group' using errcode = '22023'; end if;
  if pl.status <> 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  insert into session_guests (session_id, player_id, amount, added_by)
    values (s, p, guest_visit_fee(club), current_user_id())
    on conflict (session_id, player_id) do nothing;
end $$;

commit;
