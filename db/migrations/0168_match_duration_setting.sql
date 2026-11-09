-- Длительность матча настройкой клуба (продолжение PR #591). Условия: docs/MATCH_DURATION_SETTING_ACCEPTANCE.md.
-- Родителю нужна длительность матча, чтобы отличить «Идёт» от «Прошёл, результат не внесён», но таблица club_settings
-- открыта только администратору. Функция отдаёт один безобидный ключ matches.durationMin: общее значение (team = '')
-- и значения команд. Только клуба, где у вызывающего есть ребёнок с действующей связью; администратору все клубы.
-- Значение отдаётся как есть: проверяет его приложение, и недопустимое значение не ломает экран родителя.
-- Таблицы, политики и данные не меняются.
create or replace function match_duration_minutes()
returns table (team text, value text)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
    select s.scope, s.value
      from club_settings s
     where s.key = 'matches.durationMin'
       and (is_admin() or exists (select 1 from players p where p.club_id = s.club_id and is_guardian_of(p.id)))
     order by s.club_id, s.scope;
end $$;

revoke execute on function match_duration_minutes() from public, anon;
grant execute on function match_duration_minutes() to authenticated;
