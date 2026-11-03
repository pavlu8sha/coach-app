-- 0114 (#237, #234): разделы материалов клуба. Одна таблица и один редактор, три раздела:
-- article (постоянные статьи, #236), news (публикации с автором, #237), tournaments (текст о турнирах и матчах, #234).
-- Аудитория, права и автор те же, что в 0111/0113: пишет только администратор, автора проставляет триггер по аккаунту.
-- Раздел задаётся при создании и дальше не меняется. Старая функция из девяти параметров заменяется функцией с десятым (p_section).

alter table club_articles add column if not exists section text not null default 'article'
  check (section in ('article', 'news', 'tournaments'));
create index if not exists club_articles_section_idx on club_articles(club_id, section, status, sort_order);

drop function if exists club_article_save(uuid, text, text, text, text, integer, text, text, text);

create or replace function club_article_save(
  p_id uuid,
  p_title text,
  p_body text,
  p_audience text,
  p_status text,
  p_sort_order integer default 100,
  p_link_url text default null,
  p_link_label text default null,
  p_slug text default null,
  p_section text default 'article'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body text;
  v_link text;
  v_label text;
  v_slug text;
  v_club uuid;
  a club_articles;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  v_title := btrim(coalesce(p_title, ''));
  if length(v_title) not between 1 and 200 then raise exception 'bad title' using errcode = '22023'; end if;
  v_body := coalesce(p_body, '');
  if length(v_body) > 20000 then raise exception 'bad body' using errcode = '22023'; end if;
  if p_audience is null or p_audience not in ('guest', 'parent', 'both') then raise exception 'bad audience' using errcode = '22023'; end if;
  if p_section is null or p_section not in ('article', 'news', 'tournaments') then raise exception 'bad section' using errcode = '22023'; end if;
  if p_status is null or p_status not in ('draft', 'published') then raise exception 'bad status' using errcode = '22023'; end if;
  if p_status = 'published' and btrim(v_body) = '' then raise exception 'bad article' using errcode = '22023'; end if;
  if coalesce(p_sort_order, 100) not between -1000 and 10000 then raise exception 'bad order' using errcode = '22023'; end if;

  v_link := nullif(btrim(coalesce(p_link_url, '')), '');
  if v_link is not null then
    if length(v_link) > 1000 or v_link !~* '^https?://' or v_link ~ '[[:space:][:cntrl:]]' then
      raise exception 'bad url' using errcode = '22023';
    end if;
  end if;
  v_label := nullif(btrim(coalesce(p_link_label, '')), '');
  if v_label is not null then
    if v_link is null or length(v_label) > 120 then raise exception 'bad link label' using errcode = '22023'; end if;
  end if;
  v_slug := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  if v_slug is not null and v_slug !~ '^[a-z0-9][a-z0-9-]{2,59}$' then raise exception 'bad slug' using errcode = '22023'; end if;

  if p_id is null then
    select id into v_club from clubs order by id limit 1;
    if v_club is null then raise exception 'club not found' using errcode = 'P0002'; end if;
  else
    select * into a from club_articles where id = p_id for update;
    if a.id is null then raise exception 'article not found' using errcode = 'P0002'; end if;
    v_club := a.club_id;
  end if;

  if v_slug is not null and exists (
    select 1 from club_articles
    where club_id = v_club and slug = v_slug and id is distinct from p_id
  ) then
    raise exception 'slug busy' using errcode = '23505';
  end if;

  if p_id is null then
    insert into club_articles (club_id, slug, section, title, body, audience, status, sort_order, link_url, link_label)
    values (v_club, v_slug, p_section, v_title, v_body, p_audience, p_status, coalesce(p_sort_order, 100), v_link, v_label)
    returning * into a;
  else
    update club_articles
       set slug = v_slug,
           title = v_title,
           body = v_body,
           audience = p_audience,
           status = p_status,
           sort_order = coalesce(p_sort_order, 100),
           link_url = v_link,
           link_label = v_label
     where id = p_id
     returning * into a;
  end if;

  return a.id;
end $$;

revoke execute on function club_article_save(uuid, text, text, text, text, integer, text, text, text, text) from public, anon;
grant execute on function club_article_save(uuid, text, text, text, text, integer, text, text, text, text) to authenticated;
