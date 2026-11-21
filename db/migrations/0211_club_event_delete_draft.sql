-- 0211 «Мероприятия»: удаление черновика как скрытие (Issue #677, решение владельца 19.11, docs/CLUB_EVENTS_ACCEPTANCE.md, DEL1–DEL9).
-- Черновик без записей участников и без платежей получает статус 'deleted': из списка и club_event_get он исчезает, строка и журнал остаются,
-- физического удаления нет (триггер club_events_no_delete), статус 'deleted' необратим и скрытое мероприятие не меняется (триггер club_events_deleted_frozen).
-- Зависит от 0202, 0204, 0210. Откат: db/ops/rollback-0211-club-event-delete-draft.sql.
alter table club_events drop constraint if exists club_events_status_check;
alter table club_events add constraint club_events_status_check check (status in ('draft', 'active', 'finished', 'cancelled', 'deleted'));
alter table club_event_log drop constraint if exists club_event_log_action_check;
alter table club_event_log add constraint club_event_log_action_check check (action in ('created', 'updated', 'status', 'deleted'));

-- Скрытое мероприятие не меняется: ни правка, ни смена статуса, ни возврат из deleted
create or replace function club_event_deleted_frozen() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'deleted' then raise exception 'event deleted' using errcode = '55000'; end if;
  return new;
end $$;
revoke execute on function club_event_deleted_frozen() from public, anon, authenticated;
drop trigger if exists club_events_deleted_frozen on club_events;
create trigger club_events_deleted_frozen before update on club_events for each row execute function club_event_deleted_frozen();

create or replace function club_event_delete_draft(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; ev club_events; before_s jsonb;
begin
  c := club_event_assert_admin();
  select * into ev from club_events where id = p_id for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  if ev.status = 'deleted' then return jsonb_build_object('applied', false); end if;
  if ev.status <> 'draft' then raise exception 'only draft can be deleted' using errcode = '55000'; end if;
  if exists (select 1 from club_event_participants where event_id = p_id)
     or exists (select 1 from service_payments where kind = 'event' and ref_id = p_id) then
    raise exception 'event has participants' using errcode = '55000';
  end if;
  before_s := club_event_snapshot(p_id);
  update club_events set status = 'deleted', updated_at = now(), updated_by = current_user_id() where id = p_id;
  perform club_event_log_add(p_id, 'deleted', before_s, club_event_snapshot(p_id));
  return jsonb_build_object('applied', true);
end $$;
revoke execute on function club_event_delete_draft(uuid) from public, anon;
grant execute on function club_event_delete_draft(uuid) to authenticated;

-- Список и чтение без скрытых (тела из 0204 и 0210 + условие)
create or replace function club_event_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  c := club_event_assert_admin();
  if p_status is not null and p_status not in ('draft', 'active', 'finished', 'cancelled') then raise exception 'bad status' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'name', e.name, 'starts_on', e.starts_on, 'starts_time', e.starts_time, 'place', e.place, 'base_price', e.base_price,
             'signup_deadline', e.signup_deadline, 'capacity', e.capacity, 'status', e.status,
             'active_count', (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'),
             'free_places', case when e.capacity is null then null else greatest(e.capacity - (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), 0) end,
             'over_limit', coalesce(e.capacity < (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), false),
             'club_wide', not exists (select 1 from club_event_groups g where g.event_id = e.id),
             'group_ids', coalesce((select jsonb_agg(g.group_id order by g.group_id) from club_event_groups g where g.event_id = e.id), '[]'::jsonb),
             'group_names', coalesce((select jsonb_agg(gr.name order by gr.name) from club_event_groups g join groups gr on gr.id = g.group_id where g.event_id = e.id), '[]'::jsonb))
           order by (e.status in ('finished', 'cancelled')),
                    case when e.status in ('draft', 'active') then e.starts_on end asc,
                    e.starts_on desc, e.starts_time asc nulls first, e.id)
      from club_events e where e.club_id = c and e.status <> 'deleted' and (p_status is null or e.status = p_status)), '[]'::jsonb);
end $$;

create or replace function club_event_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e club_events; c uuid;
begin
  c := club_event_assert_admin();
  select * into e from club_events where id = p_id;
  if not found or e.status = 'deleted' then raise exception 'event not found' using errcode = 'P0002'; end if;
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
revoke execute on function club_event_list(text), club_event_get(uuid) from public, anon;
grant execute on function club_event_list(text), club_event_get(uuid) to authenticated;
