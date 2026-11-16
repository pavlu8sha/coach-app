-- 0198: поиск ребёнка для привязки по словам в любом порядке и с кириллицей (docs/LINK_SEARCH_WORDS_ACCEPTANCE.md).
-- Было: вся строка запроса как кусок full_name («Max Ivanov» не находил «Ivanov Max», «Макс» не находил Max).
-- Стало: каждое слово (до 4) должно встречаться в имени, по исходному или нормализованному тексту. Минимум 3 символа,
-- хотя бы одно слово от 3 символов, лимит 5, rate limit, клуб, active и скрытие уже привязанных не меняются.
-- Откат: db/ops/rollback-0198-link-search-words.sql.

-- Внутренняя нормализация для сравнения написаний; клиентам не выдаётся (вызывается из definer-функции).
create or replace function link_search_norm(s text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := lower(coalesce(s, ''));
begin
  v := replace(v, 'щ', 'sh'); v := replace(v, 'ч', 'ch'); v := replace(v, 'ш', 'sh'); v := replace(v, 'ж', 'zh');
  v := replace(v, 'х', 'kh'); v := replace(v, 'ц', 'ts'); v := replace(v, 'ю', 'yu'); v := replace(v, 'я', 'ya');
  v := replace(v, 'ё', 'yo'); v := replace(v, 'э', 'e');
  v := translate(v, 'абвгдезийклмнопрстуфыьъ', 'abvgdeziiklmnoprstufi');
  v := replace(v, '''', '');
  v := replace(v, 'ch', '#'); v := replace(v, 'kh', 'h'); v := replace(v, 'ph', 'f'); v := replace(v, 'x', 'ks');
  v := translate(v, 'cqwjy', 'kkvii');
  return regexp_replace(v, '(.)\1+', '\1', 'g');
end $$;
revoke execute on function link_search_norm(text) from public, anon, authenticated;

create or replace function search_players_for_link(q text)
 returns table(player_id uuid, full_name text, group_name text)
 language plpgsql security definer set search_path to 'public'
as $function$
declare t text := trim(coalesce(q, ''));
  my_club uuid;
  words text[];
  w text;
  raw_pats text[] := '{}';
  norm_pats text[] := '{}';  -- пусто (null) для слова, у которого нормализованная форма короче 3 символов
  n text;
  anchor boolean := false;
  i int;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if char_length(t) < 3 then return; end if;
  words := (string_to_array(regexp_replace(t, '\s+', ' ', 'g'), ' '))[1:4];
  foreach w in array words loop
    if char_length(w) >= 3 then anchor := true; end if;
    raw_pats := raw_pats || ('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%');
    n := link_search_norm(w);
    norm_pats := norm_pats || case when char_length(n) >= 3
      then ('%' || replace(replace(replace(n, '\', '\\'), '%', '\%'), '_', '\_') || '%') else '' end;
  end loop;
  if not anchor then return; end if;
  if not rate_limit_hit('link_search:' || current_user_id()::text, 30, 600) then
    raise exception 'search limit reached' using errcode = '54000';
  end if;
  select coalesce(u.club_id, (select c.id from clubs c order by c.id limit 1)) into my_club from users u where u.id = current_user_id();
  return query
    select p.id, p.full_name, g.name
    from players p left join groups g on g.id = p.group_id
    where p.status = 'active'
      and p.club_id = my_club
      and not exists (
        select 1 from generate_series(1, array_length(raw_pats, 1)) k
        where not (p.full_name ilike raw_pats[k]
                   or (norm_pats[k] <> '' and link_search_norm(p.full_name) like norm_pats[k]))
      )
      and not exists (select 1 from player_guardians pg where pg.player_id = p.id and pg.user_id = current_user_id()
                       and (consent_new_model_for(pg.user_id, pg.player_id) or parent_access_ok(pg.user_id, pg.player_id)))
      and not exists (select 1 from link_requests r where r.player_id = p.id and r.user_id = current_user_id())
    order by p.full_name
    limit 5;
end $function$;
