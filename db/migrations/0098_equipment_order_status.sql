-- 0098 (#240): статус заказа экипировки, история изменений и текст требования к тренировочной форме.
-- Жизненный цикл: accepted «Принят в заказ» → sewing «Начался пошив» → ready «Готов к выдаче» → issued «Выдан».
-- Менять статус может администратор и локальный администратор заказа (вперёд на один шаг); назад на один шаг — только администратор.
-- Родитель только читает статус и историю своего ребёнка. Суммы, оплаты, строки заказа и выдача по комплектам (equipment_issues) не меняются.

alter table equipment_orders
  add column if not exists status text not null default 'accepted' check (status in ('accepted', 'sewing', 'ready', 'issued'));

-- Уже существующие заказы: «Выдан», если выданы все комплекты заказа (по equipment_issues), иначе «Принят в заказ».
-- Частично выданные и заказы без строк остаются «Принят в заказ»: их разберёт администратор вручную.
update equipment_orders o set status = 'issued'
where o.status = 'accepted'
  and exists (select 1 from equipment_order_lines l where l.order_id = o.id)
  and not exists (
    select 1 from equipment_order_lines l
    where l.order_id = o.id
      and not exists (select 1 from equipment_issues i where i.order_id = o.id and i.kit = l.kit)
  );

create table if not exists equipment_order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references equipment_orders(id) on delete cascade,
  status text not null check (status in ('accepted', 'sewing', 'ready', 'issued')),
  changed_at timestamptz not null default now(),
  changed_by uuid references users(id),
  changed_by_name text
);
create index if not exists equipment_order_status_history_order_idx on equipment_order_status_history (order_id, changed_at);

alter table equipment_order_status_history enable row level security;
drop policy if exists equipment_status_history_read on equipment_order_status_history;
create policy equipment_status_history_read on equipment_order_status_history for select using (
  is_admin() or exists (
    select 1 from equipment_orders o
    where o.id = order_id and (is_location_admin(o.location) or is_guardian_of(o.player_id))
  )
);
-- Прямая запись закрыта: историю пишет только eq_set_order_status.
revoke all on equipment_order_status_history from anon, authenticated;
grant select on equipment_order_status_history to authenticated;
grant all on equipment_order_status_history to service_role;

-- Смена статуса: один шаг вперёд (администратор и локальный администратор заказа) или один шаг назад (только администратор).
create or replace function eq_set_order_status(o uuid, st text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders;
  steps text[] := array['accepted', 'sewing', 'ready', 'issued'];
  cur int;
  nxt int;
begin
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_location_admin(eo.location)) then raise exception 'forbidden' using errcode = '42501'; end if;
  cur := array_position(steps, eo.status);
  nxt := array_position(steps, st);
  if nxt is null then raise exception 'bad status' using errcode = '22023'; end if;
  if abs(nxt - cur) <> 1 then raise exception 'bad transition' using errcode = '22023'; end if;
  if nxt < cur and not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update equipment_orders set status = st where id = o;
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name)
  values (o, st, current_user_id(), (select display_name from users where id = current_user_id()));
end $$;

-- Требование к тренировочной форме. Администратор правит текст в club_settings (ключ equipment.required_text);
-- родителю отдаётся только этот ключ, чтение club_settings не открывается. Пока текст не задан, возвращается утверждённая формулировка.
create or replace function equipment_requirement() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(value), '') from club_settings where key = 'equipment.required_text' and scope = '' limit 1),
    'Тренировочный комплект FC Kickstart обязателен для всех воспитанников: клуб переходит на единую тренировочную экипировку. Если у ребёнка уже есть старая форма клуба, её можно использовать.'
  )
$$;

revoke execute on function eq_set_order_status(uuid, text), equipment_requirement() from public, anon;
grant execute on function eq_set_order_status(uuid, text), equipment_requirement() to authenticated;
