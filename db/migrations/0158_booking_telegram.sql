-- Запись на тренировку из Telegram-бота (Issue #274). Условия: docs/TELEGRAM_BOOKING_ACCEPTANCE.md.
-- Бот вызывает три функции (только service_role). Они переводят Telegram ID в пользователя и вызывают ту же логику,
-- что приложение: booking_signup (запись) и waitlist_join (очередь). Правил допуска, сроков, дублей и вместимости здесь нет.
-- Ребёнок выбирается по первым восьми знакам id (callback_data короче 64 байт); он должен быть связан с этим пользователем
-- и согласие не отозвано, иначе возвращается forbidden. Занятие определяется по id: индивидуальное, вратарское или дополнительное.

-- Ребёнок пользователя по восьми знакам id; null, если таких нет или их несколько.
create or replace function booking_tg_child(u uuid, p_child text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r uuid; n int;
begin
  if u is null or p_child is null or p_child !~ '^[0-9a-f]{8}$' then return null; end if;
  select count(*), min(g.player_id::text)::uuid into n, r
    from player_guardians g
   where g.user_id = u and g.consent_revoked_at is null and g.player_id::text like p_child || '%';
  if n is distinct from 1 then return null; end if;
  return r;
end $$;
revoke execute on function booking_tg_child(uuid, text) from public, anon, authenticated;

-- Вид занятия для booking_signup / waitlist_join: individual, goalkeeper или extra. null, если занятия нет.
create or replace function booking_tg_kind(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when i.goalkeepers then 'goalkeeper' else 'individual' end from individual_sessions i where i.id = s
  union all
  select 'extra' from extra_sessions e where e.id = s
  limit 1
$$;
revoke execute on function booking_tg_kind(uuid) from public, anon, authenticated;

-- Текст ошибки базы → код для бота (тексты — в tg-bot/booking-logic.js).
create or replace function booking_tg_code(st text, msg text) returns text
language sql immutable as $$
  select case
    when msg like '%already booked%' then 'already'
    when msg like '%session full%' then 'full'
    when msg like '%seat available%' then 'free'
    when msg like '%session in the past%' or msg like '%session cancelled%' then 'closed'
    when msg like '%session not found%' then 'not_found'
    when msg like '%not eligible%' or msg like '%player not active%' then 'not_allowed'
    when st = '42501' then 'forbidden'
    else 'error'
  end
$$;
revoke execute on function booking_tg_code(text, text) from public, anon, authenticated;

-- Список для бота: занятия, у которых есть хотя бы один подходящий ребёнок пользователя (без записи).
-- Для каждого занятия: id, вид, подпись, есть ли места и дети ({id8, name}). Занятие без мест тоже показывается, чтобы предложить очередь.
create or replace function booking_options_by_telegram(p_telegram_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; out jsonb;
begin
  select id into u from users where telegram_id = p_telegram_id;
  if u is null then return jsonb_build_object('ok', false, 'code', 'unknown_user'); end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  with kids as (
    select pl.id, pl.full_name from player_guardians g join players pl on pl.id = g.player_id
     where g.user_id = u and g.consent_revoked_at is null and pl.status = 'active'
  ), b as (
    select * from booking_board() where kind in ('individual', 'goalkeeper', 'extra')
  ), rows as (
    select b.kind, b.session_id, b.starts_at, b.capacity, b.booked, b.amount,
           coalesce((select jsonb_agg(jsonb_build_object('id8', left(k.id::text, 8), 'name', k.full_name) order by k.full_name)
                       from kids k
                      where not exists (select 1 from individual_bookings x where x.session_id = b.session_id and x.player_id = k.id)
                        and not exists (select 1 from extra_bookings x where x.session_id = b.session_id and x.player_id = k.id)
                        and (b.kind <> 'extra' or extra_eligible(b.session_id, k.id))), '[]'::jsonb) as children
      from b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.session_id, 'kind', r.kind, 'label', booking_session_label(r.kind, r.session_id),
           'price', r.amount, 'free', (r.capacity is null or jsonb_array_length(r.booked) < r.capacity),
           'children', r.children) order by r.starts_at, r.session_id), '[]'::jsonb)
    into out
    from rows r
   where jsonb_array_length(r.children) > 0;
  return jsonb_build_object('ok', true, 'sessions', out);
end $$;
revoke execute on function booking_options_by_telegram(bigint) from public, anon, authenticated;
grant execute on function booking_options_by_telegram(bigint) to service_role;

-- Запись ребёнка на занятие нажатием кнопки. Возвращает { ok, code, player, label }. Повтор → code 'already' (ничего не создаётся).
create or replace function booking_signup_by_telegram(p_telegram_id bigint, p_session uuid, p_child text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; pl uuid; k text; nm text; conf jsonb;
begin
  select id into u from users where telegram_id = p_telegram_id;
  if u is null then return jsonb_build_object('ok', false, 'code', 'unknown_user'); end if;
  pl := booking_tg_child(u, p_child);
  if pl is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  k := booking_tg_kind(p_session);
  if k is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  select full_name into nm from players where id = pl;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform booking_signup(k, p_session, pl);
  exception when others then
    return jsonb_build_object('ok', false, 'code', booking_tg_code(sqlstate, sqlerrm), 'player', nm, 'label', booking_session_label(k, p_session));
  end;
  -- пересечение по времени: только предупреждение, запись не запрещается
  begin
    select coalesce(jsonb_agg(c.label || ' ' || to_char(c.starts_at, 'DD.MM HH24:MI') order by c.starts_at), '[]'::jsonb) into conf from booking_conflicts(k, p_session, pl) c;
  exception when others then conf := '[]'::jsonb;
  end;
  return jsonb_build_object('ok', true, 'code', 'ok', 'player', nm, 'label', booking_session_label(k, p_session), 'conflicts', conf);
end $$;
revoke execute on function booking_signup_by_telegram(bigint, uuid, text) from public, anon, authenticated;
grant execute on function booking_signup_by_telegram(bigint, uuid, text) to service_role;

-- Постановка в очередь по отдельному нажатию «Встать в очередь». Автоматически в очередь ничего не попадает.
create or replace function waitlist_join_by_telegram(p_telegram_id bigint, p_session uuid, p_child text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; pl uuid; k text; nm text;
begin
  select id into u from users where telegram_id = p_telegram_id;
  if u is null then return jsonb_build_object('ok', false, 'code', 'unknown_user'); end if;
  pl := booking_tg_child(u, p_child);
  if pl is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  k := booking_tg_kind(p_session);
  if k is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  select full_name into nm from players where id = pl;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform waitlist_join(k, p_session, pl);
  exception when others then
    return jsonb_build_object('ok', false, 'code', booking_tg_code(sqlstate, sqlerrm), 'player', nm, 'label', booking_session_label(k, p_session));
  end;
  return jsonb_build_object('ok', true, 'code', 'ok', 'player', nm, 'label', booking_session_label(k, p_session));
end $$;
revoke execute on function waitlist_join_by_telegram(bigint, uuid, text) from public, anon, authenticated;
grant execute on function waitlist_join_by_telegram(bigint, uuid, text) to service_role;
