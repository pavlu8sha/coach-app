-- Миграции 0051–0053 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0051.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0051 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0051_events.sql =====
-- 0051: события (чемпионат, фестиваль, кубок): создание, состав участников, игры события.
-- Тренеры и администратор создают событие и ведут состав; сумма взноса и оплаты остаются только у администратора
-- (таблицы tournaments и tournament_fees закрыты RLS, тренеры работают через функции ниже).

create or replace function event_assert_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- Список событий со счётчиками (без сумм)
create or replace function event_list()
returns table (id uuid, team text, kind text, name text, starts_on date, players int, games int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select t.id, t.team, t.kind, t.name, t.starts_on,
           (select count(*)::int from tournament_fees f where f.tournament_id = t.id),
           (select count(*)::int from matches m where m.tournament_id = t.id)
      from tournaments t
     order by t.starts_on desc nulls last, t.name;
end $$;

-- Создание события; взнос задаёт только администратор, copy_from копирует состав другого события
create or replace function event_create(k text, tm text, nm text, d date, fee numeric, copy_from uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare club uuid; tid uuid; amount numeric(10,2) := 0;
begin
  perform event_assert_staff();
  if k not in ('championship', 'festival', 'cup') then raise exception 'invalid kind'; end if;
  if nullif(trim(tm), '') is null then raise exception 'team required'; end if;
  select g.club_id into club from groups g where g.name = trim(tm) limit 1;
  if club is null then select c.id into club from clubs c order by c.id limit 1; end if;
  if is_admin() and fee is not null then
    if fee < 0 then raise exception 'invalid fee'; end if;
    amount := fee;
  end if;
  insert into tournaments (club_id, team, kind, name, fee, starts_on)
    values (club, trim(tm), k, nullif(trim(nm), ''), amount, d) returning id into tid;
  if copy_from is not null then
    insert into tournament_fees (tournament_id, player_id, amount)
      select tid, f.player_id, amount from tournament_fees f where f.tournament_id = copy_from
      on conflict do nothing;
  end if;
  return tid;
end $$;

-- Состав события (имена без денег)
create or replace function event_roster(t uuid)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select p.id, p.full_name, g.name
      from tournament_fees f join players p on p.id = f.player_id left join groups g on g.id = p.group_id
     where f.tournament_id = t
     order by p.full_name;
end $$;

create or replace function event_roster_add(t uuid, ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare ev tournaments;
begin
  perform event_assert_staff();
  select * into ev from tournaments where id = t;
  if ev.id is null then raise exception 'event not found'; end if;
  insert into tournament_fees (tournament_id, player_id, amount)
    select t, p.id, ev.fee from players p where p.id = any (ids) and p.club_id = ev.club_id
    on conflict do nothing;
end $$;

create or replace function event_roster_remove(t uuid, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_staff();
  if exists (select 1 from tournament_fees where tournament_id = t and player_id = pid and paid) then
    raise exception 'fee already paid';
  end if;
  delete from tournament_fees where tournament_id = t and player_id = pid;
end $$;

-- Игра события: пустой матч команды события, состав и счёт вносятся обычной формой матча
create or replace function event_add_game(t uuid, d date, opp text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ev tournaments; mid uuid;
begin
  perform event_assert_staff();
  select * into ev from tournaments where id = t;
  if ev.id is null then raise exception 'event not found'; end if;
  insert into matches (club_id, played_on, team, opponent, kind, tournament_id)
    values (ev.club_id, d, ev.team, nullif(trim(opp), ''), 'game', t) returning id into mid;
  return mid;
end $$;

revoke execute on function event_assert_staff() from public, anon, authenticated;
revoke execute on function event_list() from public, anon;
revoke execute on function event_create(text, text, text, date, numeric, uuid) from public, anon;
revoke execute on function event_roster(uuid) from public, anon;
revoke execute on function event_roster_add(uuid, uuid[]) from public, anon;
revoke execute on function event_roster_remove(uuid, uuid) from public, anon;
revoke execute on function event_add_game(uuid, date, text) from public, anon;
grant execute on function event_list() to authenticated;
grant execute on function event_create(text, text, text, date, numeric, uuid) to authenticated;
grant execute on function event_roster(uuid) to authenticated;
grant execute on function event_roster_add(uuid, uuid[]) to authenticated;
grant execute on function event_roster_remove(uuid, uuid) to authenticated;
grant execute on function event_add_game(uuid, date, text) to authenticated;

-- ===== 0052_ind_change_type.sql =====
-- Тип занятия (индивидуальное / вратарское) можно менять после создания: раньше он выбирался только при создании (0034).
-- ind_edit_session получает пятый параметр gk: null — не менять (прежние вызовы с четырьмя параметрами работают), true/false — задать тип.
-- Внешний ключ занятия пересчитывается (суффикс -GK), занятие того же типа в то же время уже есть — отказ; при смене типа проверяется лимит мест нового типа.
drop function if exists ind_edit_session(uuid, date, time, text);
create or replace function ind_edit_session(s uuid, d date, t time, theme text, gk boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ext text; new_gk boolean; cap int; n int;
begin
  perform ind_assert_admin();
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  new_gk := coalesce(gk, ses.goalkeepers);
  if exists (select 1 from individual_bookings where session_id = s and paid) and (d + t) <> ses.starts_at then raise exception 'session has payments' using errcode = '22023'; end if;
  if new_gk <> ses.goalkeepers then
    cap := ind_cap(ses.club_id, new_gk);
    select count(*) into n from individual_bookings where session_id = s;
    if cap is not null and n > cap then raise exception 'session full' using errcode = '22023'; end if;
  end if;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when new_gk then '-GK' else '' end;
  if ext <> ses.external_id and exists (select 1 from individual_sessions where club_id = ses.club_id and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  update individual_sessions set starts_at = (d + t), external_id = ext, topic = nullif(trim(theme), ''), goalkeepers = new_gk where id = s;
end $$;
revoke execute on function ind_edit_session(uuid, date, time, text, boolean) from public, anon;
grant execute on function ind_edit_session(uuid, date, time, text, boolean) to authenticated;

-- ===== 0053_event_fees.sql =====
-- 0053: взносы за события (чемпионат, фестиваль, кубок): оплаты со способом и датой, скидка, отмена оплаты.
-- Всё только для администратора; тренеры суммы не видят. Оплата хранится строками tournament_payments,
-- флаг tournament_fees.paid пересчитывается (сумма оплат >= сумма к оплате). Отмена платежа добавляет строку с минусом.

create table if not exists tournament_payments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  player_id uuid not null,
  amount numeric(10,2) not null,
  paid_on date not null,
  method text,
  comment text,
  cancels uuid unique references tournament_payments(id),
  created_at timestamptz not null default now(),
  foreign key (tournament_id, player_id) references tournament_fees(tournament_id, player_id) on delete cascade
);
create index if not exists tournament_payments_event_idx on tournament_payments (tournament_id, player_id);
alter table tournament_payments enable row level security;
drop policy if exists tournament_payments_admin on tournament_payments;
create policy tournament_payments_admin on tournament_payments for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on tournament_payments to authenticated, service_role;

create or replace function event_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function event_fee_recalc(t uuid, pid uuid) returns void
language sql security definer set search_path = public as $$
  update tournament_fees f set paid = f.amount > 0 and coalesce((select sum(p.amount) from tournament_payments p where p.tournament_id = t and p.player_id = pid), 0) >= f.amount
   where f.tournament_id = t and f.player_id = pid
$$;

-- Взнос события: меняет сумму у тех, кому не давали скидку и кто ещё не платил
create or replace function event_set_fee(t uuid, amt numeric) returns void
language plpgsql security definer set search_path = public as $$
declare old numeric; r record;
begin
  perform event_assert_admin();
  if amt is null or amt < 0 then raise exception 'invalid fee'; end if;
  select t0.fee into old from tournaments t0 where t0.id = t;
  if not found then raise exception 'event not found'; end if;
  update tournaments set fee = amt where id = t;
  update tournament_fees f set amount = amt
   where f.tournament_id = t and f.amount = old
     and not exists (select 1 from tournament_payments p where p.tournament_id = t and p.player_id = f.player_id);
  for r in select player_id from tournament_fees where tournament_id = t loop
    perform event_fee_recalc(t, r.player_id);
  end loop;
end $$;

create or replace function event_fees(t uuid)
returns table (player_id uuid, full_name text, group_name text, due numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  return query
    select f.player_id, p.full_name, g.name, f.amount,
           coalesce((select sum(x.amount) from tournament_payments x where x.tournament_id = t and x.player_id = f.player_id), 0)
      from tournament_fees f join players p on p.id = f.player_id left join groups g on g.id = p.group_id
     where f.tournament_id = t
     order by p.full_name;
end $$;

create or replace function event_payments(t uuid)
returns table (id uuid, player_id uuid, full_name text, amount numeric, paid_on date, method text, comment text, cancelled boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  return query
    select x.id, x.player_id, p.full_name, x.amount, x.paid_on, x.method, x.comment,
           (x.cancels is not null or exists (select 1 from tournament_payments c where c.cancels = x.id))
      from tournament_payments x join players p on p.id = x.player_id
     where x.tournament_id = t
     order by x.paid_on desc, x.created_at desc;
end $$;

-- Оплата: одному или нескольким (до 60); amt пустая — доплата остатка у каждого
create or replace function event_pay(t uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public as $$
declare pid uuid; f tournament_fees; paid numeric; a numeric; n int := 0;
begin
  perform event_assert_admin();
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  foreach pid in array ids loop
    select * into f from tournament_fees where tournament_id = t and player_id = pid;
    if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
    select coalesce(sum(x.amount), 0) into paid from tournament_payments x where x.tournament_id = t and x.player_id = pid;
    a := coalesce(amt, f.amount - paid);
    if a > 0 then
      insert into tournament_payments (tournament_id, player_id, amount, paid_on, method, comment)
        values (t, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform event_fee_recalc(t, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Скидка: новая сумма к оплате у игрока
create or replace function event_discount(t uuid, pid uuid, due numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_admin();
  if due is null or due < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  update tournament_fees set amount = due where tournament_id = t and player_id = pid;
  if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
  perform event_fee_recalc(t, pid);
end $$;

create or replace function event_cancel_payment(payid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p tournament_payments;
begin
  perform event_assert_admin();
  select * into p from tournament_payments where id = payid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.amount <= 0 or p.cancels is not null or exists (select 1 from tournament_payments where cancels = payid) then
    raise exception 'not cancellable' using errcode = '22023';
  end if;
  insert into tournament_payments (tournament_id, player_id, amount, paid_on, comment, cancels)
    values (p.tournament_id, p.player_id, -p.amount, current_date, 'Отмена оплаты', payid);
  perform event_fee_recalc(p.tournament_id, p.player_id);
end $$;

-- Убрать из состава нельзя, пока есть оплаты
create or replace function event_roster_remove(t uuid, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_staff();
  if exists (select 1 from tournament_payments where tournament_id = t and player_id = pid) then
    raise exception 'fee already paid';
  end if;
  delete from tournament_fees where tournament_id = t and player_id = pid;
end $$;

revoke execute on function event_assert_admin() from public, anon, authenticated;
revoke execute on function event_fee_recalc(uuid, uuid) from public, anon, authenticated;
revoke execute on function event_set_fee(uuid, numeric) from public, anon;
revoke execute on function event_fees(uuid) from public, anon;
revoke execute on function event_payments(uuid) from public, anon;
revoke execute on function event_pay(uuid, uuid[], numeric, date, text, text) from public, anon;
revoke execute on function event_discount(uuid, uuid, numeric) from public, anon;
revoke execute on function event_cancel_payment(uuid) from public, anon;
grant execute on function event_set_fee(uuid, numeric) to authenticated;
grant execute on function event_fees(uuid) to authenticated;
grant execute on function event_payments(uuid) to authenticated;
grant execute on function event_pay(uuid, uuid[], numeric, date, text, text) to authenticated;
grant execute on function event_discount(uuid, uuid, numeric) to authenticated;
grant execute on function event_cancel_payment(uuid) to authenticated;

commit;
