-- Согласие: контакт родителя в Telegram доступен тренерам группы ребёнка (решение Павла 2026-10-23).
-- Версии согласия помечаются: показывает ли версия родителю, что тренеры группы видят его Telegram. group_parents
-- (0020) отдаёт тренеру только родителей, согласившихся именно на такой текст; остальные в списке не появляются.
-- Старая версия не отключается: приложение, открытое до обновления, продолжает работать (его родители в контакты не попадают).

alter table consent_versions add column coach_contacts boolean not null default false;
insert into consent_versions (version, coach_contacts) values ('draft-2026-10-v2', true) on conflict (version) do nothing;

create or replace function group_parents(g uuid)
returns table (player_id uuid, player_name text, parent_name text, telegram_id bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_coach_of_group(g)) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select pl.id, pl.full_name, u.display_name, u.telegram_id
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.consent_revoked_at is null
    join consent_versions cv on cv.version = pg.consent_version and cv.coach_contacts
    join users u on u.id = pg.user_id
    where pl.group_id = g and pl.status = 'active'
    order by pl.full_name, u.display_name;
end $$;
