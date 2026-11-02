-- #339: два изменения по просьбе администратора.
-- 1) Лимит мест на дополнительной тренировке берётся из настройки клуба extra.cap (как ind.capIndividual для индивидуальных).
--    Пусто или 0 — без ограничения. Проверяется при записи родителем (booking_signup) и администратором (extra_add_player);
--    доска записи (booking_board) показывает лимит в поле capacity.
-- 2) Номер в экипировке больше не блокирует заказ: eq_create_order и eq_edit_order не проверяют, занят ли номер.
--    Подсказка о занятом номере показывается в приложении; функция eq_number_taken остаётся для справки.

create or replace function extra_cap(c uuid) returns int
language sql stable security definer set search_path = public as $$
  select nullif(nullif(regexp_replace(coalesce((select value from club_settings where club_id = c and key = 'extra.cap' and scope = ''), ''), '[^0-9]', '', 'g'), '')::int, 0)
$$;

create or replace function extra_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid; cap int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into c from extra_sessions where id = s for update;
  if c is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  cap := extra_cap(c);
  if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
  insert into extra_bookings (session_id, player_id) values (s, p);
end $$;

create or replace function booking_signup(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ex extra_sessions; now_local timestamp := now() at time zone 'Asia/Tbilisi'; nm text; cap int;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  select full_name into nm from players where id = p;
  if k in ('individual', 'goalkeeper') then
    select * into ses from individual_sessions where id = s and goalkeepers = (k = 'goalkeeper');
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ses.starts_at < now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    perform ind_book(s, p);
  elsif k = 'extra' then
    select * into ex from extra_sessions where id = s for update;
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ex.starts_on < now_local::date then raise exception 'session in the past' using errcode = '22023'; end if;
    if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
    cap := extra_cap(ex.club_id);
    if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
    insert into extra_bookings (session_id, player_id) values (s, p);
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные / Дополнительные.');
end $$;

-- Доска записи: как в 0088, но у дополнительной тренировки capacity = extra_cap вместо null.
drop function if exists booking_board();
create function booking_board()
returns table (kind text, session_id uuid, starts_at timestamp, ends_at timestamp, title text, place text, capacity int, amount numeric, booked jsonb, mine jsonb)
language plpgsql stable security definer set search_path = public as $$
declare now_local timestamp := now() at time zone 'Asia/Tbilisi';
begin
  if current_user_id() is null or not (is_admin() or booking_is_parent()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select case when s.goalkeepers then 'goalkeeper' else 'individual' end, s.id, s.starts_at, null::timestamp,
    coalesce(s.topic, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end), null::text,
    ind_cap(s.club_id, s.goalkeepers), ind_price(s.club_id, s.starts_at::date),
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', b.amount) order by pl.full_name)
              from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from individual_sessions s where s.starts_at >= now_local and s.starts_at < now_local + interval '60 days'
  union all
  select 'extra', e.id, e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'),
    case when e.ends_time is not null then e.starts_on::timestamp + e.ends_time end, 'Дополнительная тренировка', e.place, extra_cap(e.club_id), e.amount,
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', coalesce(b.paid_amount, e.amount)) order by pl.full_name)
              from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from extra_sessions e where e.starts_on >= now_local::date and e.starts_on < now_local::date + 60
  order by 3, 1;
end $$;

revoke execute on function booking_board() from public, anon;
grant execute on function booking_board() to authenticated;
revoke execute on function extra_cap(uuid) from public, anon, authenticated;
revoke execute on function extra_add_player(uuid, uuid), booking_signup(text, uuid, uuid) from public, anon;
grant execute on function extra_add_player(uuid, uuid), booking_signup(text, uuid, uuid) to authenticated;

-- Номер больше не блокирует заказ (тело как в 0036, без проверки eq_number_taken).
create or replace function eq_create_order(p uuid, lines jsonb, insc text, num text, inst boolean, loc text, custom_total numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; oid uuid; l jsonb; pr numeric; tot numeric := 0; q int;
begin
  perform eq_assert_admin();
  select club_id into c from players where id = p;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then raise exception 'no items' using errcode = '22023'; end if;
  insert into equipment_orders (club_id, player_id, ordered_on, inscription, number, installment, total, paid, location)
  values (c, p, current_date, nullif(trim(insc), ''), nullif(trim(num), ''), coalesce(inst, false), 0, 0, nullif(trim(loc), '')) returning id into oid;
  for l in select * from jsonb_array_elements(lines) loop
    pr := eq_price(c, l->>'kit', current_date);
    if pr is null then raise exception 'kit not in catalog' using errcode = '22023'; end if;
    q := coalesce((l->>'quantity')::int, 1);
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, l->>'kit', nullif(l->>'size', ''), q, pr);
    tot := tot + pr * q;
  end loop;
  if custom_total is not null and custom_total < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  update equipment_orders set total = coalesce(custom_total, tot) where id = oid;
  return oid;
end $$;

create or replace function eq_edit_order(o uuid, insc text, num text, inst boolean, loc text, new_total numeric) returns void
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if new_total is null or new_total < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
  update equipment_orders set inscription = nullif(trim(insc), ''), number = nullif(trim(num), ''), installment = coalesce(inst, false),
    location = nullif(trim(loc), ''), total = new_total where id = o;
end $$;
