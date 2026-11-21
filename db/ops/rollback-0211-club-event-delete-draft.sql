-- ОТКАТ 0211 (раздел «Мероприятия», скрытие черновика): удаляет club_event_delete_draft и триггер, возвращает ограничения статуса и журнала
-- без 'deleted', club_event_list и club_event_get к телам 0204 и 0210.
-- Защита: откат отказывает, если есть скрытые мероприятия (иначе они снова стали бы видимыми черновиками). Сначала db/ops/preflight.sql; данные сохранить выгрузкой.
begin;
do $$
begin
  if exists (select 1 from club_events where status = 'deleted') then
    raise exception 'club_events has deleted drafts: export them before rollback';
  end if;
end $$;
drop trigger if exists club_events_deleted_frozen on club_events;
drop function if exists club_event_deleted_frozen();
drop function if exists club_event_delete_draft(uuid);
alter table club_events drop constraint if exists club_events_status_check;
alter table club_events add constraint club_events_status_check check (status in ('draft', 'active', 'finished', 'cancelled'));
alter table club_event_log drop constraint if exists club_event_log_action_check;
alter table club_event_log add constraint club_event_log_action_check check (action in ('created', 'updated', 'status'));

-- тела 0204 и 0210
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
      from club_events e where e.club_id = c and (p_status is null or e.status = p_status)), '[]'::jsonb);
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
revoke execute on function club_event_list(text), club_event_get(uuid) from public, anon;
grant execute on function club_event_list(text), club_event_get(uuid) to authenticated;
commit;
