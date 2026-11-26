-- Только чтение. Сверка перед применением 0225: проверка клуба в remove_match_player, save_match,
-- set_match_technical и delete_match использует users.club_id (если пуст и клуб в системе один, то он).
-- Тренер с пустым club_id при нескольких клубах получит отказ; администратор с пустым club_id работает как раньше.
-- Ожидается: запрос 2 возвращает 1 клуб ИЛИ запрос 1 не возвращает тренеров.

-- 1. Тренеры и администраторы без users.club_id
select u.id, u.display_name, u.is_admin, exists (select 1 from coach_groups c where c.user_id = u.id) as is_coach
  from users u
 where u.club_id is null
   and (u.is_admin or exists (select 1 from coach_groups c where c.user_id = u.id))
 order by u.is_admin desc, u.display_name;

-- 2. Число клубов
select count(*) as clubs from clubs;
