-- #468: extra.cap — недопустимое сохранённое значение не превращается молча в лимит или «без ограничения».
-- Пусто и 0 — без ограничения, как раньше. Остальное — целое 1..100 или явная ошибка 22023.
create or replace function extra_cap(c uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v text;
  n numeric;
begin
  select nullif(trim(value), '') into v
  from club_settings
  where club_id = c and key = 'extra.cap' and scope = '';
  if v is null then return null; end if;
  if v !~ '^[0-9]+([.,][0-9]+)?$' then
    raise exception 'invalid setting extra.cap: %', v using errcode = '22023';
  end if;
  n := replace(v, ',', '.')::numeric;
  if n = 0 then return null; end if;
  if n <> trunc(n) or n < 1 or n > 100 then
    raise exception 'invalid setting extra.cap: %', v using errcode = '22023';
  end if;
  return n::int;
end $$;

revoke execute on function extra_cap(uuid) from public, anon, authenticated;
