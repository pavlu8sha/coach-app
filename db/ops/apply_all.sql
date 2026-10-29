-- Миграции 0079–0079 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0079.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0079 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0079_training_log_coach_read.sql =====
-- 0079: раздел «Учёт» у тренера — тот же журнал, что у администратора («Учёт тренеров»), но только просмотр.
-- Тренеры (is_any_coach) читают training_log: часы и тренировки всех тренеров. Запись по-прежнему только у администратора:
-- политика training_log_admin (0009) и функции tl_* (0038, 0062) проверяют is_admin(). В таблице нет денег и контактов.
create policy training_log_coach_read on training_log for select using (is_any_coach());

commit;
