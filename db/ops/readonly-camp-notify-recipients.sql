-- Только чтение (Issue #470, этап 4). Кто получит админские уведомления по сборам после включения camps.notify:
-- администраторы без локальной роли и с включёнными уведомлениями. Запустить перед db/ops/camps_notify_enable.sql.
select u.display_name, u.notifications_enabled,
       exists (select 1 from location_admins la where la.user_id = u.id) as has_local_role,
       u.notifications_enabled and not exists (select 1 from location_admins la where la.user_id = u.id) as will_receive
  from users u where u.is_admin order by will_receive desc, u.display_name;
