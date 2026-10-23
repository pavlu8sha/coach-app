-- Ограничение частоты для функции входа tg-auth. Окно фиксированное: первое обращение открывает окно, дальше счётчик
-- растёт до лимита; по истечении окна счёт начинается заново. Функция атомарна (один insert ... on conflict).
-- Вызывать её может только service_role (Edge Function); приложению и анонимам таблица и функция недоступны.
create table rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
alter table rate_limits enable row level security; -- политик нет: читать и писать может только владелец / service_role
revoke all on rate_limits from public, anon, authenticated;
grant select, insert, update, delete on rate_limits to service_role;

create or replace function rate_limit_hit(k text, max_hits int, window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare h int;
begin
  insert into rate_limits as r (key, window_start, hits) values (k, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start <= now() - make_interval(secs => window_seconds) then now() else r.window_start end,
    hits = case when r.window_start <= now() - make_interval(secs => window_seconds) then 1 else r.hits + 1 end
  returning hits into h;
  -- изредка чистим давно закрытые окна, чтобы таблица не росла
  if random() < 0.01 then delete from rate_limits where window_start < now() - interval '1 day'; end if;
  return h <= max_hits;
end $$;

revoke execute on function rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, int, int) to service_role;
