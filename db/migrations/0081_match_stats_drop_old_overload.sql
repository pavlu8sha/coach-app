-- 0081: убирает старую версию match_stats(date, date) без p_cat (0033). Если она осталась в базе рядом с match_stats(date, date, text),
-- вызов без p_cat даёт «Could not choose the best candidate function». Остаётся одна функция с необязательным p_cat (0080). Безопасно повторять.
drop function if exists match_stats(date, date);
