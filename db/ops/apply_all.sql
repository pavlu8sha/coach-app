-- Миграции 0081–0081 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0081.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0081 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0081_match_stats_drop_old_overload.sql =====
-- 0081: убирает старую версию match_stats(date, date) без p_cat (0033). Если она осталась в базе рядом с match_stats(date, date, text),
-- вызов без p_cat даёт «Could not choose the best candidate function». Остаётся одна функция с необязательным p_cat (0080). Безопасно повторять.
drop function if exists match_stats(date, date);

commit;
