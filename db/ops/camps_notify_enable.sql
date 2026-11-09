-- Включение уведомлений по сборам (Issue #470, этап 4, миграция 0167). НЕ ЗАПУСКАТЬ без отдельного слова владельца:
-- после запуска новая запись родителем, гостевая заявка, решение по заявке и отмена родителем начнут ставить сообщения
-- в очередь, а tg-notify отправит их администраторам и владельцам заявок. Выключить обратно: значение 'off'.
update club_settings set value = 'on' where key = 'camps.notify' and scope = '';
insert into club_settings (club_id, key, value, scope)
select c.id, 'camps.notify', 'on', '' from clubs c
 where not exists (select 1 from club_settings s where s.club_id = c.id and s.key = 'camps.notify' and s.scope = '');
