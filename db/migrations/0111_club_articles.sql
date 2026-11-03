-- 0111 (#236): редактируемые статьи клуба.
-- Постоянные материалы (цели, правила, полезная информация) хранятся отдельно от публикаций #237.
-- Читать могут гости и родители по аудитории; тренеры и администратор видят всё.
-- Писать напрямую нельзя: сохранение идёт через club_article_save, автор и редактор проставляются триггером.
-- Поля slug/link_* зарезервированы для общих экранов #234 и #237; в редакторе #236 ссылка необязательна.

create table club_articles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  slug text,
  title text not null,
  body text not null default '',
  audience text not null default 'both' check (audience in ('guest', 'parent', 'both')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  sort_order integer not null default 100 check (sort_order between -1000 and 10000),
  author_id uuid references users(id) on delete set null,
  author_name text not null,
  editor_id uuid references users(id) on delete set null,
  editor_name text,
  link_url text,
  link_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint club_articles_title_check check (length(btrim(title)) between 1 and 200),
  constraint club_articles_body_check check (length(body) <= 20000),
  constraint club_articles_link_url_check check (
    link_url is null or (
      length(link_url) <= 1000
      and link_url ~* '^https?://'
      and link_url !~ '[[:space:][:cntrl:]]'
    )
  ),
  constraint club_articles_link_label_check check (
    link_label is null or (
      link_url is not null
      and length(btrim(link_label)) between 1 and 120
    )
  ),
  constraint club_articles_slug_check check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  constraint club_articles_published_body_check check (
    status <> 'published' or (published_at is not null and length(btrim(body)) > 0)
  )
);

create unique index club_articles_club_slug_uidx on club_articles(club_id, slug) where slug is not null;
create index club_articles_list_idx on club_articles(club_id, status, audience, sort_order, published_at desc);

-- Активная связь с ребёнком. Нужна, чтобы отличать родителя от гостя в RLS.
create or replace function is_any_guardian() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from player_guardians
    where user_id = current_user_id() and consent_revoked_at is null
  )
$$;
revoke execute on function is_any_guardian() from public, anon;
grant execute on function is_any_guardian() to authenticated;

-- Автор и редактор всегда берутся из аккаунта, а не из текста запроса.
-- Автор не меняется при редактировании; редактор — тот, кто сохранил последнюю версию.
create or replace function club_articles_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who uuid;
  v_name text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    who := current_user_id();
    if who is null then raise exception 'not authenticated' using errcode = '42501'; end if;
    select coalesce(nullif(btrim(display_name), ''), 'Сотрудник клуба') into v_name from users where id = who;
    new.author_id := who;
    new.author_name := coalesce(v_name, 'Сотрудник клуба');
    new.editor_id := who;
    new.editor_name := new.author_name;
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    who := current_user_id();
    new.editor_id := who;
    if who is null then
      new.editor_name := old.editor_name;
    else
      select coalesce(nullif(btrim(display_name), ''), 'Сотрудник клуба') into v_name from users where id = who;
      new.editor_name := coalesce(v_name, 'Сотрудник клуба');
    end if;
  end if;
  if new.status = 'published' then
    if tg_op = 'INSERT' then
      new.published_at := now();
    elsif old.status is distinct from 'published' then
      new.published_at := now();
    end if;
  end if;
  return new;
end $$;
revoke execute on function club_articles_stamp() from public, anon, authenticated;

drop trigger if exists club_articles_stamp on club_articles;
create trigger club_articles_stamp before insert or update on club_articles
for each row execute function club_articles_stamp();

alter table club_articles enable row level security;
drop policy if exists club_articles_read on club_articles;
create policy club_articles_read on club_articles for select to authenticated using (
  is_admin()
  or is_any_coach()
  or (
    status = 'published'
    and (
      audience = 'both'
      or (audience = 'guest' and not is_any_guardian())
      or (audience = 'parent' and is_any_guardian())
    )
  )
);

revoke all on club_articles from anon, authenticated;
grant select on club_articles to authenticated;
grant all on club_articles to service_role;

-- Сохранение: администратор — любой материал, тренер — только свой.
-- Снятие с публикации — это status = 'draft': строка, текст и дата публикации сохраняются.
create or replace function club_article_save(
  p_id uuid,
  p_title text,
  p_body text,
  p_audience text,
  p_status text,
  p_sort_order integer default 100,
  p_link_url text default null,
  p_link_label text default null,
  p_slug text default null
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
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;

  v_title := btrim(coalesce(p_title, ''));
  if length(v_title) not between 1 and 200 then raise exception 'bad title' using errcode = '22023'; end if;
  v_body := coalesce(p_body, '');
  if length(v_body) > 20000 then raise exception 'bad body' using errcode = '22023'; end if;
  if p_audience is null or p_audience not in ('guest', 'parent', 'both') then raise exception 'bad audience' using errcode = '22023'; end if;
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
    if not is_admin() and a.author_id is distinct from current_user_id() then raise exception 'forbidden' using errcode = '42501'; end if;
    v_club := a.club_id;
  end if;

  if v_slug is not null and exists (
    select 1 from club_articles
    where club_id = v_club and slug = v_slug and id is distinct from p_id
  ) then
    raise exception 'slug busy' using errcode = '23505';
  end if;

  if p_id is null then
    insert into club_articles (club_id, slug, title, body, audience, status, sort_order, link_url, link_label)
    values (v_club, v_slug, v_title, v_body, p_audience, p_status, coalesce(p_sort_order, 100), v_link, v_label)
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
revoke execute on function club_article_save(uuid, text, text, text, text, integer, text, text, text) from public, anon;
grant execute on function club_article_save(uuid, text, text, text, text, integer, text, text, text) to authenticated;
