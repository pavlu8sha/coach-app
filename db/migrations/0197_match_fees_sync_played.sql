-- Взнос за товарищеский матч снимается у неигравших (условия: docs/MATCH_FEES_SYNC_PLAYED_ACCEPTANCE.md).
-- После сохранения матча веб вызывает функцию: у игроков без отметки «Играл» удаляются неоплаченные взносы.
-- Игроки с любой оплатой (даже отменённой) не трогаются: match_payments каскадно зависит от match_fees, оплаты удалять нельзя.
-- Пока в матче никто не отмечен «Играл», ничего не удаляется (взнос назначают до игры). Чемпионаты и фестивали не затрагиваются.
-- save_match и остальное не менялись. Откат: db/ops/rollback-0197-match-fees-sync-played.sql.

create or replace function match_fees_sync_played(m uuid) returns int
language plpgsql security definer set search_path = public as $$
declare mt matches; n int := 0; ev_kind text;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into mt from matches where id = m for update;
  if mt.id is null then raise exception 'match not found'; end if;
  -- взнос на событие (чемпионат, фестиваль) ведётся отдельно (0153, 0155); у товарищеских и кубковых матчей взнос свой
  if mt.tournament_id is not null and mt.kind is distinct from 'friendly' then
    select t.kind into ev_kind from tournaments t where t.id = mt.tournament_id;
    if ev_kind in ('championship', 'festival') then return 0; end if;
  end if;
  if not exists (select 1 from match_players p where p.match_id = mt.id and p.played) then return 0; end if;
  delete from match_fees f
   where f.match_id = mt.id
     and not f.paid
     and not exists (select 1 from match_players p where p.match_id = f.match_id and p.player_id = f.player_id and p.played)
     and not exists (select 1 from match_payments x where x.match_id = f.match_id and x.player_id = f.player_id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function match_fees_sync_played(uuid) from public, anon;
grant execute on function match_fees_sync_played(uuid) to authenticated;
