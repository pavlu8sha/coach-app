-- Удаление ошибочно созданного события «FC Tbilisi-2025» (чемпионат, U9, 14.11.2026): тренер создал его вместо матча.
-- ПРИМЕНЯЕТ ТОЛЬКО ПАВЕЛ. Один блок: проверки и удаление в одной транзакции; если что-то не так, падает с понятной ошибкой и ничего не меняет.
-- Условия удаления: событие одно с таким именем/командой/датой, без игр (matches), без состава и взносов (tournament_fees),
-- без платежей (tournament_payments). Иначе скрипт останавливается и событие не трогает.
-- Отката нет: событие пустое, восстановить его можно только создав заново (теперь это может только администратор).

-- 1) Только чтение: покажет найденное событие и его содержимое (выполните отдельно перед удалением).
select t.id, t.team, t.kind, t.name, t.starts_on, t.fee,
       (select count(*) from matches m where m.tournament_id = t.id) as games,
       (select count(*) from tournament_fees f where f.tournament_id = t.id) as roster,
       (select count(*) from tournament_payments p where p.tournament_id = t.id) as payments
  from tournaments t
 where t.name = 'FC Tbilisi-2025';

-- 2) Удаление с проверками.
begin;
do $$
declare ev tournaments; n int; g int; r int; p int;
begin
  select count(*) into n from tournaments where name = 'FC Tbilisi-2025' and kind = 'championship' and team = 'U9' and starts_on = date '2026-11-14';
  if n <> 1 then raise exception 'ожидалось ровно одно событие FC Tbilisi-2025 (U9, 14.11.2026), найдено %', n; end if;
  select * into ev from tournaments where name = 'FC Tbilisi-2025' and kind = 'championship' and team = 'U9' and starts_on = date '2026-11-14' for update;
  select count(*) into g from matches where tournament_id = ev.id;
  select count(*) into r from tournament_fees where tournament_id = ev.id;
  select count(*) into p from tournament_payments where tournament_id = ev.id;
  if g <> 0 or r <> 0 or p <> 0 then
    raise exception 'событие не пустое (игр %, в составе %, платежей %): удаление остановлено, разберите вручную', g, r, p;
  end if;
  delete from tournaments where id = ev.id;
  raise notice 'удалено событие % (FC Tbilisi-2025)', ev.id;
end $$;
-- 3) Сверка: должно вернуть 0 строк.
select id, name from tournaments where name = 'FC Tbilisi-2025';
commit;
