-- Укрепление кода ребёнка (0028): криптостойкая генерация и ограничение числа попыток ввода.
--  * Раньше код строился через random() (не криптостойкий). Теперь — из gen_random_uuid() (источник CSPRNG), без смещения:
--    алфавит из 32 символов, 256 делится на 32 нацело.
--  * Ввод кода ограничен: 8 попыток за 10 минут с одного аккаунта и 200 за 10 минут на весь клуб (счётчики rate_limits, 0016).
--  * Неверный или устаревший код теперь возвращает NULL, а не ошибку: ошибка откатывала бы транзакцию вместе со счётчиком
--    попыток, и ограничение не работало бы. Превышение лимита — ошибка 'too many attempts' (54000).

create or replace function create_child_code(p uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text; i int; b bytea; tries int := 0;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from child_codes where player_id = p and used_at is null;
  delete from child_codes where expires_at < now() - interval '7 days'; -- чистим давно истёкшие
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex'); -- 16 случайных байт
    c := '';
    for i in 0..7 loop c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from child_codes where code = c);
    tries := tries + 1;
    if tries > 5 then raise exception 'could not generate code'; end if;
  end loop;
  insert into child_codes (code, player_id, created_by) values (c, p, current_user_id());
  return c;
end $$;

create or replace function redeem_child_code(c text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rec child_codes; role_ text; me uuid := current_user_id();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select chosen_role into role_ from users where id = me;
  if role_ is distinct from 'child' then raise exception 'wrong role' using errcode = '42501'; end if;
  -- ограничение попыток (каждая попытка, верная и неверная, учитывается; при блокировке счётчик не растёт)
  if not rate_limit_hit('child_code:' || me, 8, 600) or not rate_limit_hit('child_code_all', 200, 600) then
    raise exception 'too many attempts' using errcode = '54000';
  end if;
  select * into rec from child_codes where code = upper(trim(coalesce(c, ''))) and used_at is null and expires_at > now() for update;
  if not found then return null; end if;
  if not exists (select 1 from player_guardians where player_id = rec.player_id and consent_revoked_at is null) then return null; end if;
  if exists (select 1 from child_links where player_id = rec.player_id and user_id <> me) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  insert into child_links (user_id, player_id) values (me, rec.player_id)
    on conflict (user_id) do update set player_id = excluded.player_id, linked_at = now();
  update child_codes set used_at = now() where code = rec.code;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (me, 'child_link', 'child_links', rec.player_id, jsonb_build_object('player_id', rec.player_id, 'code_by', rec.created_by));
  return rec.player_id;
end $$;

revoke execute on function create_child_code(uuid), redeem_child_code(text) from public, anon;
grant execute on function create_child_code(uuid), redeem_child_code(text) to authenticated;
