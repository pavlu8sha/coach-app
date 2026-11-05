-- #468: дефолты мест на индивидуальных/вратарских занятиях как в старом приложении (6 и 7).
-- Пустое значение — значение по умолчанию; недопустимое сохранённое значение не подменяем молча.
create or replace function ind_cap(c uuid, gk boolean) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  k text := case when gk then 'ind.capGoalkeepers' else 'ind.capIndividual' end;
  v text;
  n numeric;
begin
  select nullif(trim(value), '') into v from club_settings where club_id = c and key = k;
  if v is null then return case when gk then 7 else 6 end; end if;
  begin
    n := replace(v, ',', '.')::numeric;
  exception when others then
    n := null;
  end;
  if n is null or n = 'NaN'::numeric or n <> trunc(n) or n < 1 or n > 100 then
    raise exception 'invalid setting %: %', k, v using errcode = '22023';
  end if;
  return n::int;
end $$;

revoke execute on function ind_cap(uuid, boolean) from public, anon, authenticated;


