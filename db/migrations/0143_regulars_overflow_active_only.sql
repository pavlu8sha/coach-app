-- Предупреждение «постоянных больше мест» считает только игроков в статусе «Занимается» (замечание к 0141, #274).
-- Игрок на паузе или ушедший остаётся в individual_slot_members, но автозапись его пропускает и место он не занимает.

create or replace function ind_regulars_overflow(mth date) returns table (template_id uuid, regulars int, cap int)
language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', mth)::date;
begin
  perform ind_assert_admin();
  return query
    select t.id, count(sm.player_id)::int, ind_cap(t.club_id, t.goalkeepers)
      from individual_templates t
      join individual_slot_members sm on sm.template_id = t.id and sm.month = m
      join players p on p.id = sm.player_id and p.status = 'active'
     where t.active
     group by t.id, t.club_id, t.goalkeepers
    having ind_cap(t.club_id, t.goalkeepers) is not null and count(sm.player_id) > ind_cap(t.club_id, t.goalkeepers);
end $$;
revoke execute on function ind_regulars_overflow(date) from public, anon;
grant execute on function ind_regulars_overflow(date) to authenticated;
